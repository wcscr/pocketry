import { distanceToSegment, pointInRing } from "./rings";
import type { Outline, Point, Ring } from "./types";

/**
 * Boundary-level comparison of a detected outline against a reference outline.
 *
 * These are evaluation metrics, not runtime checks. They answer the questions a
 * tool pocket cares about, separately, because one number hides the difference:
 *
 * - **Offset**: does the candidate boundary sit outside or inside the reference,
 *   and by how much on average?
 * - **Missing**: how far does reference material stick out of the candidate? A
 *   pocket cut from that candidate will not admit the tool, so this is the
 *   direction that matters most.
 * - **Excess**: how far does the candidate reach beyond the reference (a spur, a
 *   shadow strip)? That only leaves slack.
 * - **Cut-in**: how deep does the candidate boundary run inside the reference
 *   (a slit, a bite)? The pocket wall would stand where the tool is.
 * - **Loopbacks**: where does the outline run out or in and come straight back?
 * - **Roughness**: is the outline stair-stepped? This needs no reference.
 *
 * All distances are in the outlines' own units; scale both to millimetres first
 * when a physical tolerance is wanted.
 */
export interface ContourComparison {
  /** Boundary samples taken from each outline. */
  candidateSamples: number;
  truthSamples: number;
  /**
   * Signed distance from candidate boundary samples to the reference boundary:
   * positive where the candidate lies outside the reference, negative inside.
   * `null` when the candidate is empty.
   */
  signedOffsetMean: number | null;
  signedOffsetMedian: number | null;
  /** 95th percentile of the unsigned boundary distance, taken in both directions. */
  distanceP95: number | null;
  /**
   * Largest distance from a reference boundary sample that the candidate does
   * not cover to the candidate boundary. Zero when the candidate covers the
   * whole reference; `null` when the candidate is empty.
   */
  missingMax: number | null;
  /** Largest distance from a candidate boundary sample outside the reference to the reference boundary. */
  excessMax: number | null;
  /**
   * Largest distance from a candidate boundary sample inside the reference to
   * the reference boundary: how deep the outline cuts into the tool. `missingMax`
   * does not see a narrow cut, because the reference boundary on either side
   * of its mouth is still close to the candidate.
   */
  cutInMax: number | null;
  /**
   * Stretches of candidate boundary farther than `excursionThreshold` from the
   * reference boundary, in ring order. Empty when no threshold was given.
   */
  excursions: Excursion[];
  /** Boundary precision, recall and F-score at each requested tolerance. */
  scores: ContourScore[];
  /** Candidate shell count minus reference shell count. */
  shellDelta: number;
}

/** One stretch of candidate boundary that leaves the reference boundary and returns to it. */
export interface Excursion {
  /** The side of the reference boundary the stretch runs on. */
  side: "inside" | "outside";
  /** Greatest distance from the reference boundary along the stretch. */
  depth: number;
  /**
   * Straight-line distance between the points where the stretch leaves the
   * reference boundary and returns. `Infinity` for a ring that never returns.
   */
  mouth: number;
  /** Boundary length of the stretch. */
  length: number;
  /** The candidate boundary point at the greatest distance. */
  at: Point;
}

/**
 * A loopback: the outline runs out along a spur, or in along a slit, and comes
 * back. It is at least `minDepth` deep and deeper than its mouth is wide.
 */
export function isLoopback(excursion: Excursion, minDepth: number): boolean {
  return excursion.depth >= minDepth && excursion.depth >= excursion.mouth;
}

export interface ContourScore {
  tolerance: number;
  /** Fraction of candidate boundary samples within the tolerance of the reference boundary. */
  precision: number;
  /** Fraction of reference boundary samples within the tolerance of the candidate boundary. */
  recall: number;
  f: number;
}

export interface CompareContoursOptions {
  /** Arc-length spacing of the boundary samples, in outline units. Must be positive. */
  spacing: number;
  /** Distances at which precision, recall and F-score are reported. */
  tolerances?: readonly number[];
  /** Distance from the reference boundary beyond which a stretch is reported as an excursion. */
  excursionThreshold?: number;
}

