import type { Rect } from "@shared/geometry/types";

/**
 * Background estimation and colour-distance scoring.
 *
 * The premise: a user photographing a tool has already framed the shot, so the
 * border of the image (or of their crop) is background almost by definition.
 * Sampling it gives a far more reliable reference than any global statistic,
 * and it is what lets the pipeline separate a dark tool from a dark mat.
 */

/** A background colour in CIE Lab. */
export interface LabColor {
  L: number;
  a: number;
  b: number;
}

/** Channel weights for the Lab distance used as the score field. */
export interface ScoreWeights {
  L: number;
  a: number;
  b: number;
}

/**
 * Lightness is deliberately down-weighted.
 *
 * A cast shadow keeps the mat's hue but drops its lightness sharply. Weighting
 * L equally with a/b makes shadows read as "unlike the background" and they get
 * traced as part of the tool — the dominant failure mode for photos of tools on
 * a bench. Chroma barely moves in shadow, so leaning on a/b rejects them.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = { L: 0.5, a: 1, b: 1 };

/** Width of the border band sampled for the background, in pixels. */
export function borderBandWidth(width: number, height: number): number {
  return Math.max(8, Math.round(Math.min(width, height) * 0.02));
}

/**
 * True when `(x, y)` lies in the border band of `rect`.
 *
 * Used as a sampling mask, so the estimate excludes the middle of the frame
 * where the subject sits.
 */
export function isInBorderBand(
  x: number,
  y: number,
  rect: Rect,
  band: number,
): boolean {
  const insideX = x >= rect.x + band && x < rect.x + rect.width - band;
  const insideY = y >= rect.y + band && y < rect.y + rect.height - band;
  return !(insideX && insideY);
}

/**
 * Median of a sample, used instead of a mean for background estimation.
 *
 * A mean is dragged off the true background whenever the subject touches the
 * frame edge and so occupies part of the border band — common when a long tool
 * runs off the side of the shot. A median ignores that contamination as long as
 * the subject covers less than half the band.
 *
 * Large inputs are subsampled: the estimate is a summary statistic, and sorting
 * a quarter-million floats on every detection is not worth the precision.
 */
export function medianOf(values: readonly number[], maxSamples = 50_000): number {
  if (values.length === 0) return 0;

  const stride = Math.max(1, Math.ceil(values.length / maxSamples));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += stride) sample.push(values[i]);

  sample.sort((a, b) => a - b);
  const mid = sample.length >> 1;
  return sample.length % 2 === 0 ? (sample[mid - 1] + sample[mid]) / 2 : sample[mid];
}

/** A linear illumination model `value ~= c0 + cx*x + cy*y`. */
export interface IlluminationPlane {
  c0: number;
  cx: number;
  cy: number;
}

/**
 * Least-squares plane fit over the border band only.
 *
 * Fitting the *background* rather than the whole frame is the crucial part. A
 * blur-based flat-field (divide by a blurred copy of the image) follows any
 * object wider than its kernel, so on a large subject it cancels exactly the
 * contrast we need — the same defect that made the old `adaptiveThreshold`
 * with a 31px block return edge bands instead of filled silhouettes. A plane
 * has three degrees of freedom and is sampled only where the subject is not,
 * so it can model the lighting ramp and nothing else.
 */
export function fitIlluminationPlane(
  values: ArrayLike<number>,
  width: number,
  height: number,
  band: number,
): IlluminationPlane {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sv = 0;
  let svx = 0;
  let svy = 0;

  const rect = { x: 0, y: 0, width, height };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInBorderBand(x, y, rect, band)) continue;
      const v = values[y * width + x];
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      syy += y * y;
      sv += v;
      svx += v * x;
      svy += v * y;
    }
  }

  if (n === 0) return { c0: 0, cx: 0, cy: 0 };

  // Normal equations for [1, x, y].
  const m = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ];
  const rhs = [sv, svx, svy];

  const det = determinant3(m);
  // A degenerate band (a single row or column) leaves the system singular;
  // fall back to a constant, which is still a valid illumination model.
  if (Math.abs(det) < 1e-9) return { c0: sv / n, cx: 0, cy: 0 };

  return {
    c0: determinant3(replaceColumn(m, 0, rhs)) / det,
    cx: determinant3(replaceColumn(m, 1, rhs)) / det,
    cy: determinant3(replaceColumn(m, 2, rhs)) / det,
  };
}

function determinant3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function replaceColumn(m: number[][], column: number, values: number[]): number[][] {
  return m.map((row, i) => row.map((v, j) => (j === column ? values[i] : v)));
}

/**
 * Subtracts the illumination ramp in place, keeping the overall level.
 *
 * Removing the ramp but preserving the mean means the background stays near a
 * constant value while subject contrast is untouched.
 */
export function removeIlluminationPlane(
  values: Float32Array,
  width: number,
  height: number,
  plane: IlluminationPlane,
): void {
  const centreX = (width - 1) / 2;
  const centreY = (height - 1) / 2;
  const reference = plane.c0 + plane.cx * centreX + plane.cy * centreY;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const modelled = plane.c0 + plane.cx * x + plane.cy * y;
      values[y * width + x] += reference - modelled;
    }
  }
}

/** sRGB (0-255) to CIE Lab, D65. */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  // Linear sRGB -> XYZ (D65), then normalised by the reference white.
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  // 6/29 cubed; below it the function is linear to keep the derivative finite.
  return t > 0.008856451679035631 ? Math.cbrt(t) : t / (3 * 0.20689655172413793 ** 2) + 4 / 29;
}

/**
 * Weighted Lab distance, mapped into 0-255.
 *
 * The divisor keeps typical tool-vs-mat separations in the upper half of the
 * range without saturating, so Otsu still has a well-shaped histogram to split.
 */
export function labDistanceScore(
  pixel: LabColor,
  background: LabColor,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): number {
  const dL = Math.abs(pixel.L - background.L) * weights.L;
  const da = Math.abs(pixel.a - background.a) * weights.a;
  const db = Math.abs(pixel.b - background.b) * weights.b;
  const distance = dL + da + db;
  return distance > 255 ? 255 : distance;
}

/**
 * True when the buffer carries meaningful transparency.
 *
 * Users often upload already-cut-out PNGs; when they do, the alpha channel is a
 * perfect mask and every heuristic below is a downgrade. Sampling rather than
 * scanning keeps this cheap on large images.
 */
export function hasUsefulAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sampleStride = 7,
): boolean {
  const pixels = width * height;
  if (pixels === 0) return false;

  let transparent = 0;
  let sampled = 0;
  for (let i = 0; i < pixels; i += sampleStride) {
    sampled++;
    if (data[i * 4 + 3] < 250) transparent++;
  }
  if (sampled === 0) return false;

  // A few stray semi-transparent pixels are noise; a real cut-out has a
  // substantial transparent surround.
  return transparent / sampled > 0.05;
}
