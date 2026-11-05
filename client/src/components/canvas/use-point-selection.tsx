import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { curveControls, curvePath, curveRing, evaluateCurve, type CurveOutline } from "@shared/geometry/curves";
import { curvePoints, deleteCurvePoints, moveCurvePoints, pointSelectionKey, selectedCurveSection, type CurvePointRef } from "@shared/geometry/curve-point-selection";
import { distanceToSegment } from "@shared/geometry/rings";
import type { Point } from "@shared/geometry/types";
import type { ViewportPointerHandlers } from "@/hooks/use-viewport-transform";
import { canHandleCanvasShortcut } from "@/lib/canvas-keyboard";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";

interface Options {
  source: CurveOutline;
  enabled: boolean;
  contextKey: string;
  scale: number;
  fromClient: (x: number, y: number) => Point | null;
  toCanvas: (p: Point) => Point;
  viewport: ViewportPointerHandlers;
  panRequested?: boolean;
  onCommit: (source: CurveOutline, label: string) => void;
  onSmoothSection?: (section: NonNullable<ReturnType<typeof selectedCurveSection>>) => void;
  onBlankClick?: () => void;
  onPinchStart?: () => void;
}
interface Gesture {
  id: number; kind: "box" | "move"; source: CurveOutline; start: Point; client: Point;
  selection: CurvePointRef[]; toggle?: CurvePointRef; moved: boolean; draft?: CurveOutline;
}

/** Shared node selection for polygon and curve editors. Selection is UI-only;
 * group drags commit once on release and use the source coordinate frame. */
