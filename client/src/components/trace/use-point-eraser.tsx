import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { curvePoints, deleteCurvePoints, type CurvePointRef } from "@shared/geometry/curve-point-selection";
import { curveRing, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import { validateFittedContour } from "@shared/geometry/curve-fit";
import { distanceToSegment } from "@shared/geometry/rings";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import type { ViewportPointerHandlers } from "@/hooks/use-viewport-transform";
import { syncCurveHoleEdits, traceRingKey } from "@/lib/geometry/ring-key";
import { sameRingRef } from "@/lib/geometry/outline";
import { compareRingHitOrder } from "@/lib/geometry/hit-test";

type CanvasEvent = PointerEvent<SVGSVGElement>;
interface Stroke {
  id: number;
  target: SVGSVGElement;
  source: CurveOutline;
  revision: object;
  last: Point;
  ring: RingRef | null;
  removed: Map<number, CurvePointRef>;
  draft?: CurveOutline;
}

const RADIUS_PX = 10;
const KEPT_POINTS = "Some points were kept to preserve a valid contour.";
const OUTLINE_CHANGED = "The outline changed during that stroke, so no points were erased.";
const SECOND_TOUCH = "A second touch canceled that stroke, so no points were erased.";

/**
 * Local gesture preview. A stroke commits its geometry once, when it ends: on
 * release, or when something other than the user's own cancel interrupts it.
 */
export function usePointEraser({ enabled, source, outline, activeRing, revision, scale, tolerance, fromClient, viewport, onCommit }: {
  enabled: boolean; source: CurveOutline; outline: Outline; revision: object; scale: number; tolerance: number;
  activeRing: RingRef | null;
  fromClient: (x: number, y: number) => Point | null;
  viewport: ViewportPointerHandlers;
  onCommit: (next: CurveOutline) => void;
}) {
  const stroke = useRef<Stroke | null>(null);
  const [draft, setDraft] = useState<{ anchors: CurveOutline; polygon: Outline }>();
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<Point | null>(null);
  const radius = RADIUS_PX / scale;
  const cancel = useCallback(() => {
    const current = stroke.current;
    stroke.current = null;
    if (current?.target.hasPointerCapture?.(current.id)) current.target.releasePointerCapture(current.id);
    setDraft(undefined);
    setCursor(null);
  }, []);
  // Ends the stroke. The preview only ever holds validated geometry, so `keep`
  // saves exactly the deletions it shows. A stroke that cannot be saved says so
  // instead of silently restoring its points.
  const finish = (keep: boolean, dropped: string) => {
    const current = stroke.current;
    if (current?.draft) {
      if (keep && enabled && current.source === source && current.revision === revision) onCommit(current.draft);
      else setError(dropped);
    }
    cancel();
  };
  // Window listeners and the zoom effect need the latest render's commit target.
  const interrupted = useRef(() => {});
  useEffect(() => { interrupted.current = () => finish(true, OUTLINE_CHANGED); });
  // The contour or tool changed underneath the stroke, for example through
  // Undo. Its preview no longer describes the current outline.
  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (stroke.current?.draft) setError(OUTLINE_CHANGED);
      cancel();
    };
  }, [enabled, source, revision, cancel]);
  // A browser can end a press without a release: the window loses focus or is
  // resized, or the view zooms under a held pointer. Keep what the preview shows.
  useEffect(() => interrupted.current(), [scale]);
  useEffect(() => {
    if (!enabled) return;
    const interrupt = () => interrupted.current();
    window.addEventListener("blur", interrupt);
    window.addEventListener("resize", interrupt);
    return () => {
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("resize", interrupt);
    };
  }, [enabled]);
  useEffect(() => setError(""), [enabled]);

  const anchors = useMemo(() => enabled ? curvePoints(source).map(ref => ({
    ref, p: curveRing(source, ref)![ref.index].point,
  })) : [], [enabled, source]);
  const sweep = (current: Stroke, to: Point, pending: Map<number, CurvePointRef>) => {
    const from = current.last, dx = to.x - from.x, dy = to.y - from.y;
    current.last = to;
    const hits = [];
    for (const { ref, p } of anchors) {
      if (current.ring && (!sameRingRef(current.ring, ref) || current.removed.has(ref.index))) continue;
      const distance = distanceToSegment(p, from, to);
      if (distance <= radius) hits.push({ ref, along: (p.x - from.x) * dx + (p.y - from.y) * dy, distance });
    }
    // Lock to the first touched ring so a stroke along a thin wall cannot
    // also erase points from a nearby hole or another tool.
    hits.sort((a, b) => a.along - b.along || a.distance - b.distance || compareRingHitOrder(a.ref, b.ref, activeRing));
    for (const { ref } of hits) {
      current.ring ??= ref;
      if (!sameRingRef(current.ring, ref)) continue;
      pending.set(ref.index, ref);
    }
  };
  // Preview only geometry that can actually be committed. Most events need one
  // check. If a batch crosses a hole or collapses a ring, isolate safe hits
  // without throwing away points already erased earlier in the stroke.
  const applyHits = (current: Stroke, pending: Map<number, CurvePointRef>) => {
    if (!pending.size || !current.ring) return;
    const { shapeIndex, ringIndex } = current.ring;
    const capacity = curveRing(source, current.ring)!.length - 3;
    const owners: RingRef[] = [];
    if (ringIndex < 0) owners.push(current.ring);
    else {
      const key = traceRingKey(outline[shapeIndex].holes[ringIndex]);
      outline.forEach((s, i) => s.holes.forEach((hole, j) => {
        if (traceRingKey(hole) === key) owners.push({ shapeIndex: i, ringIndex: j });
      }));
    }
    let attempts = 0, work = 0;
    const budget = () => {
      if (++work > 5_000_000) throw new Error("Contour validation budget exceeded.");
    };
    const apply = (hits: CurvePointRef[]) => {
      if (++attempts > 12 || work > 5_000_000 || current.removed.size >= capacity) return;
      const added = hits.slice(0, capacity - current.removed.size);
      for (const ref of added) current.removed.set(ref.index, ref);
      try {
        let anchors = deleteCurvePoints(source, [...current.removed.values()]);
        if (ringIndex >= 0) anchors = syncCurveHoleEdits(outline, source, anchors);
        for (const owner of owners) {
          validateFittedContour([source[owner.shapeIndex]], [anchors[owner.shapeIndex]],
            { shapeIndex: 0, ringIndex: owner.ringIndex }, tolerance, budget);
        }
        const polygon = sampleCurves(anchors, tolerance);
        current.draft = anchors;
        setDraft({ anchors, polygon });
      } catch {
        for (const ref of added) current.removed.delete(ref.index);
        if (hits.length === 1 || work > 5_000_000) return;
        const mid = Math.ceil(hits.length / 2);
        apply(hits.slice(0, mid));
        apply(hits.slice(mid));
      }
    };
    const before = current.removed.size;
    apply([...pending.values()]);
    if (current.removed.size - before < pending.size) {
      setError(KEPT_POINTS);
    }
  };
  const down = (e: CanvasEvent, pan: boolean) => {
    viewport.onPointerDown(e, { pan });
    // A second finger starts a pinch, so the first finger's stroke was not an edit.
    if (e.pointerType === "touch" && e.isPrimary === false) { finish(false, SECOND_TOUCH); return; }
    if (!enabled || pan || e.button !== 0 || stroke.current) return;
    const p = fromClient(e.clientX, e.clientY);
    if (!p) return;
    setError("");
    const current: Stroke = { id: e.pointerId, target: e.currentTarget, source, revision, last: p, ring: null, removed: new Map() };
    stroke.current = current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setCursor(p);
    const pending = new Map<number, CurvePointRef>();
    sweep(current, p, pending);
    applyHits(current, pending);
  };
  const move = (e: CanvasEvent) => {
    viewport.onPointerMove(e);
    const p = fromClient(e.clientX, e.clientY);
    setCursor(p);
    const current = stroke.current;
    if (!enabled || !current || current.id !== e.pointerId || current.source !== source || current.revision !== revision || !p) return;
    const pending = new Map<number, CurvePointRef>();
    for (const sample of e.nativeEvent.getCoalescedEvents?.() ?? []) {
      const position = fromClient(sample.clientX, sample.clientY);
      if (position) sweep(current, position, pending);
    }
    sweep(current, p, pending);
    applyHits(current, pending);
  };
  const end = (e: CanvasEvent) => {
    const current = stroke.current;
    if (current?.id === e.pointerId) {
      // A release finishes the sweep at the pointer. A canceled press reports no
      // reliable position, so it keeps the preview as it stands.
      if (e.type === "pointerup" && enabled && current.source === source && current.revision === revision) {
        const p = fromClient(e.clientX, e.clientY);
        if (p && (p.x !== current.last.x || p.y !== current.last.y)) {
          const pending = new Map<number, CurvePointRef>();
          sweep(current, p, pending);
          applyHits(current, pending);
        }
      }
      finish(true, OUTLINE_CHANGED);
    }
    viewport.onPointerUp(e);
  };
  const dots = useMemo(() => enabled ? (draft?.anchors ?? source).flatMap(s => [s.outer, ...s.holes])
    .flatMap(r => r.map(({ point: p }) => `M${p.x} ${p.y}h0`)).join(" ") : "", [draft, source, enabled]);
  const overlay = enabled && <g pointerEvents="none">
    <path d={dots} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-primary"/>
    {cursor && <circle cx={cursor.x} cy={cursor.y} r={radius} strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="fill-destructive/10 stroke-destructive"/>}
  </g>;
  // `cancel` is the user's own discard (Escape, or choosing another tool) and stays silent.
  return { down, move, end, preview: draft?.polygon, error, overlay, cancel, leave: () => setCursor(null),
    lostCapture: (id: number) => { if (stroke.current?.id === id) finish(true, OUTLINE_CHANGED); } };
}
