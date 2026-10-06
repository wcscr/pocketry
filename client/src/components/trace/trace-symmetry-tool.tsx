import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FlipHorizontal2 } from "lucide-react";
import type { Outline, Point } from "@shared/geometry/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { outlineToPathData } from "@/lib/export/svg";
import { outlineBounds } from "@/lib/geometry/outline";
import { alignShapeUpright, suggestSymmetryAxis, symmetrizeShape, type SymmetryAxis, type SymmetrySide } from "@/lib/geometry/symmetry";
import { useTrace } from "@/state/trace-store";
import { SourceImage } from "./trace-scene";

interface Session { outline: Outline; sourceRevision: number; shapeIndex: number }

/** Preview stays local; Apply uses the normal manual-edit and undo path. */
export function TraceSymmetryTool() {
  const trace = useTrace();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (session && (trace.outline !== session.outline || trace.sourceRevision !== session.sourceRevision)) setSession(null);
  }, [trace.outline, trace.sourceRevision, session]);
  return <>
    <Button variant="outline" size="sm" className="w-full" disabled={trace.processing || !trace.outline.length}
      onClick={() => setSession({ outline: trace.outline, sourceRevision: trace.sourceRevision,
        shapeIndex: trace.selection?.shapeIndex ?? 0 })}>
      <FlipHorizontal2 className="mr-2 h-4 w-4" />Symmetry &amp; straighten
    </Button>
    <Dialog open={session !== null} onOpenChange={open => { if (!open) setSession(null); }}>
      {session && <SymmetryEditor session={session} onClose={() => setSession(null)} />}
    </Dialog>
  </>;
}

