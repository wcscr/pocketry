import type { Outline, Point, Ring } from "@shared/geometry/types";

export interface SnappedMeasurementPoint {
  point: Point;
  distanceMm: number;
}

function closestPointOnSegment(point: Point, a: Point, b: Point): SnappedMeasurementPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq),
        );
  const snapped = { x: a.x + t * dx, y: a.y + t * dy };
  return {
    point: snapped,
    distanceMm: Math.hypot(point.x - snapped.x, point.y - snapped.y),
  };
}

function nearestRingPoint(point: Point, ring: Ring): SnappedMeasurementPoint | null {
  let best: SnappedMeasurementPoint | null = null;
  for (let index = 0; index < ring.length; index++) {
    const candidate = closestPointOnSegment(
      point,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    if (!best || candidate.distanceMm < best.distanceMm) best = candidate;
  }
  return best;
}

/** Finds the nearest outer or hole contour across the placed tool cutouts. */
export function snapToToolContour(
  point: Point,
  outlines: readonly Outline[],
  maxDistanceMm: number,
): SnappedMeasurementPoint | null {
  let best: SnappedMeasurementPoint | null = null;
  for (const outline of outlines) {
    for (const shape of outline) {
      for (const ring of [shape.outer, ...shape.holes]) {
        const candidate = nearestRingPoint(point, ring);
        if (candidate && (!best || candidate.distanceMm < best.distanceMm)) {
          best = candidate;
        }
      }
    }
  }
  return best && best.distanceMm <= maxDistanceMm ? best : null;
}

export function measurementDistanceMm(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
