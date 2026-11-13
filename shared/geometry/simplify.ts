import {
  isValidRing,
  perpendicularDistance,
  ringPerimeter,
} from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

/**
 * Simplification and smoothing that preserve concavity.
 *
 * This module exists because the previous `simplifyPoints` ran a convex hull
 * before Ramer–Douglas–Peucker, which destroyed every bay and notch in a tool
 * outline by construction. Nothing here ever computes a hull.
 *
 * Intended order: `resampleRing` → `smoothRingTaubin` → `simplifyRing`.
 * Smooth the dense polyline, then decimate it.
 */

/**
 * Ramer–Douglas–Peucker on an open chain. The endpoints are always kept.
 * Iterative rather than recursive so a dense native-resolution ring cannot
 * overflow the stack.
 */
function simplifyChain(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return [...points];

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let maxDistance = -1;
    let maxIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    if (maxDistance > tolerance && maxIndex > first && maxIndex < last) {
      keep[maxIndex] = 1;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Index of the vertex farthest from `from`. */
function farthestFrom(ring: Ring, from: number): number {
  let best = from;
  let bestDistance = -1;
  for (let i = 0; i < ring.length; i++) {
    const dx = ring[i].x - ring[from].x;
    const dy = ring[i].y - ring[from].y;
    const distance = dx * dx + dy * dy;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Closed-aware Ramer–Douglas–Peucker.
 *
 * A closed ring has no natural endpoints, and running plain RDP on the raw
 * point order pins whichever vertex happens to be first — producing a result
 * that depends on where the tracer started. Instead the ring is split at its
 * two farthest-apart vertices (an approximate diameter, found by two passes of
 * the standard "farthest point" heuristic) into two chains that are simplified
 * independently and rejoined.
 *
 * Never returns fewer than 3 points; a ring that would collapse is returned as
 * its extreme triangle instead.
 */
export function simplifyRing(ring: Ring, tolerancePx: number): Ring {
  if (ring.length <= 3 || tolerancePx <= 0) return [...ring];

  const a = farthestFrom(ring, farthestFrom(ring, 0));
  const b = farthestFrom(ring, a);
  if (a === b) return [...ring];

  const [start, end] = a < b ? [a, b] : [b, a];

  // Two open chains covering the ring: start→end, then end→start through the
  // wrap. Shared endpoints are dropped on rejoin.
  const first = ring.slice(start, end + 1);
  const second = [...ring.slice(end), ...ring.slice(0, start + 1)];

  const simplifiedFirst = simplifyChain(first, tolerancePx);
  const simplifiedSecond = simplifyChain(second, tolerancePx);

  const result = [...simplifiedFirst.slice(0, -1), ...simplifiedSecond.slice(0, -1)];

  return isValidRing(result) ? result : extremeTriangle(ring);
}

/** A 3-point stand-in for a ring that simplification would have collapsed. */
function extremeTriangle(ring: Ring): Ring {
  const a = farthestFrom(ring, farthestFrom(ring, 0));
  const b = farthestFrom(ring, a);
  let c = 0;
  let bestDistance = -1;
  for (let i = 0; i < ring.length; i++) {
    const distance = perpendicularDistance(ring[i], ring[a], ring[b]);
    if (distance > bestDistance) {
      bestDistance = distance;
      c = i;
    }
  }
  const indices = [...new Set([a, b, c])].sort((p, q) => p - q);
  return indices.length === 3 ? indices.map((i) => ring[i]) : [...ring];
}

/** Applies {@link simplifyRing} to every ring in an outline. */
export function simplifyOutline(outline: Outline, tolerancePx: number): Outline {
  return outline.map((shape) => ({
    outer: simplifyRing(shape.outer, tolerancePx),
    holes: shape.holes.map((hole) => simplifyRing(hole, tolerancePx)),
  }));
}

/**
 * Resamples a ring to roughly uniform arc-length spacing.
 *
 * Run before smoothing: a Taubin pass weights neighbours equally, so on an
 * unevenly sampled ring it would smooth densely sampled stretches far harder
 * than sparse ones.
 */
export function resampleRing(ring: Ring, spacingPx: number): Ring {
  if (ring.length < 3 || spacingPx <= 0) return [...ring];

  const perimeter = ringPerimeter(ring);
  if (perimeter <= 0) return [...ring];

  const count = Math.max(3, Math.round(perimeter / spacingPx));
  const step = perimeter / count;

  const out: Point[] = [];
  let segment = 0;
  let consumed = 0; // Arc length already covered by completed segments.

  for (let i = 0; i < count; i++) {
    const target = i * step;

    // Advance through segments until the target falls inside the current one.
    while (segment < ring.length) {
      const a = ring[segment];
      const b = ring[(segment + 1) % ring.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);

      if (consumed + length >= target || segment === ring.length - 1) {
        const t = length === 0 ? 0 : (target - consumed) / length;
        const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
        out.push({ x: a.x + (b.x - a.x) * clamped, y: a.y + (b.y - a.y) * clamped });
        break;
      }

      consumed += length;
      segment++;
    }
  }

  return out.length >= 3 ? out : [...ring];
}

export interface SmoothOptions {
  /** Number of λ/μ pairs to apply. */
  iterations?: number;
  /** Shrinking pass weight. */
  lambda?: number;
  /** Expanding pass weight; must be more negative than −λ to avoid shrinkage. */
  mu?: number;
  /**
   * Vertices whose turn angle exceeds this are pinned, so tool corners survive.
   * Set to 180 to smooth everything.
   */
  cornerAngleDeg?: number;
}

/** Turn angle at vertex `i`, in degrees: 0 is straight, 180 is a full reversal. */
function turnAngleDeg(ring: Ring, i: number): number {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n];
  const curr = ring[i];
  const next = ring[(i + 1) % n];

  const ax = curr.x - prev.x;
  const ay = curr.y - prev.y;
  const bx = next.x - curr.x;
  const by = next.y - curr.y;

  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (aLen === 0 || bLen === 0) return 0;

  const cos = (ax * bx + ay * by) / (aLen * bLen);
  return (Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos) * 180) / Math.PI;
}

/**
 * Taubin λ|μ smoothing.
 *
 * A plain Laplacian (or Chaikin) pass low-passes the boundary but also shrinks
 * it, which on a traced tool means the exported pocket comes out undersized.
 * Taubin alternates a shrinking pass (λ > 0) with a slightly larger expanding
 * pass (μ < −λ), so the net volume change is near zero while high-frequency
 * pixel noise is still removed.
 */
export function smoothRingTaubin(ring: Ring, options: SmoothOptions = {}): Ring {
  const {
    iterations = 1,
    lambda = 0.5,
    mu = -0.53,
    cornerAngleDeg = 40,
  } = options;

  if (ring.length < 5 || iterations <= 0) return [...ring];

  // Corners are decided once, on the original geometry: recomputing them per
  // pass would let smoothing progressively unpin its own corners.
  const pinned = ring.map((_, i) => turnAngleDeg(ring, i) > cornerAngleDeg);

  let current = [...ring];
  for (let pass = 0; pass < iterations; pass++) {
    current = relax(current, lambda, pinned);
    current = relax(current, mu, pinned);
  }
  return current;
}

/** One weighted Laplacian pass: each free vertex moves toward its neighbours' midpoint. */
function relax(ring: Ring, weight: number, pinned: readonly boolean[]): Ring {
  const n = ring.length;
  const out: Point[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (pinned[i]) {
      out[i] = ring[i];
      continue;
    }
    const prev = ring[(i - 1 + n) % n];
    const next = ring[(i + 1) % n];
    const midX = (prev.x + next.x) / 2;
    const midY = (prev.y + next.y) / 2;
    out[i] = {
      x: ring[i].x + weight * (midX - ring[i].x),
      y: ring[i].y + weight * (midY - ring[i].y),
    };
  }
  return out;
}

/** Applies {@link smoothRingTaubin} to every ring in an outline. */
export function smoothOutline(outline: Outline, options: SmoothOptions = {}): Outline {
  return outline.map((shape) => ({
    outer: smoothRingTaubin(shape.outer, options),
    holes: shape.holes.map((hole) => smoothRingTaubin(hole, options)),
  }));
}

/** Resamples every ring in an outline. */
export function resampleOutline(outline: Outline, spacingPx: number): Outline {
  return outline.map((shape) => ({
    outer: resampleRing(shape.outer, spacingPx),
    holes: shape.holes.map((hole) => resampleRing(hole, spacingPx)),
  }));
}
