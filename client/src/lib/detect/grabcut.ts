import { MatScope, type OpenCV } from "./segment-opencv";
import { clampRoi } from "./segment-js";
import type { DetectOptions, ImageLike, RefinementReport, ScoreField } from "./types";

// This is an eligibility limit, NOT a new image-resolution cap. Large rectified
// images keep their full-resolution baseline instead of running a large graph
// cut or silently shrinking narrow features. A normal 800×600 trace fits.
export const GRABCUT_MAX_PIXELS = 750_000;
export const GRABCUT_ITERATIONS = 2;

export function checkDetectionAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Detection aborted", "AbortError");
}

/** A task yield (not a microtask) lets worker cancel messages reach the signal. */
export async function detectionCheckpoint(signal?: AbortSignal): Promise<void> {
  checkDetectionAbort(signal);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  checkDetectionAbort(signal);
}

/**
 * Independently designed, conservative mask refinement. GrabCut proposes colour
 * segmentation; it is not allowed to invent geometry. In this first version we
 * accept subtraction only: existing background, including open bays and holes,
 * is a veto on growth. Unsupported additions require a different evidence model.
 * Thin, high-score runs and foreground at the ROI boundary are protected seeds.
 * Component loss, splitting, new holes, or substantial area loss rejects the
 * proposal. Neither symmetry nor extra smoothing is involved.
 */
export async function refineWithGrabCut(
  cv: OpenCV,
  image: ImageLike,
  field: ScoreField,
  options: DetectOptions = {},
): Promise<{ field: ScoreField; report: RefinementReport }> {
  let iterations = 0;
  const unchanged = (status: RefinementReport["status"], reason: string) => ({
    field, report: { status, reason, iterations },
  });
  checkDetectionAbort(options.signal);
  if (field.alphaUsed) return unchanged("skipped", "alpha-mask");
  if (options.occlusions?.length) return unchanged("skipped", "occluded-boundary");
  if (field.width * field.height > GRABCUT_MAX_PIXELS) return unchanged("skipped", "pixel-budget");
  if (typeof cv.grabCut !== "function") return unchanged("skipped", "unavailable");

  const scope = new MatScope();
  try {
    const { width, height, iso, score } = field;
    const evidence = field.evidence ?? score;
    const baseline = Uint8Array.from(score, v => v >= iso ? 1 : 0);
    const seeds = buildGrabCutSeeds(baseline, evidence, width, height, iso);
    let foreground = 0;
    let background = 0;
    for (const value of seeds) {
      if (value === 1) foreground++;
      if (value === 0) background++;
    }
    // Each GMM has five components. A blank/tiny/ambiguous selection must not
    // reach OpenCV's assertion or seed arbitrary corners as background.
    if (foreground < 5 || background < 5) return unchanged("skipped", "insufficient-seeds");
    await detectionCheckpoint(options.signal);

    const roi = clampRoi(options.roi ?? null, image.width, image.height);
    const rgba = scope.track(cv.matFromImageData(image));
    const cropped = scope.track(rgba.roi(new cv.Rect(roi.x, roi.y, roi.width, roi.height)));
    const working = scope.track(new cv.Mat());
    cv.resize(cropped, working, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    const rgb = scope.track(new cv.Mat());
    cv.cvtColor(working, rgb, cv.COLOR_RGBA2RGB);
    const mask = scope.track(cv.matFromArray(height, width, cv.CV_8UC1, seeds));
    const bg = scope.track(new cv.Mat());
    const fg = scope.track(new cv.Mat());

    // GrabCut initializes GMMs with k-means. A fixed RNG seed makes repeated
    // traces comparable; the detection worker serializes all uses of this cv.
    cv.setRNGSeed(0);

    for (let pass = 0; pass < GRABCUT_ITERATIONS; pass++) {
      await detectionCheckpoint(options.signal);
      // CPU/WASM, synchronous within one bounded iteration. The worker keeps
      // this off the UI thread; it does not make the graph-cut solver faster.
      cv.grabCut(rgb, mask, new cv.Rect(), bg, fg, 1,
        pass === 0 ? cv.GC_INIT_WITH_MASK : cv.GC_EVAL);
      iterations++;
    }
    await detectionCheckpoint(options.signal);
    const candidate = Uint8Array.from(mask.data as Uint8Array,
      (v, i) => baseline[i] && (v === cv.GC_FGD || v === cv.GC_PR_FGD) ? 1 : 0);
    const reason = rejectMaskChange(baseline, candidate, width, height, options);
    if (reason) return unchanged("fallback", reason);

    let changedPixels = 0;
    const refinedScore = score.slice();
    for (let i = 0; i < score.length; i++) {
      if (baseline[i] !== candidate[i]) {
        changedPixels++;
        refinedScore[i] = Math.max(0, iso - 1);
      }
    }
    if (!changedPixels) return unchanged("skipped", "unchanged");
    // Keep subpixel evidence on untouched edges. At a newly cut edge use a
    // symmetric crossing at the pixel boundary, not iso/255-biased coordinates.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!candidate[i]) continue;
      if ((x > 0 && baseline[i - 1] && !candidate[i - 1]) ||
          (x + 1 < width && baseline[i + 1] && !candidate[i + 1]) ||
          (y > 0 && baseline[i - width] && !candidate[i - width]) ||
          (y + 1 < height && baseline[i + width] && !candidate[i + width])) {
        refinedScore[i] = Math.min(255, iso + 1);
      }
    }
    return {
      field: { ...field, score: refinedScore },
      report: { status: "accepted", reason: "supported-subtraction", iterations, changedPixels },
    };
  } catch (error) {
    checkDetectionAbort(options.signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    return unchanged("fallback", "grabcut-failed");
  } finally {
    scope.dispose();
  }
}

/** GrabCut labels: definite BG=0, definite FG=1, probable BG=2, probable FG=3. */
export function buildGrabCutSeeds(
  mask: Uint8Array, evidence: Uint8Array, width: number, height: number, iso: number,
): Uint8Array {
  const thin = new Uint8Array(mask.length);
  // Widths below the seven-pixel interior window have no interior seed. Protect
  // these narrow features through six pixels, without a gap between the rules.
  // Require
  // a run of connected candidates, so isolated edge speckles are not protected.
  for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
    const start = x;
    const value = mask[y * width + x];
    while (x < width && mask[y * width + x] === value) x++;
    if (value && x - start <= 6) for (let xx = start; xx < x; xx++) thin[y * width + xx] = 1;
  }
  for (let x = 0; x < width; x++) for (let y = 0; y < height;) {
    const start = y;
    const value = mask[y * width + x];
    while (y < height && mask[y * width + x] === value) y++;
    if (value && y - start <= 6) for (let yy = start; yy < y; yy++) thin[yy * width + x] = 1;
  }
  const branches = components(thin, width, height, 1, true);
  const strong = new Uint8Array(branches.sizes.length);
  for (let i = 0; i < mask.length; i++) {
    if (thin[i] && evidence[i] >= Math.max(iso + 2, iso * 1.5)) strong[branches.labels[i]] = 1;
  }
  const labels = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    labels[i] = mask[i] ? 3 : 2;
    let interior = true;
    for (let yy = Math.max(0, y - 3); yy <= Math.min(height - 1, y + 3) && interior; yy++) {
      for (let xx = Math.max(0, x - 3); xx <= Math.min(width - 1, x + 3); xx++) {
        if (mask[yy * width + xx] !== mask[i]) { interior = false; break; }
      }
    }
    const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    const branch = thin[i] && branches.sizes[branches.labels[i]] >= 8 && strong[branches.labels[i]];
    if (mask[i] && ((interior && evidence[i] >= Math.max(iso + 2, iso * 1.5)) || branch || edge)) labels[i] = 1;
    if (!mask[i] && evidence[i] < iso && (interior || evidence[i] <= iso * 0.5)) labels[i] = 0;
  }
  return labels;
}

