import { ensureOrientation, traceRingKey } from "@shared/geometry/rings";
import { getRing, removeRing } from "./outline";
import type { Outline, Ring, RingRef } from "@shared/geometry/types";
import type { CurveOutline, CurveRing } from "@shared/geometry/curves";

export { traceRingKey } from "@shared/geometry/rings";

/** A hole shared by overlapping pockets is one authored contour. Infer changed
 * references too: box/Shift selection does not necessarily select a ring. */
function sharedHoleReplacements<T>(before: Outline, previous: T[][], next: T[][],
  same: (a: T, b: T) => boolean): Map<string, T> {
  const replacements = new Map<string, T>();
  if (before.length !== next.length || before.some((s, i) => s.holes.length !== next[i].length)) return replacements;
  before.forEach((s, i) => s.holes.forEach((hole, j) => {
    if (!same(previous[i][j], next[i][j])) {
      const key = traceRingKey(hole);
      if (!replacements.has(key)) replacements.set(key, next[i][j]);
    }
  }));
  return replacements;
}

/** Mirror hole edits to duplicate references without depending on UI selection. */
export function syncHoleEdit(before: Outline, after: Outline,
  _ref: RingRef | null): Outline {
  const replacements = sharedHoleReplacements(before, before.map(s => s.holes), after.map(s => s.holes),
    (a, b) => traceRingKey(a) === traceRingKey(b));
  if (!replacements.size) return after;
  return after.map((part, i) => ({ ...part, holes: part.holes.map((hole, j) =>
    replacements.get(traceRingKey(before[i].holes[j])) ?? hole) }));
}

/** Preserve the exact edited handles in every reference to the same hole. */
export function syncCurveHoleEdits(before: Outline, previous: CurveOutline, after: CurveOutline): CurveOutline {
  if (previous.length !== before.length || previous.some((s, i) => s.holes.length !== before[i].holes.length)) return after;
  const replacements = sharedHoleReplacements<CurveRing>(before, previous.map(s => s.holes), after.map(s => s.holes),
    (a, b) => JSON.stringify(a) === JSON.stringify(b));
  if (!replacements.size) return after;
  return after.map((part, i) => ({ ...part, holes: part.holes.map((hole, j) =>
    replacements.get(traceRingKey(before[i].holes[j])) ?? hole) }));
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

/** A shared hole is one contour even when multiple pockets retain references. */
export function removeTraceRing(outline: Outline, ref: RingRef): Outline {
  if (ref.ringIndex < 0) return removeRing(outline, ref);
  const ring = getRing(outline, ref);
  if (!ring) return outline;
  const key = traceRingKey(ring);
  return outline.map(part => ({ ...part, holes: part.holes.filter(hole => traceRingKey(hole) !== key) }));
}