function rings(outline: Outline): Ring[] {
  return outline.flatMap((shape) => [shape.outer, ...shape.holes]);
}

/**
 * Evenly spaced samples along one implicitly closed ring.
 *
 * Samples start half a step in, so a square's corners are not over-represented
 * and two rings that differ only in their start vertex sample almost alike.
 */
export function sampleRing(ring: Ring, spacing: number): Point[] {
  if (!(spacing > 0) || !Number.isFinite(spacing)) throw new Error("Sample spacing must be positive");
  if (ring.length < 2) return [];
  const samples: Point[] = [];
  let next = spacing / 2;
  let travelled = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    while (next <= travelled + length) {
      const t = (next - travelled) / length;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      next += spacing;
    }
    travelled += length;
  }
  // A ring shorter than half a step would otherwise vanish from the comparison.
  if (!samples.length && travelled > 0) samples.push({ ...ring[0] });
  return samples;
}

/** Evenly spaced samples along every ring (outer and holes) of an outline. */
export function sampleOutlineBoundary(outline: Outline, spacing: number): Point[] {
  return rings(outline).flatMap((ring) => sampleRing(ring, spacing));
}

/** True when the point lies in the outline's filled area: inside a shell and outside its holes. */
export function pointInOutline(outline: Outline, point: Point): boolean {
  return outline.some((shape) =>
    pointInRing(shape.outer, point) && !shape.holes.some((hole) => pointInRing(hole, point)));
}

/** Distance from a point to the nearest boundary segment; `Infinity` for an empty outline. */
export function distanceToOutlineBoundary(outline: Outline, point: Point): number {
  let best = Infinity;
  for (const ring of rings(outline)) {
    for (let i = 0; i < ring.length; i++) {
      const distance = distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]);
      if (distance < best) best = distance;
    }
  }
  return best;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

/**
 * Compares a candidate outline with a reference outline.
 *
 * The reference must not be empty. An empty candidate is reported, not thrown:
 * recall and precision are zero and the distance fields are `null`.
 */
export function compareContours(
  candidate: Outline,
  truth: Outline,
  options: CompareContoursOptions,
): ContourComparison {
  const truthPoints = sampleOutlineBoundary(truth, options.spacing);
  if (!truthPoints.length) throw new Error("Reference outline is empty");
  const candidateRings = rings(candidate).map((ring) => sampleRing(ring, options.spacing));
  const candidatePoints = candidateRings.flat();
  const tolerances = options.tolerances ?? [];
  const shellDelta = candidate.length - truth.length;
  if (!candidatePoints.length) {
    return {
      candidateSamples: 0, truthSamples: truthPoints.length,
      signedOffsetMean: null, signedOffsetMedian: null, distanceP95: null, missingMax: null, excessMax: null, cutInMax: null,
      excursions: [],
      scores: tolerances.map((tolerance) => ({ tolerance, precision: 0, recall: 0, f: 0 })),
      shellDelta,
    };
  }

  // Candidate boundary measured against the reference.
  const toTruth = candidatePoints.map((point) => distanceToOutlineBoundary(truth, point));
  const signed = candidatePoints.map((point, i) => pointInOutline(truth, point) ? -toTruth[i] : toTruth[i]);
  const excursions: Excursion[] = [];
  if (options.excursionThreshold !== undefined) {
    let start = 0;
    for (const samples of candidateRings) {
      excursions.push(...ringExcursions(samples, signed.slice(start, start + samples.length), options.excursionThreshold, options.spacing));
      start += samples.length;
    }
  }
  // Reference boundary measured against the candidate.
  const toCandidate = truthPoints.map((point) => distanceToOutlineBoundary(candidate, point));
  let missingMax = 0;
  truthPoints.forEach((point, i) => {
    if (toCandidate[i] > missingMax && !pointInOutline(candidate, point)) missingMax = toCandidate[i];
  });
  let excessMax = 0;
  let cutInMax = 0;
  for (const value of signed) {
    if (value > excessMax) excessMax = value;
    if (-value > cutInMax) cutInMax = -value;
  }

  const sortedSigned = [...signed].sort((a, b) => a - b);
  const sortedToTruth = [...toTruth].sort((a, b) => a - b);
  const sortedToCandidate = [...toCandidate].sort((a, b) => a - b);
  const scores = tolerances.map((tolerance) => {
    const precision = toTruth.filter((d) => d <= tolerance).length / toTruth.length;
    const recall = toCandidate.filter((d) => d <= tolerance).length / toCandidate.length;
    return { tolerance, precision, recall, f: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0 };
  });
  return {
    candidateSamples: candidatePoints.length,
    truthSamples: truthPoints.length,
    signedOffsetMean: signed.reduce((sum, value) => sum + value, 0) / signed.length,
    signedOffsetMedian: percentile(sortedSigned, 0.5),
    distanceP95: Math.max(percentile(sortedToTruth, 0.95), percentile(sortedToCandidate, 0.95)),
    missingMax,
    excessMax,
    cutInMax,
    excursions,
    scores,
    shellDelta,
  };
}