function SymmetryEditor({ session, onClose }: { session: Session; onClose: () => void }) {
  const trace = useTrace();
  const [shapeIndex, setShapeIndex] = useState(session.shapeIndex);
  const shape = session.outline[shapeIndex];
  const [axis, setAxis] = useState(() => suggestSymmetryAxis(shape.outer));
  const [side, setSide] = useState<SymmetrySide>("average");
  const [alignUpright, setAlignUpright] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ endpoint: keyof SymmetryAxis; axis: SymmetryAxis; pointerId: number } | null>(null);
  const result = useMemo(() => symmetrizeShape(shape, axis, side), [shape, axis, side]);
  const output = useMemo(() => alignUpright && result.shape ? alignShapeUpright(result.shape, axis) : result,
    [alignUpright, result, axis]);
  const uprightBounds = useMemo(() => output.shape ? outlineBounds([output.shape]) : null, [output]);
  const uprightWidth = uprightBounds ? uprightBounds.maxX - uprightBounds.minX : 0;
  const uprightHeight = uprightBounds ? uprightBounds.maxY - uprightBounds.minY : 0;
  const uprightPadding = Math.max(uprightWidth, uprightHeight) * .08 + 2;
  const originalPath = useMemo(() => outlineToPathData([shape]), [shape]);
  const previewPath = useMemo(() => result.shape ? outlineToPathData([result.shape]) : "", [result]);
  // A stable frame while dragging prevents the handles chasing a moving viewBox.
  const bounds = useMemo(() => outlineBounds([shape])!, [shape]);
  const padding = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.15 + 4;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;
  const handleRadius = Math.max(width, height) / 45;
  const center = { x: (axis.start.x + axis.end.x) / 2, y: (axis.start.y + axis.end.y) / 2 };
  const axisLength = Math.hypot(axis.end.x - axis.start.x, axis.end.y - axis.start.y) || 1;
  const right = { x: (axis.end.y - axis.start.y) / axisLength, y: -(axis.end.x - axis.start.x) / axisLength };
  const sideLabelDistance = Math.max(bounds.maxX - bounds.minX, handleRadius * 6) * 0.65;

  const photoPoint = (event: ReactPointerEvent): Point | null => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm || !svg.current) return null;
    const point = svg.current.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const mapped = point.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  };
  const finishDrag = (cancelled: boolean) => {
    if (cancelled && drag.current) setAxis(drag.current.axis);
    drag.current = null;
  };
  const stale = trace.outline !== session.outline || trace.sourceRevision !== session.sourceRevision;
  const apply = () => {
    if (!output.shape || stale) return;
    trace.dispatch({ type: "OUTLINE_COMMITTED", label: alignUpright ? "Make contour symmetric and upright" : "Make contour symmetric",
      outline: session.outline.map((item, index) => index === shapeIndex ? output.shape : item) });
    onClose();
  };

  return <DialogContent className="max-w-4xl gap-3 p-4 sm:p-6" onEscapeKeyDown={event => {
    if (drag.current) { event.preventDefault(); finishDrag(true); }
  }}>
    <DialogHeader>
      <DialogTitle>Symmetry &amp; straighten</DialogTitle>
      <DialogDescription>Drag the two blue handles onto the tool’s centerline. Choose the cleaner side to mirror, or average both.</DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/30">
        <svg ref={svg} viewBox={`${bounds.minX - padding} ${bounds.minY - padding} ${width} ${height}`}
          className="h-[42dvh] min-h-52 w-full touch-none sm:h-[60dvh]" data-testid="symmetry-preview"
          aria-label="Symmetry preview with adjustable centerline"
          onPointerMove={event => {
            if (!drag.current || event.pointerId !== drag.current.pointerId) return;
            const point = photoPoint(event);
            const endpoint = drag.current.endpoint;
            if (point) setAxis(previous => ({ ...previous, [endpoint]: {
              x: Math.max(bounds.minX - padding, Math.min(bounds.maxX + padding, point.x)),
              y: Math.max(bounds.minY - padding, Math.min(bounds.maxY + padding, point.y)),
            } }));
          }} onPointerUp={() => finishDrag(false)} onPointerCancel={() => finishDrag(true)}>
          {trace.imageUrl && <SourceImage url={trace.imageUrl} width={trace.imageSize.width}
            height={trace.imageSize.height} rotation={trace.imageRotation} />}
          <path d={originalPath} fill="none" stroke="white" strokeWidth={4} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <path d={originalPath} data-testid="symmetry-original" fill="none" stroke="#475569" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <path d={previewPath} data-testid="symmetry-result" fill="#c026d31c" stroke="#c026d3" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <line x1={axis.start.x} y1={axis.start.y} x2={axis.end.x} y2={axis.end.y}
            stroke="white" strokeWidth={4} vectorEffect="non-scaling-stroke" />
          <line x1={axis.start.x} y1={axis.start.y} x2={axis.end.x} y2={axis.end.y}
            stroke="#0284c7" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          {([-1, 1] as const).map(sign => <text key={sign} x={center.x + sign * right.x * sideLabelDistance}
            y={center.y + sign * right.y * sideLabelDistance} textAnchor="middle" dominantBaseline="middle"
            fontSize={handleRadius * 1.6} fontWeight="bold" fill="#0369a1" stroke="white" strokeWidth={handleRadius / 4}
            paintOrder="stroke" pointerEvents="none">{sign < 0 ? "L" : "R"}</text>)}
          {(["start", "end"] as const).map(endpoint => <g key={endpoint}>
            <circle cx={axis[endpoint].x} cy={axis[endpoint].y} r={handleRadius}
              fill="#0284c7" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle
            cx={axis[endpoint].x} cy={axis[endpoint].y} r={handleRadius}
            fill="transparent" stroke="transparent" strokeWidth={30} vectorEffect="non-scaling-stroke" pointerEvents="all"
            className="cursor-grab focus:outline-none focus:stroke-sky-400/20" tabIndex={0} role="button"
            aria-label={`${endpoint === "start" ? "First" : "Second"} axis handle`}
            onKeyDown={event => {
              const step = event.shiftKey ? 5 : 1;
              const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
              const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
              if (dx || dy) { event.preventDefault(); setAxis(previous => ({ ...previous,
                [endpoint]: { x: previous[endpoint].x + dx, y: previous[endpoint].y + dy } })); }
            }} onPointerDown={event => {
              if (event.button !== 0 || drag.current) return;
              event.preventDefault();
              drag.current = { endpoint, axis, pointerId: event.pointerId };
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onLostPointerCapture={() => finishDrag(true)} /></g>)}
        </svg>
      </div>
      <div className="space-y-3">
        {session.outline.length > 1 && <Select value={String(shapeIndex)} onValueChange={value => {
          const index = Number(value); setShapeIndex(index); setAxis(suggestSymmetryAxis(session.outline[index].outer));
        }}>
          <SelectTrigger aria-label="Shape to make symmetric"><SelectValue /></SelectTrigger>
          <SelectContent>{session.outline.map((_, i) => <SelectItem key={i} value={String(i)}>Shape {i + 1}</SelectItem>)}</SelectContent>
        </Select>}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-1" role="group" aria-label="Symmetry source">
          {([ ["left", "Use left side"], ["right", "Use right side"], ["average", "Average both"] ] as const).map(([value, label]) =>
            <Button key={value} variant={side === value ? "default" : "outline"} aria-pressed={side === value}
              className="h-auto min-h-11 whitespace-normal px-2" onClick={() => setSide(value)}>{label}</Button>)}
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setAxis(suggestSymmetryAxis(shape.outer))}>Reset axis</Button>
        <p className="text-xs text-muted-foreground">Dashed: original · Purple: preview<br />The profile is centered on the blue axis. Lengthwise tapers and shoulders are retained.</p>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
          <Checkbox checked={alignUpright} onCheckedChange={checked => setAlignUpright(checked === true)} />
          Align upright
        </label>
        <p className="text-xs text-muted-foreground">Rotate the contour so its lengthwise axis runs straight up and down.</p>
        {alignUpright && output.shape && uprightBounds && <figure className="rounded-md border bg-muted/30 p-2">
          <figcaption className="mb-1 text-center text-xs font-medium">Upright result</figcaption>
          <svg viewBox={`${uprightBounds.minX - uprightPadding} ${uprightBounds.minY - uprightPadding} ${uprightWidth + uprightPadding * 2} ${uprightHeight + uprightPadding * 2}`}
            className="h-40 w-full" aria-label="Contour after upright rotation">
            <path d={outlineToPathData([output.shape])} data-testid="symmetry-upright-result" fill="#c026d31c" stroke="#c026d3" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        </figure>}
        {output.error && <p role="status" className="text-sm text-destructive">{output.error}</p>}
        <p className="text-xs text-muted-foreground">Prototype for straight tool silhouettes. Changes apply only to this shape. Undo restores the original.</p>
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button onClick={apply} disabled={!output.shape || stale}>{alignUpright ? "Apply symmetry & rotation" : "Apply symmetry"}</Button>
    </DialogFooter>
  </DialogContent>;
}
