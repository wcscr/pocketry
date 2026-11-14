import { preservesMaterial } from "@shared/geometry/boundary-contract";
import { pointInRing, ringPerimeter, signedArea } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

import { resampleRing } from "./simplify";

/**
 * Smoothing with a checked inward allowance (5% of the length by default).
 *
 * A detected silhouette is the edge of a yes-or-no mask, so its trace is a
 * staircase with risers of one segmentation pixel. An ordinary low-pass
 * removes the stairs but also pulls every convex part inward, and a pocket cut
 * inside the tool's edge does not fit. This smooths the ring and then moves the
 * result away from the material, then checks the entire boundary against the
 * stated inward allowance:
 *
 * 1. **Base.** Blur the ring along its own length (a Gaussian of the given
 *    length). The base is smooth but cuts corners and the tops of the stairs.
 * 2. **Lift.** Measure how far the trace lies outside the base at every sample,
 *    take the running maximum of that over one length either side, and average
 *    the maximum over the same window. The average of a running maximum is
 *    never below the value it was taken from, and it is as smooth as the window
 *    is wide.
 * 3. Offset the base along its normal by the lift.
 *
 * Holes move the other way, into the hole. A failed containment check retries
 * a shorter smoothing length, then falls back to the original ring.
 * The cost is a small outward offset: about a twentieth of the length on a
 * stair-stepped edge and up to about two thirds of it beside a sharp corner.
 *
 * Growth must not close a gap: where two stretches of boundary would end up
 * closer than they were and closer than half a length (a slit's mouth, two
 * tips that nearly meet), the trace is kept there and faded back into the
 * smooth ring over a few lengths.
 *
 * The result is a new, evenly sampled ring. A ring whose smoothed version
 * would still cross itself is retried with a shorter length and, failing
 * that, returned unchanged.
 */

/** Smoothing length used when a physical scale is known. */
export const OUTER_SMOOTHING_MM = 1;
/** Without a scale the length follows the staircase: this many segmentation pixels. */
export const AUTO_OUTER_SMOOTHING_SEG_PIXELS = 4;

/** Samples per smoothing length while working, and in the returned ring. */
const WORKING_SAMPLES_PER_LENGTH = 10;
const OUTPUT_SAMPLES_PER_LENGTH = 4;
/** A ring gets at least this many smoothing lengths of boundary, or a shorter length. */
const MIN_LENGTHS_PER_RING = 12;
/**
 * Line and curve reconstruction refuses a ring over 12,000 samples and an
 * outline over 24,000, so the returned rings stay well under both.
 */
const MAX_OUTPUT_SAMPLES_PER_RING = 6000;
const MAX_OUTPUT_SAMPLES = 20_000;
/** Lengths tried in turn when a smoothed ring would be invalid. */
const RETRY_FACTORS = [1, 0.5, 0.25] as const;
/** Area a ring may lose to chords, as a fraction of perimeter × sample spacing. */
const CHORD_LOSS = 0.05;
/**
 * A gap is left as traced where smoothing would narrow it below this fraction
 * of the length and to less than `PINCH_SHRINK` of its traced width.
 */
const PINCH_CLEARANCE = 0.5;
const PINCH_SHRINK = 0.9;

/**
 * Smooths every ring of an outline outward. `length` is in the outline's own
 * units; zero, negative or non-finite returns the outline unchanged. Detection
 * supplies its detail allowance so smoothing and later cleanup share a budget.
 */
export function smoothOuterBoundary(outline: Outline, length: number, inwardAllowance = length * .05): Outline {
  if (!(length > 0) || !Number.isFinite(length)) return outline;
  const rings = outline.flatMap((shape) => [shape.outer, ...shape.holes]);
  const perimeter = rings.reduce((sum, ring) => sum + ringPerimeter(ring), 0);
  // Coarsen the returned sampling, never the smoothing, when an outline is very long.
  // (Smoothed rings come out a few percent longer than the trace, hence the margin.)
  const coarsen = Math.max(1, perimeter / (length / OUTPUT_SAMPLES_PER_LENGTH) / (MAX_OUTPUT_SAMPLES * 0.95));
  const smoothed = outline.map((shape) => ({
    outer: smoothRingOutward(shape.outer, length, { hole: false, coarsen, inwardAllowance }),
    holes: shape.holes.map((hole) => smoothRingOutward(hole, length, { hole: true, coarsen, inwardAllowance })),
  }));
  // Two tools that have grown into each other are worse than two rough ones.
  for (let a = 0; a < smoothed.length; a++) {
    for (let b = a + 1; b < smoothed.length; b++) {
      if (smoothed[a].outer !== outline[a].outer || smoothed[b].outer !== outline[b].outer) {
        if (ringsCross(smoothed[a].outer, smoothed[b].outer)) {
          smoothed[a] = { ...smoothed[a], outer: outline[a].outer };
          smoothed[b] = { ...smoothed[b], outer: outline[b].outer };
        }
      }
    }
  }
  return smoothed;
}

