import { distanceToSegment } from "@shared/geometry/rings";
import type { Outline, Point, RingRef } from "@shared/geometry/types";

import { iterateRings } from "./outline";

export interface VertexHit {
  ref: RingRef;
  index: number;
  distance: number;
  point: Point;
}

export interface EdgeHit {
  ref: RingRef;
  /** Index at which a new point would be inserted to split this edge. */
  insertIndex: number;
  distance: number;
}

/**
 * Nearest vertex within `radius`, or `null`.
 *
 * `radius` is in outline units. Callers working in screen space must divide by
 * the viewport scale so the grab target stays a constant size on screen — a
 * fixed radius shrinks visually as the user zooms in and balloons as they zoom
 * out.
 */
export function nearestVertex(
  outline: Outline,
  point: Point,
  radius: number,
  restrictTo?: RingRef | null,
): VertexHit | null {
  let best: VertexHit | null = null;

  for (const { ref, ring } of iterateRings(outline)) {
    if (restrictTo && !sameRef(ref, restrictTo)) continue;
    for (let index = 0; index < ring.length; index++) {
      const vertex = ring[index];
      const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
      if (distance > radius) continue;
      if (!best || distance < best.distance) {
        best = { ref, index, distance, point: vertex };
      }
    }
  }

  return best;
}

/** Nearest edge within `radius`, or `null`. */
export function nearestEdge(
  outline: Outline,
  point: Point,
  radius: number,
  restrictTo?: RingRef | null,
): EdgeHit | null {
  let best: EdgeHit | null = null;

  for (const { ref, ring } of iterateRings(outline)) {
    if (restrictTo && !sameRef(ref, restrictTo)) continue;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      // Edge i runs from vertex i to vertex i+1, wrapping on the last.
      const distance = distanceToSegment(point, ring[i], ring[(i + 1) % n]);
      if (distance > radius) continue;
      if (!best || distance < best.distance) {
        best = { ref, insertIndex: i + 1, distance };
      }
    }
  }

  return best;
}

/** Nearest ring by edge distance, regardless of radius. */
export function nearestRing(outline: Outline, point: Point): RingRef | null {
  let best: RingRef | null = null;
  let bestDistance = Infinity;

  for (const { ref, ring } of iterateRings(outline)) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const distance = distanceToSegment(point, ring[i], ring[(i + 1) % n]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = ref;
      }
    }
  }

  return best;
}

function sameRef(a: RingRef, b: RingRef): boolean {
  return a.shapeIndex === b.shapeIndex && a.ringIndex === b.ringIndex;
}
