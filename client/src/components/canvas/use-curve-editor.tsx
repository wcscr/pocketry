import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { curveControls, curvePath, curveRing, curvesFromOutline, editCurves, evaluateCurve, sampleCurves,
  type CurveEdit, type CurveOutline } from "@shared/geometry/curves";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ViewportPointerHandlers } from "@/hooks/use-viewport-transform";
import { useCurveFitting } from "./use-curve-fitting";
import { usePointSelection } from "./use-point-selection";
import { curvePoints, type selectedCurveSection } from "@shared/geometry/curve-point-selection";
import { HelpHint } from "@/components/ui/help-hint";
import { useOutlineRepair, type RepairSection } from "./use-outline-repair";

type Target = { kind: "edge" | "point" | "in" | "out"; index: number };
interface Options {
  outline: Outline;
  reconstructionSource?: Outline;
  curves?: CurveOutline;
  enabled: boolean;
  contextKey: string;
  /** Screen pixels per canvas unit; control handles stay the same screen size. */
  scale: number;
  tolerance: number;
  fitUnitsPerUnit?: number;
  fitUnit?: "mm" | "px";
  fromClient: (x: number, y: number) => Point | null;
  toCanvas?: (point: Point) => Point;
  onCommit: (curves: CurveOutline, label: string) => void;
  viewport: ViewportPointerHandlers;
  panRequested?: boolean;
  startDisabled?: boolean;
  startHint?: string;
  onDone?: () => void;
  allowCurves?: boolean;
  onFrameRepair?: (points: Point[]) => void;
}
const identity = (p: Point) => p;

/** Shared editing interaction. All gesture drafts are local until pointer-up;
 * cancel, selection and pointer clicks never create source revisions. */
