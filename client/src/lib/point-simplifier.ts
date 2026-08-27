import type { Point } from "@shared/geometry/types";

import { simplifyRing } from "./geometry/simplify";

/**
 * @deprecated Use `simplifyRing` from `@/lib/geometry/simplify` directly.
 *
 * This function used to compute a convex hull before running
 * Ramer–Douglas–Peucker, which discarded every bay and notch in a tool outline
 * by construction — the root cause of the app's concave-detection problem. The
 * hull is gone; this now delegates to the closed-aware simplifier and exists
 * only so call sites can migrate incrementally.
 */
export function simplifyPoints(points: Point[], tolerance = 5): Point[] {
  return simplifyRing(points, tolerance);
}
