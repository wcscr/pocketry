import type { Outline, Point } from "@shared/geometry/types";
import type { MeasurementPaths } from "./layout-measure";

export interface ProjectedPoint extends Point { w: number; visible: boolean }

/** Pick the nearest projected segment in CSS pixels, then undo perspective
 * interpolation to return a point exactly on the original millimetre contour.
 * Split boundaries stay open and holes participate in the same nearest search.
 */
export function snapToProjectedContours(screen: Point, outlines: readonly Outline[], paths: MeasurementPaths,
  project: (point: Point) => ProjectedPoint, tolerancePx: number) {
  let best: { point: Point; screen: Point; distancePx: number } | null = null;
  const segment = (a: Point, b: Point) => {
    const pa = project(a), pb = project(b);
    if (!pa.visible || !pb.visible || pa.w <= 0 || pb.w <= 0) return;
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, ((screen.x - pa.x) * dx + (screen.y - pa.y) * dy) / square)) : 0;
    const target = { x: pa.x + dx * t, y: pa.y + dy * t };
    const distancePx = Math.hypot(target.x - screen.x, target.y - screen.y);
    if (distancePx > tolerancePx || (best && distancePx >= best.distancePx)) return;
    const localT = t * pa.w / ((1 - t) * pb.w + t * pa.w);
    best = { point: { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT }, screen: target, distancePx };
  };
  for (const outline of outlines) for (const shape of outline) for (const ring of [shape.outer, ...shape.holes]) {
    for (let index = 0; index < ring.length; index++) segment(ring[index], ring[(index + 1) % ring.length]);
  }
  for (const path of paths) for (let index = 1; index < path.length; index++) segment(path[index - 1], path[index]);
  return best as { point: Point; screen: Point; distancePx: number } | null;
}