/**
 * Smooths one ring away from the material. Returns the ring itself when it is
 * too small to smooth or no valid smoothed ring exists.
 */
export function smoothRingOutward(
  ring: Ring,
  length: number,
  options: { hole?: boolean; coarsen?: number; inwardAllowance?: number } = {},
): Ring {
  if (ring.length < 3 || !(length > 0) || !Number.isFinite(length)) return ring;
  const perimeter = ringPerimeter(ring), area = signedArea(ring);
  if (!(perimeter > 0) || area === 0) return ring;
  // A hole can only shrink into itself. One whose mean width is under a length has no room to.
  if (options.hole && 2 * Math.abs(area) / perimeter < length) return ring;
  // A small ring is smoothed over a proportionally shorter length, or it would collapse into a blob.
  const fitted = Math.min(length, perimeter / MIN_LENGTHS_PER_RING);
  const spacing = Math.max(fitted / OUTPUT_SAMPLES_PER_LENGTH * Math.max(1, options.coarsen ?? 1), perimeter / MAX_OUTPUT_SAMPLES_PER_RING);
  // Material lies inside an outer ring and outside a hole.
  const away = (options.hole ? -1 : 1) * Math.sign(area);
  // Reject excessive net-area loss as an early filter; local loss is checked below.
  const sliver = perimeter * spacing * CHORD_LOSS;
  for (const factor of RETRY_FACTORS) {
    const candidate = envelope(ring, perimeter, fitted * factor, away, fitted);
    if (!candidate) continue;
    // The smoothed ring is a little longer than the trace, and the cap is on what is returned.
    const result = resampleRing(candidate, Math.max(spacing, ringPerimeter(candidate) / MAX_OUTPUT_SAMPLES_PER_RING));
    const change = (Math.abs(signedArea(result)) - Math.abs(area)) * (options.hole ? -1 : 1);
    // Preserve winding and bound net-area loss; area alone cannot protect tips.
    if (Math.sign(signedArea(result)) !== Math.sign(area) || change < -sliver || ringCrossesItself(result)) continue;
    // A hole has nowhere to go but into itself. One thinner than the smoothing bulges instead,
    // which would eat material, so a smoothed hole must lie wholly inside the hole it came from.
    if (options.hole && !result.every((point) => pointInRing(ring, point))) continue;
    const before = [{ outer: ring, holes: [] }], after = [{ outer: result, holes: [] }];
    if (!preservesMaterial(options.hole ? after : before, options.hole ? before : after, options.inwardAllowance ?? length * 0.05)) continue;
    return result;
  }
  return ring;
}

/** The lifted base at working resolution, or `null` when the ring is too short to work on. */
function envelope(ring: Ring, perimeter: number, length: number, away: number, protectedLength = length): Ring | null {
  const points = resampleRing(ring, length / WORKING_SAMPLES_PER_LENGTH), n = points.length;
  const step = perimeter / n;
  const radius = Math.min((n >> 1) - 1, Math.ceil(3 * length / step));
  const window = Math.min((n >> 1) - 1, Math.max(1, Math.round(length / step)));
  if (radius < 2) return null;

  const kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) * step / length) ** 2));
  let total = 0;
  for (const weight of kernel) total += weight;
  const baseX = new Float64Array(n), baseY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let k = -radius; k <= radius; k++) {
      const point = points[(i + k + n) % n], weight = kernel[k + radius];
      x += point.x * weight; y += point.y * weight;
    }
    baseX[i] = x / total; baseY[i] = y / total;
  }
  // Unit normal of the base, pointing away from the material.
  const normalX = new Float64Array(n), normalY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const before = (i + n - 1) % n, after = (i + 1) % n;
    const tx = baseX[after] - baseX[before], ty = baseY[after] - baseY[before], size = Math.hypot(tx, ty);
    if (size === 0) return null;
    normalX[i] = ty / size * away; normalY[i] = -tx / size * away;
  }
  // How far the trace lies outside the base at each base sample. A traced point also sits a little
  // along the boundary from its own base point (most at a corner), so it is charged to every base
  // sample whose normal it stands on, not only to its own.
  const height = new Float64Array(n);
  for (let i = 0; i < n; i++) height[i] = (points[i].x - baseX[i]) * normalX[i] + (points[i].y - baseY[i]) * normalY[i];
  for (let i = 0; i < n; i++) {
    for (let k = -window; k <= window; k++) {
      if (k === 0) continue;
      const j = (i + k + n) % n, dx = points[i].x - baseX[j], dy = points[i].y - baseY[j];
      if (Math.abs(dx * normalY[j] - dy * normalX[j]) > step) continue;
      const outside = dx * normalX[j] + dy * normalY[j];
      if (outside > height[j]) height[j] = outside;
    }
  }
  const lift = liftOf(height, window);

  const result: Point[] = new Array(n);
  for (let i = 0; i < n; i++) result[i] = { x: baseX[i] + normalX[i] * lift[i], y: baseY[i] + normalY[i] * lift[i] };
  // Growth must not close a gap. Where it would, keep the trace and fade back to the smooth ring.
  const keep = pinchWeights(points, result, step, protectedLength);
  if (keep) {
    for (let i = 0; i < n; i++) {
      result[i] = { x: points[i].x + (result[i].x - points[i].x) * keep[i], y: points[i].y + (result[i].y - points[i].y) * keep[i] };
    }
  }
  return result;
}

