import { OUTER_RING, type Outline, type RingRef } from "@shared/geometry/types";
import { traceRingKey } from "./ring-key";
import type { Kernel } from "@/lib/manifold/runtime";
import { getRing, normalizeOutline } from "./outline";
import { polygonsToOutline, toCrossSection } from "./offset";

/**
 * A pocket cuts material; a hole preserves it. Keep the authored hole ring,
 * including the portion crossing a shell, so Bin can receive an editable object.
 * Positive winding clips the exclusion to its pocket when building solids.
 */
export function changeContourRole(kernel: Kernel, outline: Outline, ref: RingRef, role: "pocket" | "hole"): Outline {
  const ring = getRing(outline, ref);
  if (!ring) throw new Error("Select a contour first.");
  if ((ref.ringIndex === OUTER_RING) === (role === "pocket")) return outline;
  if (role === "pocket") {
    const key = traceRingKey(ring);
    return normalizeOutline([...outline.map(part => ({ ...part, holes: part.holes.filter(hole => traceRingKey(hole) !== key) })),
      { outer: ring, holes: [] }]);
  }

  const mask = toCrossSection(kernel, [{ outer: ring, holes: [] }]);
  const pockets = outline.filter((_, index) => index !== ref.shapeIndex);
  let overlapsPocket = false;
  let remainingArea = 0;
  const result = pockets.flatMap(pocket => {
    const shell = toCrossSection(kernel, [{ outer: pocket.outer, holes: [] }]);
    const overlap = kernel.arena.track(shell.intersect(mask));
    if (overlap.area() <= 1e-6) { remainingArea += shell.area(); return [pocket]; }
    overlapsPocket = true;
    const source = toCrossSection(kernel, [pocket]);
    remainingArea += kernel.arena.track(source.subtract(mask)).area();
    return [{ ...pocket, holes: [...pocket.holes, ring] }];
  });
  if (!overlapsPocket) throw new Error("A hole must overlap another pocket. Move this contour inside a pocket first.");
  if (remainingArea <= 1e-6) throw new Error("This hole would remove every pocket. Keep a surrounding pocket outline.");
  return normalizeOutline(result);
}

/** Resolve editable exclusions once for flat exports, even across overlapping shells. */
export function traceMaterialOutline(kernel: Kernel, outline: Outline): Outline {
  const shells = toCrossSection(kernel, outline.map(part => ({ outer: part.outer, holes: [] })));
  const holes = outline.flatMap(part => part.holes.map(outer => ({ outer, holes: [] })));
  if (!holes.length) return polygonsToOutline(shells.toPolygons());
  const mask = toCrossSection(kernel, holes);
  return polygonsToOutline(kernel.arena.track(shells.subtract(mask)).toPolygons());
}