/** Maximal runs of one ring's samples that stay beyond the threshold on one side of the reference. */
function ringExcursions(samples: readonly Point[], signed: readonly number[], threshold: number, spacing: number): Excursion[] {
  if (!(threshold >= 0)) throw new Error("Excursion threshold must not be negative");
  const n = samples.length;
  const side = (value: number) => value > threshold ? 1 : value < -threshold ? -1 : 0;
  const build = (first: number, count: number, mouth: number): Excursion => {
    let at = first, depth = 0;
    for (let k = 0; k < count; k++) {
      const i = (first + k) % n;
      if (Math.abs(signed[i]) > depth) { depth = Math.abs(signed[i]); at = i; }
    }
    return { side: signed[at] > 0 ? "outside" : "inside", depth, mouth, length: count * spacing, at: { ...samples[at] } };
  };
  // Start where the side changes, so no run is split across the ring's seam.
  let seam = -1;
  for (let i = 0; i < n; i++) if (side(signed[i]) !== side(signed[(i + n - 1) % n])) { seam = i; break; }
  if (seam < 0) return n && side(signed[0]) !== 0 ? [build(0, n, Infinity)] : [];
  const found: Excursion[] = [];
  for (let k = 0; k < n;) {
    const first = (seam + k) % n, current = side(signed[first]);
    let count = 1;
    while (k + count < n && side(signed[(seam + k + count) % n]) === current) count++;
    if (current !== 0) {
      const last = samples[(first + count - 1) % n];
      found.push(build(first, count, Math.hypot(last.x - samples[first].x, last.y - samples[first].y)));
    }
    k += count;
  }
  return found;
}

/** How wiggles are told apart from the shape they sit on. */
export interface RoughnessOptions {
  /** Arc-length spacing of the boundary samples, in outline units. Must be positive. */
  spacing: number;
  /**
   * Smoothing length. The outline is compared with a copy of itself blurred
   * along its length by this much, so features much longer than this are shape
   * and features of about this length or shorter are roughness.
   */
  scale: number;
  /** Smallest swing to one side of the smoothed outline that counts. */
  minAmplitude: number;
}

/**
 * How jagged an outline is, without a reference.
 *
 * A stair-step or zigzag swings to one side of the smoothed outline and then
 * to the other within four times the scale. A corner swings to one side only,
 * and a step longer than that is shape, so neither counts. Genuine fine detail
 * that does swing both ways (a narrow shoulder, a tab, a thread) is counted, so
 * compare the same subject between methods, or against its reference outline,
 * and not against zero.
 */
export interface OutlineRoughness {
  /** Total boundary length. */
  perimeter: number;
  /** Boundary length lying in stair-steps or zigzags. */
  jaggedLength: number;
  /** `jaggedLength` as a fraction of the perimeter. */
  jaggedShare: number;
  /** Number of swings from one side of the smoothed outline to the other. */
  reversals: number;
  /**
   * Median peak-to-peak size of those swings; zero when there are none. A
   * swing larger than about the scale is under-reported, because the smoothed
   * outline starts to follow it.
   */
  ripple: number;
  /** Largest peak-to-peak swing. */
  rippleMax: number;
}

