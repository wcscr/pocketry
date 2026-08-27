/**
 * Otsu's method and the sensitivity bias that sits on top of it.
 *
 * Pure and dependency-free so it can be unit-tested without OpenCV, and so the
 * JS fallback and the OpenCV path share exactly one definition of "where the
 * threshold goes".
 */

/** 256-bin histogram of an 8-bit single-channel buffer. */
export function histogram(values: ArrayLike<number>): Uint32Array {
  const bins = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) {
    // Clamp defensively: Float32 score buffers can carry out-of-range values.
    const v = values[i];
    bins[v < 0 ? 0 : v > 255 ? 255 : v | 0]++;
  }
  return bins;
}

/**
 * Otsu's threshold: the level maximising between-class variance.
 *
 * Returns the level `t` such that samples with value `>= t` are foreground.
 * Returns 0 for an empty or single-valued input, where no split is meaningful.
 */
export function otsuThreshold(values: ArrayLike<number>): number {
  return otsuFromHistogram(histogram(values));
}

/**
 * Otsu's threshold from a precomputed histogram.
 *
 * Between-class variance only changes at populated bins, so the maximum is
 * normally a **plateau** spanning the empty gap between two modes. This returns
 * the middle of that plateau rather than its first index (which is what OpenCV
 * does). On a real photo the difference matters: with background, a cast
 * shadow, and the tool at scores 0, 11 and 40, the plateau runs 11..39 and the
 * first index puts the threshold exactly *on* the shadow, so the shadow gets
 * traced as part of the tool. The midpoint sits safely between the modes.
 */
export function otsuFromHistogram(bins: Uint32Array): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += bins[i];
    sum += i * bins[i];
  }
  if (total === 0) return 0;

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let plateauStart = 0;
  let plateauEnd = 0;

  for (let t = 0; t < 256; t++) {
    backgroundWeight += bins[t];
    if (backgroundWeight === 0) continue;

    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundSum += t * bins[t];

    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const delta = backgroundMean - foregroundMean;
    // Between-class variance, dropping the constant 1/total² factor.
    const variance = backgroundWeight * foregroundWeight * delta * delta;

    // Relative tolerance, because the running sums make exactly-equal
    // plateau values unreliable in floating point.
    if (variance > bestVariance * (1 + 1e-12)) {
      bestVariance = variance;
      plateauStart = t;
      plateauEnd = t;
    } else if (variance >= bestVariance * (1 - 1e-12)) {
      plateauEnd = t;
    }
  }

  // The level is the split point, so the plateau's upper end is exclusive:
  // the first populated bin above it belongs to the foreground.
  return Math.floor((plateauStart + plateauEnd + 1) / 2);
}

/**
 * Applies the user's sensitivity bias to an automatic threshold.
 *
 * The UI slider is 0-255 with 128 meaning "trust Otsu". Scaling rather than
 * offsetting keeps the control's feel consistent across images whose Otsu
 * levels differ widely — an offset of 20 is drastic on a level of 30 and
 * negligible on a level of 200.
 *
 * The result is clamped to 1..254 so the tracer always has background on at
 * least one side of the level; an iso of 0 or 255 yields no contour at all.
 */
export function applySensitivity(otsu: number, sensitivity: number): number {
  const safe = Number.isFinite(sensitivity) ? sensitivity : 128;
  const scaled = otsu * (safe / 128);
  return Math.max(1, Math.min(254, Math.round(scaled)));
}