export function usePointSelection(options: Options) {
  const { source, enabled, contextKey, scale, fromClient, toCanvas, viewport, panRequested, onCommit, onSmoothSection } = options;
  const [selection, setSelection] = useState<CurvePointRef[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [box, setBox] = useState<{ start: Point; end: Point }>();
  const [draft, setDraft] = useState<CurveOutline>();
  const [error, setError] = useState<string>();
  const gesture = useRef<Gesture>();
  const pointers = useRef(new Set<number>());
  const pinching = useRef(false);
  const capture = useRef<SVGSVGElement>();
  const expectedSource = useRef<CurveOutline>();
  const points = useMemo(() => curvePoints(source), [source]);
  const chosen = new Set(selection.map(pointSelectionKey));
  const section = selectedCurveSection(source, selection);
  const cancel = () => {
    const g = gesture.current; gesture.current = undefined; setBox(undefined); setDraft(undefined);
    if (g && capture.current?.hasPointerCapture?.(g.id)) capture.current.releasePointerCapture(g.id);
  };
  const clear = () => { cancel(); setSelection(previous => previous.length ? [] : previous); setError(undefined); };
  useEffect(() => {
    const retain = expectedSource.current && JSON.stringify(expectedSource.current) === JSON.stringify(source);
    expectedSource.current = undefined; cancel(); if (!retain) setSelection(previous => previous.length ? [] : previous); setError(undefined);
  }, [source]);
  useEffect(() => { clear(); setSelectMode(false); pointers.current.clear(); pinching.current = false; }, [enabled, contextKey]);
  useEffect(() => { cancel(); }, [scale]);
  useEffect(() => {
    const blur = () => { cancel(); pointers.current.clear(); pinching.current = false; };
    window.addEventListener("blur", blur); window.addEventListener("resize", blur);
    return () => { window.removeEventListener("blur", blur); window.removeEventListener("resize", blur); };
  }, []);
  const remove = () => {
    if (!enabled || !selection.length) return;
    try { const next = deleteCurvePoints(source, selection); onCommit(next, selection.length === 1 ? "Delete outline point" : "Delete outline points"); clear(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete points."); }
  };
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (!canHandleCanvasShortcut(event)) return;
      if (event.key === "Escape" && (gesture.current || selection.length || selectMode)) {
        event.preventDefault(); event.stopImmediatePropagation(); clear(); setSelectMode(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault(); event.stopImmediatePropagation(); setSelection(points);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selection.length) {
        event.preventDefault(); event.stopImmediatePropagation(); remove();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [enabled, selection, selectMode, source]);
  const toggle = (ref: CurvePointRef) => setSelection(previous => previous.some(p => pointSelectionKey(p) === pointSelectionKey(ref))
    ? previous.filter(p => pointSelectionKey(p) !== pointSelectionKey(ref)) : [...previous, ref]);
  const down = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (!enabled) return false;
    if (event.pointerType === "touch") pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) {
      cancel(); pinching.current = true; options.onPinchStart?.(); viewport.onPointerDown(event, { pan: false }); return true;
    }
    if (event.button !== 0 || panRequested || event.altKey || event.ctrlKey || event.metaKey) return false;
    const p = fromClient(event.clientX, event.clientY); if (!p) return false;
    if ((event.target as Element).closest('[data-curve-kind="in"], [data-curve-kind="out"]')) { clear(); return false; }
    const radius = (event.pointerType === "touch" ? 22 : 11) / Math.max(scale, 1e-6);
    let hit: CurvePointRef | undefined, distance = radius;
    for (const ref of points) {
      const q = curveRing(source, ref)![ref.index].point, d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < distance) { hit = ref; distance = d; }
    }
    if (hit && event.shiftKey) { event.preventDefault(); toggle(hit); return true; }
    const selectedHit = hit && chosen.has(pointSelectionKey(hit));
    if (hit && !selectMode && !(selectedHit && selection.length > 1)) {
      setSelection([hit]); return false; // The existing single-point editor owns this drag.
    }
    if (!hit && !selectMode && !event.shiftKey) {
      // Edge drags keep their established bend/add behavior. Empty-space drags
      // select nodes; Space or the hand tool explicitly pans instead.
      if ((event.target as Element).closest("[data-curve-kind]")) { setSelection([]); return false; }
      for (const ref of points) {
        const ring = curveRing(source, ref)!, cs = curveControls(ring, ref.index), count = ring[ref.index].out || ring[(ref.index + 1) % ring.length].in ? 12 : 1;
        let previous = cs[0];
        for (let i = 1; i <= count; i++) { const next = evaluateCurve(cs, i / count);
          if (distanceToSegment(p, previous, next) <= radius) { setSelection([]); return false; } previous = next;
        }
      }
    }
    event.preventDefault(); event.stopPropagation();
    const selected = hit ? selectedHit ? selection : [...selection, hit] : event.shiftKey ? selection : [];
    gesture.current = { id: event.pointerId, kind: hit ? "move" : "box", source, start: p,
      client: { x: event.clientX, y: event.clientY }, selection: selected, toggle: selectMode ? hit : undefined, moved: false };
    capture.current = event.currentTarget; event.currentTarget.setPointerCapture?.(event.pointerId);
    viewport.onPointerDown(event, { pan: false });
    return true;
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (enabled && pinching.current) { viewport.onPointerMove(event); return true; }
    const g = gesture.current; if (!enabled || !g || event.pointerId !== g.id) return false;
    viewport.onPointerMove(event);
    if (pointers.current.size > 1) { cancel(); return false; }
    const p = fromClient(event.clientX, event.clientY); if (!p) return true;
    if (!g.moved && Math.hypot(event.clientX - g.client.x, event.clientY - g.client.y) < (event.pointerType === "touch" ? 8 : 3)) return true;
    g.moved = true;
    if (g.kind === "box") {
      setBox({ start: g.start, end: p });
      // The rectangle belongs to the screen. A rotated, mirrored or stretched
      // Bin pocket sees a parallelogram in its own source coordinates.
      const across = fromClient(event.clientX, g.client.y), down = fromClient(g.client.x, event.clientY);
      if (!across || !down) return true;
      const u = { x: across.x - g.start.x, y: across.y - g.start.y }, v = { x: down.x - g.start.x, y: down.y - g.start.y };
      const determinant = u.x * v.y - u.y * v.x;
      const inside = points.filter(ref => { const q = curveRing(source, ref)![ref.index].point;
        if (Math.abs(determinant) < 1e-12) return false;
        const dx = q.x - g.start.x, dy = q.y - g.start.y;
        const a = (dx * v.y - dy * v.x) / determinant, b = (u.x * dy - u.y * dx) / determinant;
        return a >= -1e-10 && a <= 1 + 1e-10 && b >= -1e-10 && b <= 1 + 1e-10; });
      setSelection([...new Map([...g.selection, ...inside].map(ref => [pointSelectionKey(ref), ref])).values()]);
    } else {
      setSelection(g.selection); g.draft = moveCurvePoints(g.source, g.selection, { x: p.x - g.start.x, y: p.y - g.start.y }); setDraft(g.draft);
    }
    return true;
  };
  const end = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    pointers.current.delete(event.pointerId);
    if (pinching.current) { viewport.onPointerUp(event); if (!pointers.current.size) pinching.current = false; return true; }
    const g = gesture.current; if (!g || g.id !== event.pointerId) return false;
    viewport.onPointerUp(event);
    if (event.type !== "pointercancel") {
      if (g.draft) { expectedSource.current = g.draft; onCommit(g.draft, "Move outline points"); }
      else if (!g.moved && g.toggle) toggle(g.toggle);
      else if (!g.moved && g.kind === "box") { setSelection(g.selection); if (!g.selection.length) options.onBlankClick?.(); }
    }
    cancel(); return true;
  };
  const display = draft ?? source;
  const overlay = enabled && <g pointerEvents="none" data-testid="point-selection-overlay">
    {draft && display.flatMap(s => [s.outer, ...s.holes]).map((r, i) => <path key={i} d={curvePath(r, toCanvas)} fill="none" className="stroke-primary" strokeWidth={3} vectorEffect="non-scaling-stroke" />)}
    {selection.map(ref => { const anchor = curveRing(display, ref)?.[ref.index]; if (!anchor) return null;
      const p = toCanvas(anchor.point), r = 5 / Math.max(scale, 1e-6);
      return <rect key={pointSelectionKey(ref)} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} className="fill-primary stroke-background" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="selected-outline-point" />; })}
    {box && (() => { const a = toCanvas(box.start), b = toCanvas(box.end); return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} className="fill-primary/10 stroke-primary" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />; })()}
  </g>;
  const controls = enabled && <>
    <Button size="sm" variant={selectMode ? "default" : "outline"} aria-pressed={selectMode} onClick={() => { cancel(); setSelectMode(value => !value); }}>Select points</Button>
    <HelpHint label="selecting points">Shift-click points to add or remove them. Drag empty space for a selection box; Shift adds to the current selection. Without a keyboard, turn on Select points and tap points to toggle them. Drag selected points to move the group. Delete removes the selection, and Escape clears it. Space-drag pans.</HelpHint>
    {!!selection.length && <span className="text-xs" role="status">{selection.length} {selection.length === 1 ? "point" : "points"} selected</span>}
    {!!selection.length && <Button size="sm" variant="outline" onClick={clear}>Clear selection</Button>}
    {selection.length > 1 && <Button size="sm" variant="outline" onClick={remove}>Delete points</Button>}
    {selection.length >= 3 && onSmoothSection && <Button size="sm" variant="outline" disabled={!section} title={section ? "Simplify this continuous section with a curve-fitting preview." : "Select adjacent points on one outline."} onClick={() => { if (section) onSmoothSection(section); }}>Simplify section</Button>}
    {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
  </>;
  return { down, move, end, cancel, clear, overlay, controls, selection, draft,
    lostCapture: (event: ReactPointerEvent<SVGSVGElement>) => { if (gesture.current?.id === event.pointerId) cancel(); } };
}
