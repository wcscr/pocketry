import type { Point } from "./types";

/**
 * Minimum-area oriented bounding box, for auto-arrange: rotating a tool to
 * its OBB angle before shelf packing is what lets a diagonal wrench lie
 * down flat instead of blocking out its huge axis-aligned bbox.
 *
 * Classic rotating-calipers fact: the min-area rectangle shares an edge
 * direction with the convex hull, so scanning hull edges is exact, not a
 * heuristic. Dependency-free on purpose — this sits in shared/ next to the
 * ring maths.
 */

/** Monotone-chain convex hull, CCW, no repeated last point. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  // Dedupe exact duplicates so collinear handling stays simple.
  const unique = sorted.filter(
    (p, i) => i === 0 || p.x !== sorted[i - 1].x || p.y !== sorted[i - 1].y,
  );
  if (unique.length <= 2) return unique;

  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface MinAreaObb {
  /**
   * Rotation (degrees, CCW-positive) that axis-aligns the box in landscape:
   * after rotating the input points by this angle, their bbox is
   * `widthMm × heightMm` with `widthMm ≥ heightMm`.
   */
  angleDeg: number;
  widthMm: number;
  heightMm: number;
  /** Box centre in the input frame. */
  center: Point;
}

/**
 * The minimum-area OBB of a point set. Degenerate inputs (a point, a
 * segment) fall back to the axis-aligned box of whatever is there.
 */
export function minAreaObb(points: readonly Point[]): MinAreaObb {
  const hull = convexHull(points);

  if (hull.length < 3) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points.length > 0 ? points : [{ x: 0, y: 0 }]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    if (height > width) {
      return { angleDeg: 90, widthMm: height, heightMm: width, center };
    }
    return { angleDeg: 0, widthMm: width, heightMm: height, center };
  }

  let best: { area: number; theta: number; u0: number; u1: number; v0: number; v1: number } | null =
    null;

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;

    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      best = { area, theta: Math.atan2(uy, ux), u0, u1, v0, v1 };
    }
  }

  // hull.length >= 3 guarantees a non-degenerate edge.
  const { theta, u0, u1, v0, v1 } = best!;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const center = { x: cu * ux - cv * uy, y: cu * uy + cv * ux };

  let width = u1 - u0;
  let height = v1 - v0;
  // Rotating by −θ maps the box edge onto the x-axis; add 90° to stand a
  // portrait box up into landscape.
  let angleDeg = (-theta * 180) / Math.PI;
  if (height > width) {
    [width, height] = [height, width];
    angleDeg += 90;
  }
  // Normalise to (−90, 90]: a rectangle's alignment is π-periodic and the
  // small rotation keeps the editor's rotation readout sane.
  while (angleDeg > 90) angleDeg -= 180;
  while (angleDeg <= -90) angleDeg += 180;

  return { angleDeg, widthMm: width, heightMm: height, center };
}
