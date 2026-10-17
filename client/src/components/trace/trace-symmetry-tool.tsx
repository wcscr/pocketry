import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FlipHorizontal2, Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Item as RadioGroupItem } from "@radix-ui/react-radio-group";
import type { Outline, Point } from "@shared/geometry/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpHint } from "@/components/ui/help-hint";
import { RadioGroup } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { outlineToPathData } from "@/lib/export/svg";
import { mapOutline, normalizeOutline, outlineBounds } from "@/lib/geometry/outline";
import { suggestSymmetryAxis, symmetrizeShape, type SymmetryAxis, type SymmetrySide, type SymmetryResult } from "@/lib/geometry/symmetry";
import { rotateImageAlignment, transformImagePoint } from "@shared/geometry/image-alignment";
import { useElementSize } from "@/hooks/use-element-size";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
import { useTrace } from "@/state/trace-store";
import { SourceImage } from "./trace-scene";

interface Session { outline: Outline; sourceRevision: number; shapeIndex: number }

const segmentClass = "flex h-11 min-w-0 flex-1 items-center justify-center rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm";

/** Preview stays local; Apply uses the normal manual-edit and undo path. */
export function TraceSymmetryTool() {
  const trace = useTrace();
  const [session, setSession] = useState<Session | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (session && (trace.outline !== session.outline || trace.sourceRevision !== session.sourceRevision)) setSession(null);
  }, [trace.outline, trace.sourceRevision, session]);
  return <>
    <Button variant="outline" size="sm" className="w-full" disabled={!!trace.curves || trace.processing || !trace.outline.length}
      onClick={() => setSession({ outline: trace.outline, sourceRevision: trace.sourceRevision,
        shapeIndex: trace.selection?.shapeIndex ?? 0 })}>
      <FlipHorizontal2 className="mr-2 h-4 w-4" />Symmetry &amp; straighten
    </Button>
    <Dialog open={session !== null} onOpenChange={open => { if (!open) setSession(null); }}>
      {session && <DialogContent className="max-w-4xl gap-3 p-4 sm:p-6" onEscapeKeyDown={event => {
        if (cancelDrag.current) { event.preventDefault(); cancelDrag.current(); }
      }}>
        <SymmetryEditor session={session} onClose={() => setSession(null)} cancelDrag={cancelDrag} />
      </DialogContent>}
    </Dialog>
  </>;
}