/** Measures stair-steps and zigzags along every ring of an outline. */
export function outlineRoughness(outline: Outline, options: RoughnessOptions): OutlineRoughness {
  const { spacing, scale, minAmplitude } = options;
  if (!(scale > 0) || !(minAmplitude >= 0)) throw new Error("Roughness scale must be positive and amplitude non-negative");
  let samples = 0, jagged = 0;
  const swings: number[] = [];
  for (const ring of rings(outline)) {
    const points = sampleRing(ring, spacing);
    samples += points.length;
    jagged += ringRoughness(points, spacing, scale, minAmplitude, swings);
  }
  swings.sort((a, b) => a - b);
  const middle = swings.length >> 1;
  return {
    perimeter: samples * spacing,
    jaggedLength: jagged * spacing,
    jaggedShare: samples ? jagged / samples : 0,
    reversals: swings.length,
    ripple: !swings.length ? 0 : swings.length % 2 ? swings[middle] : (swings[middle - 1] + swings[middle]) / 2,
    rippleMax: swings.at(-1) ?? 0,
  };
}

/** Returns the number of samples lying in zigzags and appends each swing's peak-to-peak size. */
function ringRoughness(points: readonly Point[], spacing: number, scale: number, minAmplitude: number, swings: number[]): number {
  const n = points.length;
  const radius = Math.min((n >> 1) - 1, Math.ceil(3 * scale / spacing));
  if (radius < 2) return 0;
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) * spacing / scale) ** 2));
  const total = kernel.reduce((sum, weight) => sum + weight, 0);
  const smooth: Point[] = points.map((_, i) => {
    let x = 0, y = 0;
    for (let k = -radius; k <= radius; k++) {
      const point = points[(i + k + n) % n], weight = kernel[k + radius];
      x += point.x * weight; y += point.y * weight;
    }
    return { x: x / total, y: y / total };
  });
  // Signed distance of each sample from the smoothed outline, along its normal.
  const residual = points.map((point, i) => {
    const before = smooth[(i + n - 1) % n], after = smooth[(i + 1) % n];
    const tx = after.x - before.x, ty = after.y - before.y, length = Math.hypot(tx, ty) || 1;
    return ((point.x - smooth[i].x) * -ty + (point.y - smooth[i].y) * tx) / length;
  });
  // The significant peak of every run of one sign, in ring order.
  let seam = -1;
  for (let i = 0; i < n; i++) if (residual[i] > 0 !== residual[(i + n - 1) % n] > 0) { seam = i; break; }
  if (seam < 0) return 0;
  const peaks: { index: number; value: number }[] = [];
  for (let k = 0; k < n;) {
    const positive = residual[(seam + k) % n] > 0;
    let best = k;
    let count = 0;
    while (k + count < n && residual[(seam + k + count) % n] > 0 === positive) {
      if (Math.abs(residual[(seam + k + count) % n]) > Math.abs(residual[(seam + best) % n])) best = k + count;
      count++;
    }
    if (Math.abs(residual[(seam + best) % n]) >= minAmplitude) peaks.push({ index: seam + best, value: residual[(seam + best) % n] });
    k += count;
  }
  // A swing is two neighbouring peaks on opposite sides, close together.
  const maxGap = Math.round(4 * scale / spacing), pad = Math.round(scale / spacing);
  const marked = new Uint8Array(n);
  for (let i = 0; i < peaks.length && peaks.length > 1; i++) {
    const a = peaks[i], b = peaks[(i + 1) % peaks.length];
    const gap = i + 1 < peaks.length ? b.index - a.index : b.index + n - a.index;
    if (a.value > 0 === b.value > 0 || gap > maxGap) continue;
    swings.push(Math.abs(a.value) + Math.abs(b.value));
    for (let j = a.index - pad; j <= a.index + gap + pad; j++) marked[((j % n) + n) % n] = 1;
  }
  let count = 0;
  for (const mark of marked) count += mark;
  return count;
}

/** Uniformly scales an outline, for converting pixel outlines to millimetres before comparison. */
export function scaleOutline(outline: Outline, factor: number): Outline {
  const scale = (ring: Ring): Ring => ring.map((point) => ({ x: point.x * factor, y: point.y * factor }));
  return outline.map((shape) => ({ outer: scale(shape.outer), holes: shape.holes.map(scale) }));
}
