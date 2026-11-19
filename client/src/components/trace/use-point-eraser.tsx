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

/** Local gesture preview. Only release commits geometry, once for the entire stroke. */
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
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      cancel();
    };
  }, [enabled, source, revision, scale, cancel]);
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
      setError("Some points were kept to preserve a valid contour.");
    }
  };
  const down = (e: CanvasEvent, pan: boolean) => {
    viewport.onPointerDown(e, { pan });
    if (e.pointerType === "touch" && e.isPrimary === false) { cancel(); return; }
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
    if (enabled && current && current.id === e.pointerId && current.source === source && current.revision === revision && e.type === "pointerup") {
      const p = fromClient(e.clientX, e.clientY);
      if (p && (p.x !== current.last.x || p.y !== current.last.y)) {
        const pending = new Map<number, CurvePointRef>();
        sweep(current, p, pending);
        applyHits(current, pending);
      }
      if (current.draft) onCommit(current.draft);
    }
    if (current?.id === e.pointerId) cancel();
    viewport.onPointerUp(e);
  };
  const dots = useMemo(() => enabled ? (draft?.anchors ?? source).flatMap(s => [s.outer, ...s.holes])
    .flatMap(r => r.map(({ point: p }) => `M${p.x} ${p.y}h0`)).join(" ") : "", [draft, source, enabled]);
  const overlay = enabled && <g pointerEvents="none">
    <path d={dots} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-primary"/>
    {cursor && <circle cx={cursor.x} cy={cursor.y} r={radius} strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="fill-destructive/10 stroke-destructive"/>}
  </g>;
  return { down, move, end, preview: draft?.polygon, error, overlay, cancel, leave: () => setCursor(null),
    lostCapture: (id: number) => { if (stroke.current?.id === id) cancel(); } };
}