/** Linear-time component labels. Foreground uses 4-connectivity, BG uses 8. */
function components(mask: Uint8Array, width: number, height: number, value: number, diagonal = false) {
  const labels = new Int32Array(mask.length);
  const queue = new Uint32Array(mask.length);
  const sizes = [0];
  const border = [false];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== value || labels[i]) continue;
    const label = sizes.length;
    let head = 0;
    let tail = 1;
    let edge = false;
    queue[0] = i;
    labels[i] = label;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = Math.floor(p / width);
      if (!x || !y || x === width - 1 || y === height - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const n = yy * width + xx;
        if (!labels[n] && mask[n] === value) { labels[n] = label; queue[tail++] = n; }
      }
    }
    sizes.push(tail);
    border.push(edge);
  }
  return { labels, sizes, border };
}

/** Reject per-object damage; a large tool cannot hide the loss of a small one. */
export function rejectMaskChange(
  baseline: Uint8Array, candidate: Uint8Array, width: number, height: number,
  options: Pick<DetectOptions, "minShellAreaFrac" | "minHoleAreaFrac"> = {},
): string | undefined {
  const before = components(baseline, width, height, 1);
  const after = components(candidate, width, height, 1);
  const largest = before.sizes.reduce((a, b) => Math.max(a, b), 0);
  const minArea = Math.max(8, largest * (options.minShellAreaFrac ?? 0.01));
  const retained = new Uint32Array(before.sizes.length);
  const fragments = new Uint32Array(before.sizes.length);
  const seen = new Uint8Array(after.sizes.length);
  for (let i = 0; i < baseline.length; i++) {
    if (candidate[i] && !baseline[i]) return "unsupported-growth";
    if (!candidate[i]) continue;
    const b = before.labels[i], a = after.labels[i];
    retained[b]++;
    if (!seen[a] && after.sizes[a] >= minArea) { fragments[b]++; seen[a] = 1; }
  }
  for (let i = 1; i < before.sizes.length; i++) {
    if (before.sizes[i] < minArea) continue;
    if (retained[i] < before.sizes[i] * 0.75) return "object-area-loss";
    if (fragments[i] !== 1) return "object-topology";
  }
  const holes = (mask: Uint8Array) => {
    const bg = components(mask, width, height, 0, true);
    return bg.sizes.reduce((count, size, i) => count + (i > 0 && !bg.border[i] &&
      size >= Math.max(4, largest * (options.minHoleAreaFrac ?? 0.001)) ? 1 : 0), 0);
  };
  if (holes(baseline) !== holes(candidate)) return "hole-topology";
  return undefined;
}