/**
 * Finds where the smoothed ring brings two stretches of boundary closer together than they were
 * and closer than half a smoothing length: the mouth of a slit, two tips that nearly meet. Each
 * side of a gap grows toward the other, and a gap squeezed to nothing is a contour that later
 * stages cannot fit. Returns a weight per sample, 0 at such a place and rising to 1 three lengths
 * along the boundary from it, or `null` when there is none.
 */
function pinchWeights(points: readonly Point[], smoothed: readonly Point[], step: number, length: number): Float64Array | null {
  const n = points.length, floor = PINCH_CLEARANCE * length;
  // Samples this close along the ring are neighbours, not the two sides of a gap.
  const apart = Math.ceil(3 * length / step);
  if (n <= 2 * apart) return null;
  // A grid of cells one clearance wide, so only samples in neighbouring cells are compared.
  let minX = Infinity, minY = Infinity, maxX = -Infinity;
  for (const point of smoothed) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
  }
  const columns = Math.floor((maxX - minX) / floor) + 3;
  const cellX = (point: Point) => Math.floor((point.x - minX) / floor) + 1;
  const cellY = (point: Point) => Math.floor((point.y - minY) / floor) + 1;
  const cells = new Map<number, number[]>();
  smoothed.forEach((point, i) => {
    const key = cellY(point) * columns + cellX(point), cell = cells.get(key);
    if (cell) cell.push(i); else cells.set(key, [i]);
  });
  const pinched = new Uint8Array(n);
  let found = false;
  for (let i = 0; i < n; i++) {
    const cx = cellX(smoothed[i]), cy = cellY(smoothed[i]);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = cells.get((cy + dy) * columns + cx + dx);
      if (!cell) continue;
      for (const j of cell) {
        if (j <= i || Math.min(j - i, n - (j - i)) < apart) continue;
        const now = Math.hypot(smoothed[i].x - smoothed[j].x, smoothed[i].y - smoothed[j].y);
        if (now >= floor) continue;
        const before = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        if (now < before * PINCH_SHRINK) { pinched[i] = pinched[j] = 1; found = true; }
      }
    }
  }
  if (!found) return null;
  // Distance along the ring, in samples, to the nearest pinched sample: one sweep each way, twice round.
  const far = new Float64Array(n).fill(Infinity);
  for (const direction of [1, -1]) {
    let since = Infinity;
    for (let k = 0; k < 2 * n; k++) {
      const i = direction > 0 ? k % n : (2 * n - 1 - k) % n;
      since = pinched[i] ? 0 : since + 1;
      if (since < far[i]) far[i] = since;
    }
  }
  const hold = length / step, fade = 2 * length / step;
  return far.map((samples) => {
    const t = Math.min(1, Math.max(0, (samples - hold) / fade));
    return t * t * (3 - 2 * t);
  });
}

/** Mean, over ±window, of the running maximum over ±window. Never below the input. */
function liftOf(height: Float64Array, window: number): Float64Array {
  const n = height.length, peak = new Float64Array(n), lift = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    for (let k = -window; k <= window; k++) best = Math.max(best, height[(i + k + n) % n]);
    peak[i] = best;
  }
  let sum = 0;
  for (let k = -window; k <= window; k++) sum += peak[(k + n) % n];
  for (let i = 0; i < n; i++) {
    lift[i] = sum / (2 * window + 1);
    sum += peak[(i + window + 1) % n] - peak[(i - window + n) % n];
  }
  return lift;
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const properlyCross = (a: Point, b: Point, c: Point, d: Point) =>
  cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

interface Segment { a: Point; b: Point; index: number; minX: number; maxX: number }
function segmentsOf(ring: Ring): Segment[] {
  return ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length];
    return { a, b, index, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) };
  }).sort((s, t) => s.minX - t.minX);
}

/** True when two non-adjacent edges of the ring properly cross. */
export function ringCrossesItself(ring: Ring): boolean {
  const segments = segmentsOf(ring), n = ring.length;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    for (let j = i + 1; j < segments.length && segments[j].minX <= s.maxX; j++) {
      const t = segments[j], gap = Math.abs(s.index - t.index);
      if (gap <= 1 || gap === n - 1) continue;
      if (properlyCross(s.a, s.b, t.a, t.b)) return true;
    }
  }
  return false;
}

/** True when an edge of one ring properly crosses an edge of the other. */
function ringsCross(first: Ring, second: Ring): boolean {
  const others = segmentsOf(second);
  for (const s of segmentsOf(first)) {
    for (const t of others) {
      if (t.minX > s.maxX) break;
      if (t.maxX >= s.minX && properlyCross(s.a, s.b, t.a, t.b)) return true;
    }
  }
  return false;
}
