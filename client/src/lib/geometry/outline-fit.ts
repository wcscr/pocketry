import { isValidRing, ringArea, ringCentroid } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

import { mapOutline } from "./outline";

/**
 * Laying one outline over another by turning and sliding it.
 *
 * An outline that was straightened or rotated before it was saved has the
 * right size but the wrong pose for the photo. This finds the rotation and
 * shift that bring it onto a reference outline of the same object, such as the
 * one detection found. It never scales or mirrors: the size in the file is the
 * measurement being kept.
 */

/** A rotation about `pivot`, then a shift. */
export interface RigidTransform {
  radians: number;
  pivot: Point;
  shift: Point;
}

export interface RigidFit extends RigidTransform {
  /** Median distance from the fitted outline to the reference boundary, in the outlines' units. */
  typicalGap: number;
}

/** Boundary samples taken from the outline being moved. */
const SAMPLES = 240;
/** Rotations tried before refinement: every five degrees. */
const COARSE_STEPS = 72;
/** The best coarse rotations are each refined; a symmetric object has several good ones. */
const STARTS = 4;
const ITERATIONS = 40;
/** The worst matches are ignored, so a shadow or a missed tip in the reference cannot drag the fit. */
const KEPT_FRACTION = 0.8;
/** A reference ring with more vertices than this is resampled to bound the work. */
const MAX_REFERENCE_SEGMENTS = 720;

export function rigidPoint(point: Point, transform: RigidTransform): Point {
  // A pure move adds the shift and nothing else, so it cannot disturb coordinates in the last digit.
  if (transform.radians === 0) return { x: point.x + transform.shift.x, y: point.y + transform.shift.y };
  const cos = Math.cos(transform.radians), sin = Math.sin(transform.radians);
  const x = point.x - transform.pivot.x, y = point.y - transform.pivot.y;
  return {
    x: cos * x - sin * y + transform.pivot.x + transform.shift.x,
    y: sin * x + cos * y + transform.pivot.y + transform.shift.y,
  };
}

/** Rotation and translation keep every ring's winding, so the result needs no renormalizing. */
export function applyRigid(outline: Outline, transform: RigidTransform): Outline {
  return mapOutline(outline, point => rigidPoint(point, transform));
}

function largestOuter(outline: Outline): Ring | null {
  let best: Ring | null = null, bestArea = 0;
  for (const shape of outline) {
    const area = isValidRing(shape.outer) ? ringArea(shape.outer) : 0;
    if (area > bestArea) { best = shape.outer; bestArea = area; }
  }
  return best;
}

/** `count` points spaced evenly along a closed ring; each lies on the ring. */
function resample(ring: Ring, count: number): Point[] {
  const lengths = ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  const points: Point[] = [];
  let edge = 0, travelled = 0;
  for (let index = 0; index < count; index++) {
    const at = perimeter * index / count;
    while (edge < ring.length - 1 && travelled + lengths[edge] < at) travelled += lengths[edge++];
    const start = ring[edge], end = ring[(edge + 1) % ring.length];
    const t = lengths[edge] > 0 ? Math.min(1, (at - travelled) / lengths[edge]) : 0;
    points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  }
  return points;
}

/** Closest point on a closed polyline. */
function closestOnRing(point: Point, ring: Point[]): { x: number; y: number; distance: number } {
  let best = Infinity, bx = ring[0].x, by = ring[0].y;
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index], b = ring[(index + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const x = a.x + dx * t, y = a.y + dy * t, d = (point.x - x) * (point.x - x) + (point.y - y) * (point.y - y);
    if (d < best) { best = d; bx = x; by = y; }
  }
  return { x: bx, y: by, distance: Math.sqrt(best) };
}

/** Mean of the smallest `KEPT_FRACTION` of the values. */
function trimmedMean(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const kept = Math.max(1, Math.floor(sorted.length * KEPT_FRACTION));
  let sum = 0;
  for (let index = 0; index < kept; index++) sum += sorted[index];
  return sum / kept;
}

/** How far apart two point sets are, each measured to the nearest point of the other. */
function scatterCost(a: Point[], b: Point[]): number {
  const nearest = (from: Point[], to: Point[]) => from.map(p => {
    let best = Infinity;
    for (const q of to) { const d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y); if (d < best) best = d; }
    return best;
  });
  return trimmedMean(nearest(a, b)) + trimmedMean(nearest(b, a));
}

