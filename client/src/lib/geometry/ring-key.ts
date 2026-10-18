import type { Outline, Ring, RingRef } from "@shared/geometry/types";

/** A canonical cyclic ring key, independent of winding and starting vertex. */
export function traceRingKey(ring: Ring): string {
  const points = ring.map(p => `${p.x},${p.y}`);
  const start = points.reduce((best, p, i) => p < points[best] ? i : best, 0);
  const forward = points.map((_, i) => points[(start + i) % points.length]).join(";");
  const reverse = points.map((_, i) => points[(start - i + points.length) % points.length]).join(";");
  return forward < reverse ? forward : reverse;
}

/** Mirror a selected hole edit to its duplicate references in overlapping pockets. */
export function syncHoleEdit(before: Outline, after: Outline,
  ref: RingRef | null): Outline {
  if (!ref || ref.ringIndex < 0 || before.length !== after.length) return after;
  const previous = before[ref.shapeIndex]?.holes[ref.ringIndex];
  const changed = after[ref.shapeIndex]?.holes[ref.ringIndex];
  if (!previous || !changed || traceRingKey(previous) === traceRingKey(changed)) return after;
  const key = traceRingKey(previous);
  return after.map(part => ({ ...part, holes: part.holes.map(hole => traceRingKey(hole) === key ? changed : hole) }));
}
