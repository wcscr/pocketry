import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Move, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Item as RadioGroupItem } from "@radix-ui/react-radio-group";

import { curvePath, mapCurves, type CurveOutline } from "@shared/geometry/curves";
import { mmPerPixel, type Calibration } from "@shared/geometry/scale";
import type { Outline, Point } from "@shared/geometry/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { HelpHint } from "@/components/ui/help-hint";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { useElementSize } from "@/hooks/use-element-size";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
import { outlineToPathData } from "@/lib/export/svg";
import { mapOutline, outlineBounds } from "@/lib/geometry/outline";
import { rigidPoint, type RigidTransform } from "@/lib/geometry/outline-fit";
import { useTrace } from "@/state/trace-store";

import { SourceImage } from "./trace-scene";

interface Session { outline: Outline; curves?: CurveOutline; calibration: Calibration | null; sourceRevision: number; shapeIndex: number }
/** A turn about the contour's center, then a shift, in working-image pixels. */
interface Pose { dx: number; dy: number; radians: number }
type Drag = { kind: "move" | "turn"; pointerId: number; start: Point; pose: Pose };

const REST: Pose = { dx: 0, dy: 0, radians: 0 };
const segmentClass = "flex h-11 min-w-0 flex-1 items-center justify-center rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm";
const wrapDegrees = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;

/**
 * Moves and turns a contour over the photo without changing its size: the
 * manual counterpart to fitting an imported outline. The preview stays local;
 * Apply is one ordinary outline edit, so Undo restores the previous position.
 */
export function TraceContourPositionTool(): JSX.Element {
  const trace = useTrace();
  const [session, setSession] = useState<Session | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (session && (trace.outline !== session.outline || trace.curves !== session.curves || trace.calibration !== session.calibration || trace.sourceRevision !== session.sourceRevision)) setSession(null);
  }, [trace.outline, trace.curves, trace.calibration, trace.sourceRevision, session]);
  return <>
    <Button variant="outline" size="sm" className="w-full" disabled={trace.processing || !trace.outline.length}
      data-testid="button-position-contour"
      onClick={() => setSession({ outline: trace.outline, curves: trace.curves, calibration: trace.calibration, sourceRevision: trace.sourceRevision,
        shapeIndex: trace.selection && trace.outline[trace.selection.shapeIndex] ? trace.selection.shapeIndex : 0 })}>
      <Move className="mr-2 h-4 w-4" />Move &amp; rotate
    </Button>
    <Dialog open={session !== null} onOpenChange={open => { if (!open) setSession(null); }}>
      {session && <DialogContent className="max-w-4xl gap-3 p-4 sm:p-6" onEscapeKeyDown={event => {
        if (cancelDrag.current) { event.preventDefault(); cancelDrag.current(); }
      }}>
        <PositionEditor session={session} onClose={() => setSession(null)} cancelDrag={cancelDrag} />
      </DialogContent>}
    </Dialog>
  </>;
}