/**
 * The rotation and shift that best lay `moving` over `reference`, judged on the
 * largest contour of each. Returns null when either has no usable contour.
 */
export function fitOutlineRigid(moving: Outline, reference: Outline): RigidFit | null {
  const movingRing = largestOuter(moving), referenceRing = largestOuter(reference);
  if (!movingRing || !referenceRing) return null;
  const pivot = ringCentroid(movingRing), goal = ringCentroid(referenceRing);
  if (!pivot || !goal) return null;

  const samples = resample(movingRing, SAMPLES);
  const referenceSamples = resample(referenceRing, SAMPLES);
  const boundary = referenceRing.length > MAX_REFERENCE_SEGMENTS ? resample(referenceRing, MAX_REFERENCE_SEGMENTS) : referenceRing;
  const place = (transform: RigidTransform) => samples.map(point => rigidPoint(point, transform));

  // 1. Every five degrees with the centroids together: which way round does it go?
  const centered = { x: goal.x - pivot.x, y: goal.y - pivot.y };
  const coarse = Array.from({ length: COARSE_STEPS }, (_, step) => {
    const radians = step * 2 * Math.PI / COARSE_STEPS;
    return { radians, cost: scatterCost(place({ radians, pivot, shift: centered }), referenceSamples) };
  }).sort((a, b) => a.cost - b.cost);
  const starts: number[] = [];
  for (const candidate of coarse) {
    const apart = (other: number) => Math.abs(Math.atan2(Math.sin(candidate.radians - other), Math.cos(candidate.radians - other)));
    if (starts.every(other => apart(other) > Math.PI / 12)) starts.push(candidate.radians);
    if (starts.length === STARTS) break;
  }

  // 2. Refine each: pair every sample with the closest boundary point, solve the best rigid motion, repeat.
  let best: (RigidTransform & { cost: number }) | null = null;
  for (const start of starts) {
    let transform: RigidTransform = { radians: start, pivot, shift: centered };
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const pairs = place(transform).map((placed, index) => ({ source: samples[index], ...closestOnRing(placed, boundary) }))
        .sort((a, b) => a.distance - b.distance).slice(0, Math.max(3, Math.floor(SAMPLES * KEPT_FRACTION)));
      let sx = 0, sy = 0, tx = 0, ty = 0;
      for (const pair of pairs) { sx += pair.source.x; sy += pair.source.y; tx += pair.x; ty += pair.y; }
      sx /= pairs.length; sy /= pairs.length; tx /= pairs.length; ty /= pairs.length;
      let dot = 0, cross = 0;
      for (const pair of pairs) {
        const ax = pair.source.x - sx, ay = pair.source.y - sy, bx = pair.x - tx, by = pair.y - ty;
        dot += ax * bx + ay * by; cross += ax * by - ay * bx;
      }
      const radians = Math.atan2(cross, dot), cos = Math.cos(radians), sin = Math.sin(radians);
      // Rotate about the pairs' own centroid onto the matched centroid, expressed about the fixed pivot.
      const px = pivot.x - sx, py = pivot.y - sy;
      const next: RigidTransform = { radians, pivot,
        shift: { x: cos * px - sin * py + tx - pivot.x, y: sin * px + cos * py + ty - pivot.y } };
      const turned = Math.abs(Math.atan2(Math.sin(next.radians - transform.radians), Math.cos(next.radians - transform.radians)));
      const moved = Math.hypot(next.shift.x - transform.shift.x, next.shift.y - transform.shift.y);
      transform = next;
      if (turned < 1e-7 && moved < 1e-5) break;
    }
    const placed = place(transform);
    const cost = trimmedMean(placed.map(point => closestOnRing(point, boundary).distance))
      + trimmedMean(referenceSamples.map(point => closestOnRing(point, placed).distance));
    if (!best || cost < best.cost) best = { ...transform, cost };
  }
  if (!best) return null;

  const gaps = place(best).map(point => closestOnRing(point, boundary).distance).sort((a, b) => a - b);
  // Report the turn as the shortest way round.
  const radians = Math.atan2(Math.sin(best.radians), Math.cos(best.radians));
  return { radians, pivot: best.pivot, shift: best.shift, typicalGap: gaps[Math.floor(gaps.length / 2)] };
}
