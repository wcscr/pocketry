import {
  HOLE_ORIENTATION,
  OUTER_ORIENTATION,
  type Bounds,
  type OrientationSign,
  type Point,
  type Ring,
} from "./types";

/**
 * Twice the signed area of a closed ring (the raw shoelace sum).
 *
 * Sign carries the orientation; see the convention documented on
 * `OrientationSign` in `./types`.
 */
export function doubleSignedArea(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  // j trails i by one, wrapping, so the closing edge is included.
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return sum;
}

/** Signed area of a closed ring. Positive for outer rings, negative for holes. */
export function signedArea(ring: Ring): number {
  return doubleSignedArea(ring) / 2;
}

/** Unsigned area of a closed ring. */
export function ringArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** Perimeter of a closed ring, including the implicit closing edge. */
export function ringPerimeter(ring: Ring): number {
  const n = ring.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    total += Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y);
  }
  return total;
}

/** Axis-aligned bounds of a ring. Returns `null` for an empty ring. */
export function ringBounds(ring: Ring): Bounds | null {
  if (ring.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** True when `outer` fully contains `inner`'s bounds. Cheap pre-filter. */
export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/**
 * Area centroid of a closed ring.
 *
 * Falls back to the mean of the vertices for degenerate (zero-area) rings,
 * where the area-weighted formula is undefined.
 */
export function ringCentroid(ring: Ring): Point | null {
  const n = ring.length;
  if (n === 0) return null;
  if (n < 3) {
    return meanPoint(ring);
  }

  let cx = 0;
  let cy = 0;
  let doubleArea = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    doubleArea += cross;
    cx += (ring[j].x + ring[i].x) * cross;
    cy += (ring[j].y + ring[i].y) * cross;
  }

  if (doubleArea === 0) return meanPoint(ring);
  return { x: cx / (3 * doubleArea), y: cy / (3 * doubleArea) };
}

function meanPoint(ring: Ring): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** Reverses a ring's winding, flipping the sign of its signed area. */
export function reverseRing(ring: Ring): Ring {
  return ring.slice().reverse();
}

/**
 * Returns a ring wound to match `orientation`, reusing the input when it
 * already matches.
 */
export function ensureOrientation(ring: Ring, orientation: OrientationSign): Ring {
  const area = doubleSignedArea(ring);
  if (area === 0) return ring; // Degenerate: no meaningful winding to fix.
  const current: OrientationSign = area > 0 ? OUTER_ORIENTATION : HOLE_ORIENTATION;
  return current === orientation ? ring : reverseRing(ring);
}

/**
 * Drops consecutive points closer together than `epsilon`, including across
 * the implicit closing edge.
 *
 * Duplicate vertices are what break gift-wrap hulls, produce zero-length edges
 * in offsetting, and create degenerate triangles in triangulation, so tracing
 * output is always deduped before use.
 */
export function dedupeRing(ring: Ring, epsilon = 1e-9): Ring {
  if (ring.length < 2) return ring.slice();
  const epsSq = epsilon * epsilon;
  const out: Point[] = [];

  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && distanceSq(last, p) <= epsSq) continue;
    out.push(p);
  }
  // Close the loop: the last point may now coincide with the first.
  while (out.length > 1 && distanceSq(out[0], out[out.length - 1]) <= epsSq) {
    out.pop();
  }
  return out;
}

function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Point-in-ring test by crossing number, with the closing edge included.
 *
 * Points lying exactly on the boundary are reported by `onBoundary` rather than
 * being classified arbitrarily; callers that only need containment can ignore
 * it. Vertices are handled without double-counting by the half-open comparison
 * on y, which is why a ray through a vertex does not produce a false result.
 */
export function pointInRing(
  ring: Ring,
  point: Point,
  boundaryEpsilon = 1e-9,
): boolean {
  const n = ring.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j];
    const b = ring[i];

    if (pointOnSegment(a, b, point, boundaryEpsilon)) return true;

    // Half-open y test: counts an edge only if the ray crosses it, and counts
    // a shared vertex exactly once.
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;

    const t = (point.y - a.y) / (b.y - a.y);
    if (point.x < a.x + t * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** True when `point` lies on segment `a`–`b` within `epsilon`. */
export function pointOnSegment(
  a: Point,
  b: Point,
  point: Point,
  epsilon = 1e-9,
): boolean {
  return distanceToSegment(point, a, b) <= epsilon;
}

/** Shortest distance from `point` to the segment `a`–`b`. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  // Projection parameter, clamped to the segment.
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Perpendicular distance from `point` to the infinite line through `a` and `b`.
 * Used by Ramer–Douglas–Peucker, which measures against the chord, not the
 * segment.
 */
export function perpendicularDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length;
}

/** Applies `fn` to every point of a ring. */
export function mapRing(ring: Ring, fn: (point: Point) => Point): Ring {
  return ring.map(fn);
}

/** True when a ring has enough distinct points to enclose an area. */
export function isValidRing(ring: Ring): boolean {
  return ring.length >= 3;
}