function PositionEditor({ session, onClose, cancelDrag }: {
  session: Session; onClose: () => void; cancelDrag: { current: (() => void) | null };
}): JSX.Element {
  const trace = useTrace();
  const [scope, setScope] = useState<"one" | "all">("one");
  const [pose, setPose] = useState<Pose>(REST);
  const [svg, previewSize] = useElementSize<SVGSVGElement>();
  const scene = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const touchPointers = useRef(new Set<number>());

  const moves = (index: number) => scope === "all" || index === session.shapeIndex;
  const moving = useMemo(() => session.outline.filter((_, index) => scope === "all" || index === session.shapeIndex), [session, scope]);
  const bounds = useMemo(() => outlineBounds(moving)!, [moving]);
  // Turn about the middle of what is being moved, so a turn does not also carry it away.
  const pivot = useMemo(() => ({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }), [bounds]);
  const transform: RigidTransform = { radians: pose.radians, pivot, shift: { x: pose.dx, y: pose.dy } };
  const pathOf = (map: (point: Point) => Point, wanted: (index: number) => boolean) => session.curves
    ? mapCurves(session.curves.filter((_, index) => wanted(index)), map).flatMap(shape => [shape.outer, ...shape.holes]).map(ring => curvePath(ring)).join(" ")
    : outlineToPathData(mapOutline(session.outline.filter((_, index) => wanted(index)), map));
  const originalPath = pathOf(point => point, moves);
  const previewPath = pathOf(point => rigidPoint(point, transform), moves);
  const restPath = pathOf(point => point, index => !moves(index));

  const viewport = useViewportTransform({ contentWidth: trace.imageSize.width, contentHeight: trace.imageSize.height,
    containerWidth: previewSize.width, containerHeight: previewSize.height, padding: 0, maxScale: 30, wheelMode: "zoom" });
  useEffect(() => { viewport.attachWheel(svg.current); return () => viewport.attachWheel(null); }, [viewport.attachWheel, svg]);
  // Open on the work area: every contour and the region, with room to move.
  const frame = () => {
    const all = outlineBounds(session.outline)!, region = trace.region;
    const minX = Math.min(all.minX, region?.x ?? all.minX), minY = Math.min(all.minY, region?.y ?? all.minY);
    const maxX = Math.max(all.maxX, region ? region.x + region.width : all.maxX), maxY = Math.max(all.maxY, region ? region.y + region.height : all.maxY);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.2 + 4;
    viewport.fitToRect({ x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad });
  };
  useEffect(() => { if (previewSize.width > 0 && previewSize.height > 0) frame(); }, [previewSize.width, previewSize.height]);

  const handleRadius = 8 / viewport.transform.scale;
  const reach = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 + 28 / viewport.transform.scale;
  const center = { x: pivot.x + pose.dx, y: pivot.y + pose.dy };
  // "Up" from the contour in its own turned frame; the image is y-down.
  const handle = { x: center.x + reach * Math.sin(pose.radians), y: center.y - reach * Math.cos(pose.radians) };

  const photoPoint = (event: ReactPointerEvent): Point | null => {
    const ctm = scene.current?.getScreenCTM();
    if (!ctm || !svg.current) return null;
    const point = svg.current.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const mapped = point.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  };
  const finishDrag = (cancelled: boolean) => {
    if (cancelled && drag.current) setPose(drag.current.pose);
    drag.current = null;
    cancelDrag.current = null;
  };
  const startDrag = (kind: Drag["kind"]) => (event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || drag.current || viewport.isPanning || event.shiftKey || viewport.isSpaceHeld) return;
    const start = photoPoint(event);
    if (!start) return;
    event.preventDefault();
    drag.current = { kind, pointerId: event.pointerId, start, pose };
    cancelDrag.current = () => finishDrag(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragTo = (point: Point) => {
    const active = drag.current;
    if (!active) return;
    if (active.kind === "move") {
      setPose({ ...active.pose, dx: active.pose.dx + point.x - active.start.x, dy: active.pose.dy + point.y - active.start.y });
      return;
    }
    const about = { x: pivot.x + active.pose.dx, y: pivot.y + active.pose.dy };
    const from = Math.atan2(active.start.y - about.y, active.start.x - about.x), to = Math.atan2(point.y - about.y, point.x - about.x);
    setPose({ ...active.pose, radians: active.pose.radians + to - from });
  };
  const nudge = (event: React.KeyboardEvent, kind: Drag["kind"]) => {
    const step = event.shiftKey ? 5 : 1;
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    if (kind === "move") setPose(previous => ({ ...previous, dx: previous.dx + horizontal * step, dy: previous.dy + vertical * step }));
    // Half a degree, or five with Shift; right and down turn clockwise.
    else setPose(previous => ({ ...previous, radians: previous.radians + (horizontal || vertical) * (event.shiftKey ? 5 : 0.5) * Math.PI / 180 }));
  };

  const mmPerPx = mmPerPixel(session.calibration), unit = mmPerPx ? "mm" : "px", perUnit = mmPerPx ?? 1;
  const degrees = wrapDegrees(pose.radians * 180 / Math.PI);
  const turned = Math.abs(degrees) > 1e-9, shifted = Math.hypot(pose.dx, pose.dy) > 1e-9;
  const stale = trace.outline !== session.outline || trace.curves !== session.curves || trace.calibration !== session.calibration || trace.sourceRevision !== session.sourceRevision;
  // Editable curves cannot carry a trace margin; the store would decline the edit.
  const blocked = session.curves && (trace.margin ?? 0) !== 0 ? "Set Margin to zero to move editable curves." : null;
  const apply = () => {
    if (stale || blocked || (!turned && !shifted)) return;
    const what = scope === "all" && session.outline.length > 1 ? "outline" : "contour";
    const label = `${turned && shifted ? "Move and rotate" : turned ? "Rotate" : "Move"} ${what}`;
    const place = (point: Point) => rigidPoint(point, transform);
    if (session.curves) trace.dispatch({ type: "CURVES_COMMITTED", label,
      curves: session.curves.map((shape, index) => moves(index) ? mapCurves([shape], place)[0] : shape) });
    else trace.dispatch({ type: "OUTLINE_COMMITTED", label,
      outline: session.outline.map((shape, index) => moves(index) ? mapOutline([shape], place)[0] : shape) });
    onClose();
  };

  useEffect(() => () => { cancelDrag.current = null; }, [cancelDrag]);

  return <>
    <DialogHeader>
      <DialogTitle>Move &amp; rotate</DialogTitle>
      <DialogDescription className="sr-only">Drag the contour to move it and the round handle to turn it over the photo, then apply.</DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/30">
        <div className="flex items-center gap-1 border-b px-2 py-1" role="group" aria-label="Preview controls">
          <Button variant="ghost" size="icon" aria-label="Zoom out position preview" onClick={() => viewport.zoomBy(1 / 1.5)}><ZoomOut className="h-4 w-4" /></Button>
          <span className="min-w-12 text-center text-xs tabular-nums">{Math.round(100 * viewport.transform.scale / viewport.fitScale)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom in position preview" onClick={() => viewport.zoomBy(1.5)}><ZoomIn className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" className="gap-1 px-2" aria-label="Fit" onClick={frame}><Maximize className="h-4 w-4" /><span className="hidden sm:inline">Fit</span></Button>
          <Button variant="ghost" size="sm" className="ml-auto gap-1 px-2" aria-label="Reset position" disabled={!turned && !shifted} onClick={() => setPose(REST)}><RotateCcw className="h-4 w-4" /><span className="hidden sm:inline">Reset</span></Button>
          <HelpHint label="moving and rotating">Drag the purple contour to move it, and the round handle to turn it; arrow keys make small adjustments. Its size never changes. Scroll or pinch to zoom, and drag the photo to pan.</HelpHint>
        </div>
        <svg ref={svg} data-testid="position-preview" aria-label="Contour position preview"
          className={`h-[42dvh] min-h-52 w-full touch-none sm:h-[60dvh] ${viewport.isPanning ? "cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={event => {
            if (event.pointerType === "touch") touchPointers.current.add(event.pointerId);
            if (touchPointers.current.size > 1) finishDrag(true);
            viewport.handlers.onPointerDown(event, { pan: !(event.target as Element).closest("[data-position-handle]") });
          }}
          onPointerMove={event => {
            viewport.handlers.onPointerMove(event);
            if (!drag.current || event.pointerId !== drag.current.pointerId) return;
            const point = photoPoint(event);
            if (point) dragTo(point);
          }}
          onPointerUp={event => { viewport.handlers.onPointerUp(event); touchPointers.current.delete(event.pointerId);
            if (drag.current?.pointerId === event.pointerId) finishDrag(false);
          }}
          onPointerCancel={event => { viewport.handlers.onPointerCancel(event); touchPointers.current.delete(event.pointerId); finishDrag(true); }}>
          <g data-testid="position-viewport" transform={`translate(${viewport.transform.translateX} ${viewport.transform.translateY}) scale(${viewport.transform.scale})`}>
          <g ref={scene}>
            {trace.imageUrl && <SourceImage url={trace.imageUrl} width={trace.imageSize.width}
              height={trace.imageSize.height} rotation={trace.imageRotation} alignment={trace.imageAlignment} />}
            {restPath && <path d={restPath} fill="none" stroke="#475569" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
            <path d={originalPath} fill="none" stroke="white" strokeWidth={4} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <path d={originalPath} data-testid="position-original" fill="none" stroke="#475569" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <path d={previewPath} data-testid="position-result" fillRule="evenodd" fill="#c026d31c" stroke="#c026d3" strokeWidth={2} vectorEffect="non-scaling-stroke"
              pointerEvents="all" className="cursor-move focus:outline-none" tabIndex={0} role="button" data-position-handle
              aria-label="Contour: drag or use arrow keys to move"
              onKeyDown={event => nudge(event, "move")} onPointerDown={startDrag("move")} onLostPointerCapture={() => finishDrag(true)} />
            <line x1={center.x} y1={center.y} x2={handle.x} y2={handle.y} stroke="white" strokeWidth={4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <line x1={center.x} y1={center.y} x2={handle.x} y2={handle.y} stroke="#0284c7" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={handle.x} cy={handle.y} r={handleRadius} fill="#0284c7" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={handle.x} cy={handle.y} r={handleRadius} fill="transparent" stroke="transparent" strokeWidth={30} vectorEffect="non-scaling-stroke"
              pointerEvents="all" className="cursor-grab focus:outline-none focus:stroke-sky-400/20" tabIndex={0} role="button" data-position-handle
              aria-label="Turn handle: drag or use arrow keys to rotate"
              onKeyDown={event => nudge(event, "turn")} onPointerDown={startDrag("turn")} onLostPointerCapture={() => finishDrag(true)} />
          </g></g>
        </svg>
      </div>
      <div className="space-y-3">
        {session.outline.length > 1 && <div className="space-y-1">
          <span id="position-scope-label" className="text-sm font-medium">Move</span>
          <RadioGroup value={scope} orientation="horizontal" aria-labelledby="position-scope-label" className="flex gap-0 rounded-md border bg-muted p-0.5"
            onValueChange={(value: typeof scope) => { finishDrag(true); setScope(value); setPose(REST); }}>
            <RadioGroupItem value="one" className={segmentClass}>Shape {session.shapeIndex + 1}</RadioGroupItem>
            <RadioGroupItem value="all" className={segmentClass}>All contours</RadioGroupItem>
          </RadioGroup>
        </div>}
        <div className="grid grid-cols-[1fr_5.5rem] items-center gap-x-2 gap-y-2">
          <Label htmlFor="position-right" className="text-xs">Right ({unit})</Label>
          <DraftNumberInput id="position-right" inputMode="decimal" className="h-9" value={pose.dx * perUnit} displayPrecision={2}
            onValueChange={value => setPose(previous => ({ ...previous, dx: value / perUnit }))} />
          <Label htmlFor="position-down" className="text-xs">Down ({unit})</Label>
          <DraftNumberInput id="position-down" inputMode="decimal" className="h-9" value={pose.dy * perUnit} displayPrecision={2}
            onValueChange={value => setPose(previous => ({ ...previous, dy: value / perUnit }))} />
          <Label htmlFor="position-turn" className="text-xs">Turn clockwise (°)</Label>
          <DraftNumberInput id="position-turn" inputMode="decimal" className="h-9" value={degrees} displayPrecision={2} normalize={wrapDegrees}
            onValueChange={value => setPose(previous => ({ ...previous, radians: value * Math.PI / 180 }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => setPose(previous => ({ ...previous, radians: previous.radians - Math.PI / 2 }))}>
            <RotateCcw className="h-4 w-4" />90° left
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPose(previous => ({ ...previous, radians: previous.radians + Math.PI / 2 }))}>
            <RotateCw className="h-4 w-4" />90° right
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Dashed is where it was; purple is where it will go. Apply is one undoable edit.</p>
        {blocked && <p role="status" className="text-sm text-destructive">{blocked}</p>}
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button onClick={apply} disabled={stale || !!blocked || (!turned && !shifted)}>Apply</Button>
    </DialogFooter>
  </>;
}
