import { OUTER_RING, type Outline, type RingRef } from "@shared/geometry/types";
import type { Kernel } from "@/lib/manifold/runtime";
import { getRing, normalizeOutline, removeRing } from "./outline";
import { polygonsToOutline, toCrossSection } from "./offset";

/**
 * A pocket cuts material; a hole preserves it. Bake that choice into the ring
 * geometry so history, draft recovery and every export keep the same meaning.
 * Subtract from each pocket independently to retain separate editable objects.
 */
export function changeContourRole(kernel: Kernel, outline: Outline, ref: RingRef, role: "pocket" | "hole"): Outline {
  const ring = getRing(outline, ref);
  if (!ring) throw new Error("Select a contour first.");
  if ((ref.ringIndex === OUTER_RING) === (role === "pocket")) return outline;
  if (role === "pocket") {
    return normalizeOutline([...removeRing(outline, ref), { outer: ring, holes: [] }]);
  }

  const mask = toCrossSection(kernel, [{ outer: ring, holes: [] }]);
  const pockets = outline.filter((_, index) => index !== ref.shapeIndex);
  let overlapsPocket = false;
  const result = pockets.flatMap(pocket => {
    const shell = toCrossSection(kernel, [{ outer: pocket.outer, holes: [] }]);
    const overlap = kernel.arena.track(shell.intersect(mask));
    if (overlap.area() <= 1e-6) return [pocket];
    overlapsPocket = true;
    const source = toCrossSection(kernel, [pocket]);
    return polygonsToOutline(kernel.arena.track(source.subtract(mask)).toPolygons());
  });
  if (!overlapsPocket) throw new Error("A hole must overlap another pocket. Move this contour inside a pocket first.");
  if (result.length === 0) throw new Error("This hole would remove every pocket. Keep a surrounding pocket outline.");
  return normalizeOutline(result);
}
