import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { curvePoints, deleteCurvePoints, type CurvePointRef } from "@shared/geometry/curve-point-selection";
import { curveRing, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import { validateFittedContour } from "@shared/geometry/curve-fit";
import { distanceToSegment } from "@shared/geometry/rings";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import type { ViewportPointerHandlers } from "@/hooks/use-viewport-transform";
import { syncCurveHoleEdits, traceRingKey } from "@/lib/geometry/ring-key";
import { sameRingRef } from "@/lib/geometry/outline";

type CanvasEvent = PointerEvent<SVGSVGElement>;
interface Stroke {
  id: number;
  target: SVGSVGElement;
  last: Point;
  ring: RingRef | null;
  removed: Map<number, CurvePointRef>;
  draft?: CurveOutline;
}

const RADIUS_PX = 12;

/** Local gesture preview. Only release commits geometry, once for the entire stroke. */
export function usePointEraser({ enabled, source, outline, revision, scale, tolerance, fromClient, viewport, onCommit }: {
  enabled: boolean; source: CurveOutline; outline: Outline; revision: object; scale: number; tolerance: number;
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
  useEffect(() => setError(""), [enabled, source]);

  const anchors = useMemo(() => enabled ? curvePoints(source).map(ref => ({
    ref, p: curveRing(source, ref)![ref.index].point,
  })) : [], [enabled, source]);
  const sweep = (current: Stroke, to: Point) => {
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
    hits.sort((a, b) => a.along - b.along || a.distance - b.distance);
    for (const { ref } of hits) {
      current.ring ??= ref;
      if (!sameRingRef(current.ring, ref)) continue;
      if (current.removed.size >= curveRing(source, ref)!.length - 3) break;
      current.removed.set(ref.index, ref);
    }
  };
  // Coalesced pointer samples can hit many anchors in one frame. Rebuild the
  // polygon only once per delivered event, and only if the hit set changed.
  const previewStroke = (current: Stroke, before: number) => {
    if (current.removed.size === before) return;
    try {
      let anchors = deleteCurvePoints(source, [...current.removed.values()]);
      if (current.ring && current.ring.ringIndex >= 0) anchors = syncCurveHoleEdits(outline, source, anchors);
      const polygon = sampleCurves(anchors, tolerance);
      current.draft = anchors;
      setDraft({ anchors, polygon });
    } catch {
      cancel();
      setError("This stroke could not be applied. Try erasing fewer points.");
    }
  };
  const down = (e: CanvasEvent, pan: boolean) => {
    viewport.onPointerDown(e, { pan });
    if (e.pointerType === "touch" && e.isPrimary === false) { cancel(); return; }
    if (pan || e.button !== 0 || stroke.current) return;
    const p = fromClient(e.clientX, e.clientY);
    if (!p) return;
    setError("");
    const current: Stroke = { id: e.pointerId, target: e.currentTarget, last: p, ring: null, removed: new Map() };
    stroke.current = current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setCursor(p);
    sweep(current, p);
    previewStroke(current, 0);
  };
  const move = (e: CanvasEvent) => {
    viewport.onPointerMove(e);
    const p = fromClient(e.clientX, e.clientY);
    setCursor(p);
    const current = stroke.current;
    if (!current || current.id !== e.pointerId || !p) return;
    const before = current.removed.size;
    for (const sample of e.nativeEvent.getCoalescedEvents?.() ?? []) {
      const position = fromClient(sample.clientX, sample.clientY);
      if (position) sweep(current, position);
    }
    sweep(current, p);
    previewStroke(current, before);
  };
  const end = (e: CanvasEvent) => {
    const current = stroke.current;
    if (current && current.id === e.pointerId && e.type === "pointerup") {
      const p = fromClient(e.clientX, e.clientY);
      const before = current.removed.size;
      if (p) sweep(current, p);
      previewStroke(current, before);
      if (current === stroke.current && current.draft && current.ring) {
        // Pocket outlines may overlap. A shared hole must still fit every
        // pocket that references it after the stroke.
        const { shapeIndex, ringIndex } = current.ring;
        const edited = current.draft;
        let work = 0;
        const validateRing = (owner: number, ring: number) => {
          validateFittedContour([source[owner]], [edited[owner]], { shapeIndex: 0, ringIndex: ring }, tolerance, () => {
            if (++work > 5_000_000) throw new Error("Contour validation budget exceeded.");
          });
        };
        try {
          if (ringIndex < 0) validateRing(shapeIndex, ringIndex);
          else {
            const sharedKey = traceRingKey(outline[shapeIndex].holes[ringIndex]);
            outline.forEach((s, i) => s.holes.forEach((hole, j) => {
              if (traceRingKey(hole) === sharedKey) validateRing(i, j);
            }));
          }
          onCommit(current.draft);
        } catch {
          setError("This stroke would leave an invalid or overly complex contour. Try erasing fewer points.");
        }
      }
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