export function useCurveEditor({ outline, curves, reconstructionSource, enabled, contextKey, scale, tolerance,
  fromClient, toCanvas = identity, onCommit, viewport, panRequested, startDisabled, startHint, onDone, allowCurves = true,
  fitUnitsPerUnit = 1, fitUnit = "mm", onFrameRepair }: Options) {
  const [started, setStarted] = useState(false);
  const [ref, setRef] = useState<RingRef>({ shapeIndex: 0, ringIndex: -1 });
  const [target, setTarget] = useState<Target>({ kind: "edge", index: 0 });
  const [draft, setDraft] = useState<CurveOutline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionRequest, setSectionRequest] = useState<RepairSection & { repair?: boolean }>();
  const base = useMemo(() => curves ?? curvesFromOutline(outline), [curves, outline]);
  const value = draft ?? base;
  const active = enabled && (started || !!curves);
  const ringRef = curveRing(value, ref) ? ref : { shapeIndex: 0, ringIndex: -1 };
  const ring = curveRing(value, ringRef);
  const selected = ring && target.index < ring.length ? target : { kind: "edge" as const, index: 0 };
  const anchor = ring?.[selected.index];
  const capture = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Set<number>());
  const gesture = useRef<{ id: number; source: CurveOutline; ref: RingRef; target: Target; start: Point; client: Point; t: number; latest: CurveOutline | null } | null>(null);
  useEffect(() => { cancel(); pointers.current.clear(); setStarted(false); setSectionRequest(undefined); setRef({ shapeIndex: 0, ringIndex: -1 }); setTarget({ kind: "edge", index: 0 }); }, [contextKey, enabled]);
  useEffect(() => { setDraft(null); gesture.current = null; }, [curves, outline]);
  const cancel = () => { const drag = gesture.current; gesture.current = null; setDraft(null); if (drag && capture.current?.hasPointerCapture?.(drag.id)) capture.current.releasePointerCapture(drag.id); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && gesture.current) { e.preventDefault(); cancel(); } };
    // A lost-focus touch may never send pointerup. Forget it rather than
    // mistaking every later finger for a second touch in a permanent pinch.
    const reset = () => { cancel(); pointers.current.clear(); };
    window.addEventListener("keydown", key); window.addEventListener("blur", reset); window.addEventListener("resize", reset);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", reset); window.removeEventListener("resize", reset); };
  }, []);
  useEffect(() => { cancel(); }, [scale]);
  const commit = (next: CurveOutline, label: string) => {
    try {
      if (JSON.stringify(next) !== JSON.stringify(base)) { sampleCurves(next, tolerance); onCommit(next, label); }
      setError(null);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not edit curve."); }
    setDraft(null);
  };
  const edit = (change: CurveEdit, label: string) => commit(editCurves(base, ringRef, change), label);
  const fitting = useCurveFitting({ source: base, ringRef, enabled: active, contextKey, unitsPerUnit: fitUnitsPerUnit,
    unit: fitUnit, scale, toCanvas, reconstructionSource, editableCurves: allowCurves || !!curves, onCommit: (next, label) => { cancel(); commit(next, label); setTarget({ kind: "edge", index: 0 }); } });
  const repair = useOutlineRepair({ source: base, enabled: active, contextKey, editableCurves: allowCurves || !!curves,
    tolerance, unitsPerUnit: fitUnitsPerUnit, unit: fitUnit, scale, toCanvas,
    onFrameSection: onFrameRepair,
    onCommit: (next, label) => { cancel(); commit(next, label); setTarget({ kind: "edge", index: 0 }); } });
  const previewOpen = fitting.open || repair.open;
  useEffect(() => { if (!allowCurves && !curves && !previewOpen) setStarted(false); }, [allowCurves, curves, previewOpen]);
  useEffect(() => { if (previewOpen) cancel(); }, [previewOpen]);
  const fitSection = (section: NonNullable<ReturnType<typeof selectedCurveSection>>) => {
    setStarted(true); setRef(section.ref); setTarget({ kind: "point", index: section.start }); setSectionRequest(section);
  };
  const repairSection = (section: RepairSection) => {
    if (startDisabled && (allowCurves || curves)) return;
    setStarted(true); setRef(section.ref); setTarget({ kind: "point", index: section.start }); setSectionRequest({ ...section, repair: true });
  };
  useEffect(() => {
    if (sectionRequest && active) { if (sectionRequest.repair) repair.start(sectionRequest); else fitting.start("range", sectionRequest); setSectionRequest(undefined); }
  }, [sectionRequest, active]);
  const points = usePointSelection({ source: base, enabled: active && !previewOpen, contextKey, scale,
    fromClient, toCanvas, viewport, panRequested, onCommit: commit, onSmoothSection: fitSection,
    onRepairSection: repairSection,
    repairDisabledReason: startDisabled && (allowCurves || curves) ? startHint : undefined,
    onPinchStart: () => { cancel(); pointers.current.clear(); } });
  const down = (e: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (!active) return false;
    if (repair.open) { viewport.onPointerDown(e); return true; }
    if (points.down(e)) { cancel(); return true; }
    if (e.pointerType === "touch") pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) { cancel(); viewport.onPointerDown(e, { pan: false }); return true; }
    if (e.button !== 0 || panRequested || gesture.current) { viewport.onPointerDown(e); return true; }
    const hit = (e.target as Element).closest<SVGElement>("[data-curve-kind]");
    viewport.onPointerDown(e, { pan: !hit });
    if (!hit) return true;
    const q = fromClient(e.clientX, e.clientY); if (!q) return true;
    e.preventDefault(); e.stopPropagation();
    const picked: Target = { kind: hit.dataset.curveKind as Target["kind"], index: Number(hit.dataset.curveIndex) };
    const pickedRef = { shapeIndex: Number(hit.dataset.curveShape), ringIndex: Number(hit.dataset.curveRing) };
    const pickedRing = curveRing(base, pickedRef); if (!pickedRing) return true;
    if (fitting.open) { if (picked.kind === "point") fitting.pick(pickedRef, picked.index); return true; }
    setRef(pickedRef); setTarget(picked);
    let t = 0.5, distance = Infinity;
    if (picked.kind === "edge") for (let k = 1; k < 100; k++) {
      const p = evaluateCurve(curveControls(pickedRing, picked.index), k / 100), d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < distance) { distance = d; t = k / 100; }
    }
    if (picked.kind === "edge") {
      const controls = curveControls(pickedRing, picked.index), squareDistance = (t: number) => { const p = evaluateCurve(controls, t); return (p.x - q.x) ** 2 + (p.y - q.y) ** 2; };
      let lo = Math.max(.001, t - .01), hi = Math.min(.999, t + .01);
      for (let i = 0; i < 24; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (squareDistance(a) < squareDistance(b)) hi = b; else lo = a;
      }
      t = (lo + hi) / 2;
    }
    gesture.current = { id: e.pointerId, source: base, ref: pickedRef, target: picked, start: q, client: { x: e.clientX, y: e.clientY }, t, latest: null };
    capture.current = e.currentTarget;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    return true;
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (!active) return false;
    if (points.move(e)) return true;
    viewport.onPointerMove(e);
    const drag = gesture.current; if (!drag || drag.id !== e.pointerId) return true;
    e.stopPropagation();
    if (!drag.latest && Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) < (e.pointerType === "touch" ? 8 : 3)) return true;
    const q = fromClient(e.clientX, e.clientY); if (!q) return true;
    const delta = { x: q.x - drag.start.x, y: q.y - drag.start.y }, a = curveRing(drag.source, drag.ref)![drag.target.index];
    const { kind, index } = drag.target;
    const origin = kind === "in" || kind === "out" ? a[kind]! : a.point;
    const change: CurveEdit = kind === "edge" ? { kind: "bend", index, t: drag.t, delta }
      : kind === "point" ? { kind: "move", index, point: { x: origin.x + delta.x, y: origin.y + delta.y } }
      : { kind: "handle", index, side: kind, point: { x: origin.x + delta.x, y: origin.y + delta.y } };
    drag.latest = editCurves(drag.source, drag.ref, change); setDraft(drag.latest);
    return true;
  };
  const end = (e: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (points.end(e)) return true;
    if (!active && !pointers.current.has(e.pointerId)) return false;
    pointers.current.delete(e.pointerId);
    viewport.onPointerUp(e);
    if (e.type === "pointercancel") { cancel(); return true; }
    const drag = gesture.current; if (!drag || drag.id !== e.pointerId) return true;
    e.stopPropagation(); gesture.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.latest) commit(drag.latest, drag.target.kind === "edge" ? "Bend contour curve" : "Move curve anchor or handle");
    else if (drag.target.kind === "edge") {
      commit(editCurves(drag.source, drag.ref, { kind: "split", index: drag.target.index, t: drag.t }), "Add contour node");
      setTarget({ kind: "point", index: drag.target.index + 1 });
    } else setDraft(null);
    return true;
  };
  const contextMenu = (event: ReactMouseEvent<SVGSVGElement>): boolean => {
    if (!active) return false;
    event.preventDefault();
    if (previewOpen) return true;
    const p = fromClient(event.clientX, event.clientY); if (!p) return true;
    let hit: ReturnType<typeof curvePoints>[number] | undefined, distance = 12 / Math.max(scale, 1e-6);
    for (const ref of curvePoints(base)) { const q = curveRing(base, ref)![ref.index].point, d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < distance) { hit = ref; distance = d; }
    }
    if (hit && curveRing(base, hit)!.length > 3) {
      cancel(); points.clear(); setRef({ shapeIndex: hit.shapeIndex, ringIndex: hit.ringIndex });
      commit(editCurves(base, hit, { kind: "delete", index: hit.index }), "Remove contour node");
      setTarget({ kind: "point", index: 0 });
    }
    return true;
  };
  const inv = 1 / Math.max(scale, 1e-6);
  const data = (kind: Target["kind"], index: number, r: RingRef) => ({ "data-curve-kind": kind, "data-curve-index": index, "data-curve-shape": r.shapeIndex, "data-curve-ring": r.ringIndex });
  const overlay = active && <g data-testid="curve-editor-overlay">
    {value.flatMap((shape, shapeIndex) => [{ ring: shape.outer, ringIndex: -1 }, ...shape.holes.map((r, ringIndex) => ({ ring: r, ringIndex }))].map(({ ring: r, ringIndex }) => {
      const rRef = { shapeIndex, ringIndex }, selectedRing = rRef.shapeIndex === ringRef.shapeIndex && rRef.ringIndex === ringRef.ringIndex;
      return <g key={`${shapeIndex}:${ringIndex}`}>
        <path d={curvePath(r, toCanvas)} fill="none" className={fitting.open ? "stroke-muted-foreground" : "stroke-primary"} strokeDasharray={fitting.open ? "4 4" : undefined} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" data-testid="curve-source-path" />
        {r.map((a, i) => {
          const c = curveControls(r, i).map(toCanvas), curved = a.out || r[(i + 1) % r.length].in;
          const d = `M${c[0].x},${c[0].y} ` + (curved ? `C${c[1].x},${c[1].y} ${c[2].x},${c[2].y} ${c[3].x},${c[3].y}` : `L${c[3].x},${c[3].y}`);
          return <g key={`edge:${i}`}>
            {selectedRing && selected.kind === "edge" && selected.index === i && <path d={d} fill="none" className="stroke-primary" strokeWidth={4} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
            <path d={d} fill="none" stroke="transparent" strokeWidth={22} vectorEffect="non-scaling-stroke" className="cursor-grab" {...data("edge", i, rRef)} />
          </g>;
        })}
        {r.flatMap((a, i) => (["in", "out"] as const).map(side => {
          const show = selectedRing && (selected.kind === "edge" ? side === "out" && i === selected.index || side === "in" && i === (selected.index + 1) % r.length : i === selected.index);
          if (!show || !a[side]) return null;
          const p = toCanvas(a.point), q = toCanvas(a[side]!);
          return <g key={`${i}:${side}`}><line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="stroke-primary/70" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={q.x} cy={q.y} r={5 * inv} className="fill-background stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={q.x} cy={q.y} r={12 * inv} fill="transparent" className="cursor-grab" {...data(side, i, rRef)} data-testid="curve-control-handle" />
          </g>;
        }))}
        {r.map((a, i) => { const p = toCanvas(a.point), chosen = selectedRing && selected.kind !== "edge" && selected.index === i;
          return <g key={`point:${i}`}><rect x={p.x - 4 * inv} y={p.y - 4 * inv} width={8 * inv} height={8 * inv} rx={a.smooth ? 2 * inv : 0}
            className={chosen ? "fill-primary stroke-background" : "fill-background stroke-primary"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={p.x} cy={p.y} r={11 * inv} fill="transparent" className="cursor-grab" {...data("point", i, rRef)} data-testid="curve-anchor" />
          </g>;
        })}
      </g>;
    }))}
    {fitting.overlay}
    {repair.overlay}
    {points.overlay}
  </g>;
  const coordinate = anchor && (selected.kind === "in" || selected.kind === "out" ? anchor[selected.kind] : anchor.point);
  const controls = active && ring && anchor && <div className="flex max-h-[60vh] max-w-[min(38rem,calc(100vw-2rem))] flex-wrap items-center gap-1.5 overflow-y-auto rounded-md border bg-background/95 p-2 shadow-sm" aria-label="Curve editing controls" data-testid="curve-editor-controls">
    <div className="flex w-full items-center gap-2"><span className="text-sm font-medium">{repair.open ? "Edit outline" : fitting.open ? "Simplify outline" : "Edit outline · Bend edges"}</span>
      <HelpHint label="curve editing">Click an edge to add a point. Right-click a point to delete it. Drag edges to bend them into curves, points to move them, or handles to shape a curve. Shift-click adds points; drag empty space for a selection box. Select two endpoints for Repair section and preview a line or curve. Use Select points without a keyboard. Space-drag pans. Edits apply immediately; Undo restores them.</HelpHint>
      {!curves && <Button size="sm" variant="outline" onClick={() => { cancel(); points.clear(); setStarted(false); }}>Points</Button>}
      {onDone && <Button size="sm" variant="secondary" onClick={onDone}>Done</Button>}</div>
    <select aria-label="Curve contour" disabled={previewOpen} className="h-9 max-w-40 rounded border bg-background px-1 text-xs" value={`${ringRef.shapeIndex}:${ringRef.ringIndex}`}
      onChange={e => { const [shapeIndex, ringIndex] = e.target.value.split(":").map(Number); setRef({ shapeIndex, ringIndex }); setTarget({ kind: "edge", index: 0 }); }}>
      {value.flatMap((s, i) => [<option key={`${i}:-1`} value={`${i}:-1`}>Contour {i + 1}</option>, ...s.holes.map((_, j) => <option key={`${i}:${j}`} value={`${i}:${j}`}>Contour {i + 1} · Hole {j + 1}</option>)])}
    </select>
    {repair.open ? repair.controls : fitting.open ? fitting.controls : <>
    {points.selection.length < 2 && (selected.kind === "edge" ? <>
      <Button size="sm" variant="outline" onClick={() => edit({ kind: "curve", index: selected.index }, "Make contour curve")} title="Add curve handles to this edge; drag a handle or the edge to bend it.">Add handles</Button>
      <Button size="sm" variant="outline" onClick={() => edit({ kind: "straight", index: selected.index }, "Straighten contour edge")} title="Replace this curved edge with a straight line between its endpoints.">Straighten</Button>
      <Button size="sm" variant="outline" onClick={() => { edit({ kind: "split", index: selected.index, t: 0.5 }, "Split contour curve"); setTarget({ kind: "point", index: selected.index + 1 }); }} title="Add a point halfway along this edge. You can also click the edge where you want a point.">Add midpoint</Button>
      {[-1, 1].map(direction => <Button key={direction} size="sm" variant="outline" aria-label={direction < 0 ? "Bend curve outward" : "Bend curve inward"}
        onClick={() => { const a = ring[selected.index].point, b = ring[(selected.index + 1) % ring.length].point, d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          edit({ kind: "bend", index: selected.index, t: 0.5, delta: { x: -(b.y - a.y) / d * direction * tolerance * 40, y: (b.x - a.x) / d * direction * tolerance * 40 } }, "Bend contour curve"); }}>{direction < 0 ? "Bend −" : "Bend +"}</Button>)}
    </> : <>
      {selected.kind === "point" && <>
        <Button size="sm" variant={anchor.smooth ? "secondary" : "outline"} onClick={() => edit({ kind: "smooth", index: selected.index }, "Smooth curve anchor")}>Smooth</Button>
        <Button size="sm" variant={!anchor.smooth ? "secondary" : "outline"} onClick={() => edit({ kind: "corner", index: selected.index }, "Corner curve anchor")}>Corner</Button>
        <Button size="sm" variant="outline" disabled={ring.length <= 3} onClick={() => { edit({ kind: "delete", index: selected.index }, "Delete curve anchor"); setTarget({ kind: "point", index: Math.max(0, selected.index - 1) }); }}>Delete point</Button>
      </>}
      {coordinate && (["x", "y"] as const).map(axis => <label key={axis} className="flex items-center gap-1 text-xs">{axis.toUpperCase()}
        <Input key={`${selected.kind}:${selected.index}:${coordinate[axis]}`} aria-label={`Curve ${axis.toUpperCase()} coordinate`} type="number" step="any" className="h-9 w-20" defaultValue={Number(coordinate[axis].toFixed(4))}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={e => { const n = Number(e.target.value); if (!e.target.value || !Number.isFinite(n) || n === coordinate[axis] || n === Number(coordinate[axis].toFixed(4))) return;
            const point = { ...coordinate, [axis]: n }; edit(selected.kind === "in" || selected.kind === "out" ? { kind: "handle", side: selected.kind, index: selected.index, point } : { kind: "move", index: selected.index, point }, "Move curve anchor or handle"); }} />
      </label>)}
    </>)}
    {points.controls}
    <details className="w-full"><summary className="cursor-pointer py-2 text-xs font-medium">Choose a section or point by number</summary><div className="flex flex-wrap gap-2 py-2">    <select aria-label="Curve selection" className="h-9 max-w-36 rounded border bg-background px-1 text-xs" value={`${selected.kind}:${selected.index}`}
      onChange={e => { const [kind, index] = e.target.value.split(":"); setTarget({ kind: kind as Target["kind"], index: Number(index) }); }}>
      {ring.flatMap((a, i) => [<option key={`e${i}`} value={`edge:${i}`}>Edge {i + 1}</option>, <option key={`p${i}`} value={`point:${i}`}>Point {i + 1}</option>,
        ...(a.in ? [<option key={`i${i}`} value={`in:${i}`}>Point {i + 1} · In handle</option>] : []), ...(a.out ? [<option key={`o${i}`} value={`out:${i}`}>Point {i + 1} · Out handle</option>] : [])])}
    </select>
{fitting.actions}</div></details>
    </>}
    {error && <span role="alert" className="w-full text-xs text-destructive">{error}</span>}
  </div>;
  const startButton = enabled && !active && <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background/95 p-2 shadow-sm" role="group" aria-label="Outline editing style">
    <span className="text-sm font-medium">Edit outline</span><Button size="sm" variant="secondary" aria-pressed>Points</Button>
    {allowCurves && <Button size="sm" variant="outline" disabled={startDisabled} title={startDisabled ? startHint : "Drag an edge to turn it into a curve. Click to add a point; right-click a point to delete."}
      onClick={() => { setStarted(true); setError(null); }} data-testid="button-edit-curves">Bend edges</Button>}
    {onDone && <Button size="sm" variant="outline" onClick={onDone}>Done</Button>}
  </div>;
  return { active, overlay, controls, startButton, down, move, end, fitSection, repairSection, contextMenu,
    lostCapture: (e: ReactPointerEvent<SVGSVGElement>) => { points.lostCapture(e); if (gesture.current?.id === e.pointerId) cancel(); } };
}
