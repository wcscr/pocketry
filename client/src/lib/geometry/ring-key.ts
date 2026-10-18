import { ensureOrientation } from "@shared/geometry/rings";
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

/** Transform each authored hole once, retaining its references in every pocket. */
export function mapTraceRings(outline: Outline, transform: (ring: Ring, role: "pocket" | "hole") => Ring): Outline {
  const holes = new Map<string, Ring>();
  return outline.map(part => ({
    outer: ensureOrientation(transform(part.outer, "pocket"), 1),
    holes: part.holes.map(hole => {
      const key = traceRingKey(hole);
      let transformed = holes.get(key);
      if (!transformed) {
        transformed = ensureOrientation(transform(hole, "hole"), -1);
        holes.set(key, transformed);
      }
      return transformed;
    }),
  }));
}
