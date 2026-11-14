import { curveRing, mapCurves, type CurveOutline } from "./curves";
import type { Point, RingRef } from "./types";

export interface CurvePointRef extends RingRef { index: number }
export const pointSelectionKey = (p: CurvePointRef) => `${p.shapeIndex}:${p.ringIndex}:${p.index}`;
export function curvePoints(source: CurveOutline): CurvePointRef[] {
  return source.flatMap((s, shapeIndex) => [s.outer, ...s.holes].flatMap((r, i) => r.map((_, index) => ({ shapeIndex, ringIndex: i - 1, index }))));
}

/** Move anchors and their handles together, preserving unrelated geometry. */
export function moveCurvePoints(source: CurveOutline, selection: CurvePointRef[], delta: Point): CurveOutline {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error("Invalid point movement.");
  const result = mapCurves(source, p => ({ ...p }));
  for (const ref of new Map(selection.map(p => [pointSelectionKey(p), p])).values()) {
    const anchor = curveRing(result, ref)?.[ref.index];
    if (!anchor) throw new Error("The selected points changed. Select them again.");
    for (const key of ["point", "in", "out"] as const) if (anchor[key]) anchor[key] = { x: anchor[key]!.x + delta.x, y: anchor[key]!.y + delta.y };
  }
  return result;
}

/** All-or-nothing deletion; never reduce any closed contour below three nodes. */
export function deleteCurvePoints(source: CurveOutline, selection: CurvePointRef[]): CurveOutline {
  const chosen = new Set(selection.map(pointSelectionKey));
  if (curvePoints(source).filter(p => chosen.has(pointSelectionKey(p))).length !== chosen.size) throw new Error("The selected points changed. Select them again.");
  const result = mapCurves(source, p => ({ ...p }));
  for (let shapeIndex = 0; shapeIndex < result.length; shapeIndex++) for (const ringIndex of [-1, ...result[shapeIndex].holes.map((_, i) => i)]) {
    const ring = curveRing(result, { shapeIndex, ringIndex })!;
    const removed = ring.map((_, index) => chosen.has(pointSelectionKey({ shapeIndex, ringIndex, index })));
    if (ring.length - removed.filter(Boolean).length < 3) throw new Error("Keep at least three points in each outline.");
    ring.forEach((a, i) => { if (!removed[i] && (removed[(i + 1) % ring.length] || removed[(i + ring.length - 1) % ring.length])) a.smooth = false; });
    const kept = ring.filter((_, i) => !removed[i]);
    if (ringIndex === -1) result[shapeIndex].outer = kept; else result[shapeIndex].holes[ringIndex] = kept;
  }
  return result;
}

/** Fitting consumes one contiguous run, including a run across the ring seam. */
export function selectedCurveSection(source: CurveOutline, selection: CurvePointRef[]): { ref: RingRef; start: number; end: number } | undefined {
  if (selection.length < 3) return;
  const ref = selection[0], ring = curveRing(source, ref);
  if (!ring || selection.some(p => p.shapeIndex !== ref.shapeIndex || p.ringIndex !== ref.ringIndex)) return;
  const selected = new Set(selection.map(p => p.index));
  if (selected.size !== selection.length || selection.some(p => !ring[p.index])) return;
  const start = selected.size === ring.length ? 0 : selection.find(p => !selected.has((p.index + ring.length - 1) % ring.length))?.index;
  if (start === undefined) return;
  for (let i = 0; i < selected.size; i++) if (!selected.has((start + i) % ring.length)) return;
  return { ref: { shapeIndex: ref.shapeIndex, ringIndex: ref.ringIndex }, start, end: (start + selected.size - 1) % ring.length };
}