function SymmetryEditor({ session, onClose, cancelDrag }: {
  session: Session; onClose: () => void; cancelDrag: { current: (() => void) | null };
}) {
  const trace = useTrace();
  const [shapeIndex, setShapeIndex] = useState(session.shapeIndex);
  const shape = session.outline[shapeIndex];
  const [axis, setAxis] = useState(() => suggestSymmetryAxis(shape.outer));
  const [mode, setMode] = useState<"straighten" | "symmetry">("straighten");
  const [side, setSide] = useState<SymmetrySide>("average");
  const [alignUpright, setAlignUpright] = useState(false);
  const straightenOnly = mode === "straighten";
  const rotate = straightenOnly || alignUpright;
  const [svg, previewSize] = useElementSize<SVGSVGElement>();
  const scene = useRef<SVGGElement>(null);
  const touchPointers = useRef(new Set<number>());
  const drag = useRef<{ endpoint: keyof SymmetryAxis; axis: SymmetryAxis; pointerId: number } | null>(null);
  const result = useMemo<SymmetryResult>(() => {
    if (!straightenOnly) return symmetrizeShape(shape, axis, side);
    const length = Math.hypot(axis.end.x - axis.start.x, axis.end.y - axis.start.y);
    return Number.isFinite(length) && length >= 1 ? { shape } : { error: "Move the axis endpoints farther apart." };
  }, [shape, axis, side, straightenOnly]);
  const radians = Math.atan2(axis.end.x - axis.start.x, axis.end.y - axis.start.y);
  const rotation = useMemo(() => rotateImageAlignment(trace.imageSize, radians, trace.imageAlignment),
    [trace.imageSize, radians, trace.imageAlignment]);
  const output = useMemo(() => rotate && result.shape ? {
    shape: normalizeOutline(mapOutline([result.shape], p => transformImagePoint(p, rotation.transform)))[0],
  } : result, [rotate, result, rotation]);
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
  const viewport = useViewportTransform({ contentWidth: width, contentHeight: height,
    containerWidth: previewSize.width, containerHeight: previewSize.height, padding: 0, maxScale: 30, wheelMode: "zoom" });
  useEffect(() => { viewport.attachWheel(svg.current); return () => viewport.attachWheel(null); }, [viewport.attachWheel, svg]);
  useEffect(() => { viewport.fit(); }, [shapeIndex, viewport.fit]);
  const handleRadius = 8 / viewport.transform.scale;
  const center = { x: (axis.start.x + axis.end.x) / 2, y: (axis.start.y + axis.end.y) / 2 };
  const axisLength = Math.hypot(axis.end.x - axis.start.x, axis.end.y - axis.start.y) || 1;
  const right = { x: (axis.end.y - axis.start.y) / axisLength, y: -(axis.end.x - axis.start.x) / axisLength };
  const sideLabelDistance = Math.max(bounds.maxX - bounds.minX, handleRadius * 6) * 0.65;

  const photoPoint = (event: ReactPointerEvent): Point | null => {
    const ctm = scene.current?.getScreenCTM();
    if (!ctm || !svg.current) return null;
    const point = svg.current.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const mapped = point.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  };
  const finishDrag = (cancelled: boolean) => {
    if (cancelled && drag.current) setAxis(drag.current.axis);
    drag.current = null;
    cancelDrag.current = null;
  };
  const stale = trace.outline !== session.outline || trace.sourceRevision !== session.sourceRevision;
  const apply = () => {
    if (!output.shape || stale) return;
    if (!result.shape) return;
    const outline = straightenOnly ? session.outline : session.outline.map((item, index) => index === shapeIndex ? result.shape : item);
    if (rotate) trace.dispatch({ type: "ALIGN_UPRIGHT", outline, expectedOutline: session.outline, radians,
      label: straightenOnly ? "Straighten photo" : "Make contour symmetric and upright" });
    else trace.dispatch({ type: "OUTLINE_COMMITTED", label: "Make contour symmetric", outline });
    onClose();
  };

  useEffect(() => () => { cancelDrag.current = null; }, [cancelDrag]);

  return <>
    <DialogHeader>
      <DialogTitle>Symmetry &amp; straighten</DialogTitle>
      <DialogDescription className="sr-only">Adjust the blue axis and preview straightening or symmetry before applying.</DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/30">
        <div className="flex items-center gap-1 border-b px-2 py-1" role="group" aria-label="Preview controls">
          <Button variant="ghost" size="icon" aria-label="Zoom out symmetry preview" onClick={() => viewport.zoomBy(1 / 1.5)}><ZoomOut className="h-4 w-4" /></Button>
          <span className="min-w-12 text-center text-xs tabular-nums">{Math.round(100 * viewport.transform.scale / viewport.fitScale)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom in symmetry preview" onClick={() => viewport.zoomBy(1.5)}><ZoomIn className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" className="gap-1 px-2" aria-label="Fit" onClick={() => viewport.fit()}><Maximize className="h-4 w-4" /><span className="hidden sm:inline">Fit</span></Button>
          <Button variant="ghost" size="sm" className="ml-auto gap-1 px-2" aria-label="Reset axis" onClick={() => setAxis(suggestSymmetryAxis(shape.outer))}><RotateCcw className="h-4 w-4" /><span className="hidden sm:inline">Reset axis</span></Button>
          <HelpHint label="preview controls">Drag the blue handles to adjust the axis; arrow keys make small adjustments. Reset axis restores the suggestion. Scroll or pinch to zoom, drag the photo to pan, or choose Fit to see the full contour.</HelpHint>
        </div>
        <svg ref={svg}
          className={`h-[42dvh] min-h-52 w-full touch-none sm:h-[60dvh] ${viewport.isPanning ? "cursor-grabbing" : "cursor-grab"}`} data-testid="symmetry-preview"
          aria-label="Symmetry preview with adjustable centerline"
          onPointerDown={event => {
            if (event.pointerType === "touch") touchPointers.current.add(event.pointerId);
            if (touchPointers.current.size > 1) finishDrag(true);
            viewport.handlers.onPointerDown(event, { pan: !(event.target as Element).closest("[data-axis-handle]") });
          }}
          onPointerMove={event => {
            viewport.handlers.onPointerMove(event);
            if (!drag.current || event.pointerId !== drag.current.pointerId) return;
            const point = photoPoint(event);
            const endpoint = drag.current.endpoint;
            if (point) setAxis(previous => ({ ...previous, [endpoint]: {
              x: Math.max(bounds.minX - padding, Math.min(bounds.maxX + padding, point.x)),
              y: Math.max(bounds.minY - padding, Math.min(bounds.maxY + padding, point.y)),
            } }));
          }} onPointerUp={event => { viewport.handlers.onPointerUp(event); touchPointers.current.delete(event.pointerId);
            if (drag.current?.pointerId === event.pointerId) finishDrag(false);
          }} onPointerCancel={event => { viewport.handlers.onPointerCancel(event); touchPointers.current.delete(event.pointerId); finishDrag(true); }}>
          <g data-testid="symmetry-viewport" transform={`translate(${viewport.transform.translateX} ${viewport.transform.translateY}) scale(${viewport.transform.scale})`}>
          <g ref={scene} data-testid="symmetry-scene" transform={`translate(${padding - bounds.minX} ${padding - bounds.minY})`}>
          {trace.imageUrl && <SourceImage url={trace.imageUrl} width={trace.imageSize.width}
            height={trace.imageSize.height} rotation={trace.imageRotation} alignment={trace.imageAlignment} />}
          <path d={originalPath} fill="none" stroke="white" strokeWidth={4} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <path d={originalPath} data-testid="symmetry-original" fill="none" stroke="#475569" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <path d={previewPath} data-testid="symmetry-result" fill="#c026d31c" stroke="#c026d3" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <line x1={axis.start.x} y1={axis.start.y} x2={axis.end.x} y2={axis.end.y}
            stroke="white" strokeWidth={4} vectorEffect="non-scaling-stroke" />
          <line x1={axis.start.x} y1={axis.start.y} x2={axis.end.x} y2={axis.end.y}
            stroke="#0284c7" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          {!straightenOnly && ([-1, 1] as const).map(sign => <text key={sign} x={center.x + sign * right.x * sideLabelDistance}
            y={center.y + sign * right.y * sideLabelDistance} textAnchor="middle" dominantBaseline="middle"
            fontSize={handleRadius * 1.6} fontWeight="bold" fill="#0369a1" stroke="white" strokeWidth={handleRadius / 4}
            paintOrder="stroke" pointerEvents="none">{sign < 0 ? "L" : "R"}</text>)}
          {(["start", "end"] as const).map(endpoint => <g key={endpoint}>
            <circle cx={axis[endpoint].x} cy={axis[endpoint].y} r={handleRadius}
              fill="#0284c7" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle
            cx={axis[endpoint].x} cy={axis[endpoint].y} r={handleRadius}
            fill="transparent" stroke="transparent" strokeWidth={30} vectorEffect="non-scaling-stroke" pointerEvents="all"
            className="cursor-grab focus:outline-none focus:stroke-sky-400/20" tabIndex={0} role="button" data-axis-handle
            aria-label={`${endpoint === "start" ? "First" : "Second"} axis handle`}
            onKeyDown={event => {
              const step = event.shiftKey ? 5 : 1;
              const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
              const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
              if (dx || dy) { event.preventDefault(); setAxis(previous => ({ ...previous,
                [endpoint]: { x: previous[endpoint].x + dx, y: previous[endpoint].y + dy } })); }
            }} onPointerDown={event => {
              if (event.button !== 0 || drag.current || viewport.isPanning || event.shiftKey || viewport.isSpaceHeld) return;
              event.preventDefault();
              drag.current = { endpoint, axis, pointerId: event.pointerId };
              cancelDrag.current = () => finishDrag(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onLostPointerCapture={() => finishDrag(true)} /></g>)}
          </g></g>
        </svg>
      </div>
      <div className="space-y-3">
        {session.outline.length > 1 && <Select value={String(shapeIndex)} onValueChange={value => {
          const index = Number(value); setShapeIndex(index); setAxis(suggestSymmetryAxis(session.outline[index].outer));
        }}>
          <SelectTrigger aria-label="Reference shape"><SelectValue /></SelectTrigger>
          <SelectContent>{session.outline.map((_, i) => <SelectItem key={i} value={String(i)}>Shape {i + 1}</SelectItem>)}</SelectContent>
        </Select>}
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span id="symmetry-mode-label" className="text-sm font-medium">Mode</span>
            <HelpHint label="straightening and symmetry">Straighten only rotates the photo and every contour without changing their shape or scale. Symmetry changes only the reference shape. Apply creates one undoable edit.</HelpHint>
          </div>
          <RadioGroup value={mode} onValueChange={(value: typeof mode) => setMode(value)} orientation="horizontal"
            aria-labelledby="symmetry-mode-label" className="flex gap-0 rounded-md border bg-muted p-0.5">
            <RadioGroupItem value="straighten" className={segmentClass}>Straighten only</RadioGroupItem>
            <RadioGroupItem value="symmetry" className={segmentClass}>Symmetry</RadioGroupItem>
          </RadioGroup>
        </div>
        {!straightenOnly && <>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span id="symmetry-side-label" className="text-sm font-medium">Align with side</span>
              <HelpHint label="symmetry sides">Mirror the left or right side of the blue axis, or average both. Tapers and shoulders are retained. Dashed is the original outline; purple is the preview.</HelpHint>
            </div>
            <RadioGroup value={side} onValueChange={(value: SymmetrySide) => setSide(value)} orientation="horizontal"
              aria-labelledby="symmetry-side-label" className="flex gap-0 rounded-md border bg-muted p-0.5">
              {([ ["left", "Left"], ["right", "Right"], ["average", "Average"] ] as const).map(([value, label]) =>
                <RadioGroupItem key={value} value={value} className={segmentClass}>{label}</RadioGroupItem>)}
            </RadioGroup>
          </div>
          <div className="flex items-center gap-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={alignUpright} onCheckedChange={checked => setAlignUpright(checked === true)} />
              Align upright
            </label>
            <HelpHint label="upright alignment">Also rotate the photo and every contour so the blue axis is vertical. Size and scale stay unchanged.</HelpHint>
          </div>
        </>}
        {rotate && output.shape && uprightBounds && <figure className="rounded-md border bg-muted/30 p-2">
          <figcaption className="mb-1 text-center text-xs font-medium">Upright result</figcaption>
          <svg viewBox={`${uprightBounds.minX - uprightPadding} ${uprightBounds.minY - uprightPadding} ${uprightWidth + uprightPadding * 2} ${uprightHeight + uprightPadding * 2}`}
            className="h-40 w-full" aria-label="Contour after upright rotation">
            {trace.imageUrl && <SourceImage url={trace.imageUrl} width={rotation.alignment.size.width}
              height={rotation.alignment.size.height} rotation={trace.imageRotation} alignment={rotation.alignment} />}
            <path d={outlineToPathData([output.shape])} data-testid="symmetry-upright-result" fill="#c026d31c" stroke="#c026d3" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        </figure>}
        {output.error && <p role="status" className="text-sm text-destructive">{output.error}</p>}
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button onClick={apply} disabled={!output.shape || stale}>Apply</Button>
    </DialogFooter>
  </>;
}
