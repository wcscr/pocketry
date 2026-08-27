import type { Rect } from "@shared/geometry/types";

import {
  borderBandWidth,
  DEFAULT_SCORE_WEIGHTS,
  fitIlluminationPlane,
  hasUsefulAlpha,
  medianOf,
  removeIlluminationPlane,
} from "./background";
import { applySensitivity, otsuThreshold } from "./otsu";
import { clampRoi, morphKernelSize } from "./segment-js";
import { DETECT_DEFAULTS, type DetectOptions, type ImageLike, type ScoreField } from "./types";

/**
 * OpenCV-accelerated segmentation.
 *
 * Behaviourally equivalent to `segment-js.ts`; only the primitives differ.
 *
 * Two deliberate departures from the code this replaces:
 *
 * 1. **No CLAHE.** Local histogram equalisation amplifies mat texture and
 *    shadow gradients into the same range as the real tool boundary, which
 *    made every downstream threshold worse rather than better.
 * 2. **No contour finding.** OpenCV is used to build a continuous score field;
 *    the rings come from our own marching-squares tracer. `findContours`
 *    returns integer pixel coordinates (staircased on diagonals) and forces us
 *    to adopt its hierarchy semantics, whereas the tracer interpolates
 *    sub-pixel boundaries and is unit-testable without wasm.
 *
 * GrabCut survives only as an opt-in refinement seeded from our own mask. As it
 * was used before — rect-initialised to the whole ROI minus three pixels — very
 * nearly everything was seeded "probably foreground", which is why it kept
 * converging on near-rectangular silhouettes.
 */

// The OpenCV.js runtime is loaded from a UMD bundle at runtime and has no
// usable static type. Narrowing it would mean hand-maintaining a large surface;
// the module boundary here is small and every call is checked against the
// upstream docs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenCV = any;

/** Anything OpenCV allocates in the wasm heap. */
interface Deletable {
  delete(): void;
}

/**
 * Tracks OpenCV Mats so they are freed together.
 *
 * `cv.Mat` lives in the wasm heap and is not garbage collected. The previous
 * code disposed with an ad-hoc helper called at the end of the happy path,
 * which leaked every Mat allocated before a `throw` — notably the GrabCut
 * models — and leaked one wrapper per contour in the selection loop. Disposing
 * from a `finally` removes that whole class of bug.
 */
class MatScope {
  private readonly tracked: Deletable[] = [];

  track<T extends Deletable>(mat: T): T {
    this.tracked.push(mat);
    return mat;
  }

  dispose(): void {
    for (let i = this.tracked.length - 1; i >= 0; i--) {
      try {
        this.tracked[i].delete();
      } catch {
        // Already freed elsewhere; nothing to do.
      }
    }
    this.tracked.length = 0;
  }
}

/**
 * Builds the score field with OpenCV.
 *
 * `cv` is a parameter rather than a module import so the same code runs on the
 * main thread, inside a worker, and under Vitest in Node against the
 * `@techstark/opencv-js` build.
 */
export function buildScoreFieldOpenCV(
  cv: OpenCV,
  image: ImageLike,
  options: DetectOptions = {},
): ScoreField {
  const scope = new MatScope();
  try {
    const roi = clampRoi(options.roi ?? null, image.width, image.height);
    const maxPixels = options.maxPixels ?? DETECT_DEFAULTS.maxPixels;
    const sensitivity = options.sensitivity ?? DETECT_DEFAULTS.sensitivity;
    const useAlpha = options.useAlpha ?? DETECT_DEFAULTS.useAlpha;

    const rgba = scope.track(cv.matFromImageData(toImageData(image)));

    // Crop to the ROI, then area-average down to the pixel budget.
    const cropped =
      roi.width === image.width && roi.height === image.height
        ? rgba
        : scope.track(rgba.roi(new cv.Rect(roi.x, roi.y, roi.width, roi.height)));

    const pixels = roi.width * roi.height;
    const downscale = pixels > maxPixels ? Math.sqrt(maxPixels / pixels) : 1;
    const width = Math.max(1, Math.round(roi.width * downscale));
    const height = Math.max(1, Math.round(roi.height * downscale));

    let working = cropped;
    if (downscale !== 1) {
      const resized = scope.track(new cv.Mat());
      cv.resize(cropped, resized, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
      working = resized;
    }

    const alphaWanted =
      useAlpha === "always" ||
      (useAlpha === "auto" &&
        hasUsefulAlpha(imageDataOf(cv, working, scope), width, height));

    const score = alphaWanted
      ? alphaScore(cv, working, scope, width, height)
      : colorScore(cv, working, scope, width, height);

    const otsu = alphaWanted ? 128 : otsuThreshold(score);
    const iso = alphaWanted ? 128 : applySensitivity(otsu, sensitivity);

    cleanAndGate(cv, scope, score, width, height, iso);

    return {
      score,
      width,
      height,
      scale: width / roi.width,
      offsetX: roi.x,
      offsetY: roi.y,
      iso,
      otsu,
    };
  } finally {
    scope.dispose();
  }
}

/** `ImageLike` is structurally an `ImageData`; OpenCV only reads the fields. */
function toImageData(image: ImageLike): ImageData {
  return image as ImageData;
}

/** Reads a CV_8UC4 Mat back as a flat RGBA buffer. */
function imageDataOf(cv: OpenCV, mat: OpenCV, scope: MatScope): Uint8ClampedArray {
  if (mat.type() === cv.CV_8UC4) return new Uint8ClampedArray(mat.data);
  const rgba = scope.track(new cv.Mat());
  cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
  return new Uint8ClampedArray(rgba.data);
}

/** Alpha channel promoted straight to a score field. */
function alphaScore(
  cv: OpenCV,
  mat: OpenCV,
  scope: MatScope,
  width: number,
  height: number,
): Uint8Array {
  const data = imageDataOf(cv, mat, scope);
  const score = new Uint8Array(width * height);
  for (let i = 0; i < score.length; i++) score[i] = data[i * 4 + 3];
  return score;
}

/**
 * Weighted Lab distance from a border-band background estimate.
 *
 * OpenCV's `COLOR_RGB2Lab` on 8-bit input returns L in 0..255 and a/b offset by
 * 128, so the weights are applied in that scaled space and the result is
 * normalised to 0..255 at the end.
 */
function colorScore(
  cv: OpenCV,
  mat: OpenCV,
  scope: MatScope,
  width: number,
  height: number,
): Uint8Array {
  const rgb = scope.track(new cv.Mat());
  cv.cvtColor(mat, rgb, mat.type() === cv.CV_8UC4 ? cv.COLOR_RGBA2RGB : cv.COLOR_RGB2RGB);

  const lab = scope.track(new cv.Mat());
  cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);

  const planes = scope.track(new cv.MatVector());
  cv.split(lab, planes);
  const L = scope.track(planes.get(0));
  const A = scope.track(planes.get(1));
  const B = scope.track(planes.get(2));

  const aData = A.data as Uint8Array;
  const bData = B.data as Uint8Array;

  // Remove the illumination ramp by fitting a plane to the border band only —
  // the same correction as the JS backend, and for the same reason: a blur- or
  // divide-based flat field follows any object wider than its kernel and
  // cancels the very contrast being measured.
  const lData = Float32Array.from(L.data as Uint8Array);
  const band = borderBandWidth(width, height);
  removeIlluminationPlane(
    lData,
    width,
    height,
    fitIlluminationPlane(lData, width, height, band),
  );

  const reference = estimateBorderMedian(lData, aData, bData, width, height);

  const score = new Uint8Array(width * height);
  const weights = DEFAULT_SCORE_WEIGHTS;
  for (let i = 0; i < score.length; i++) {
    const distance =
      Math.abs(lData[i] - reference.L) * weights.L +
      Math.abs(aData[i] - reference.a) * weights.a +
      Math.abs(bData[i] - reference.b) * weights.b;
    score[i] = distance > 255 ? 255 : distance;
  }
  return score;
}

/**
 * Median of each plane over the border band — the same robust estimator the JS
 * backend uses, so the two agree on where the background is.
 */
function estimateBorderMedian(
  L: ArrayLike<number>,
  A: ArrayLike<number>,
  B: ArrayLike<number>,
  width: number,
  height: number,
): { L: number; a: number; b: number } {
  const band = borderBandWidth(width, height);
  const Ls: number[] = [];
  const as: number[] = [];
  const bs: number[] = [];

  for (let y = 0; y < height; y++) {
    const inRowBand = y < band || y >= height - band;
    for (let x = 0; x < width; x++) {
      if (!inRowBand && x >= band && x < width - band) continue;
      const i = y * width + x;
      Ls.push(L[i]);
      as.push(A[i]);
      bs.push(B[i]);
    }
  }

  if (Ls.length === 0) {
    for (let i = 0; i < L.length; i++) {
      Ls.push(L[i]);
      as.push(A[i]);
      bs.push(B[i]);
    }
  }

  return { L: medianOf(Ls), a: medianOf(as), b: medianOf(bs) };
}

/**
 * Morphological open then close on the thresholded mask, with the cleaned
 * result gated back onto the score field.
 */
function cleanAndGate(
  cv: OpenCV,
  scope: MatScope,
  score: Uint8Array,
  width: number,
  height: number,
  iso: number,
): void {
  const size = morphKernelSize(width, height);
  if (size <= 1) return;

  const mask = scope.track(cv.matFromArray(height, width, cv.CV_8UC1, Array.from(score)));
  const binary = scope.track(new cv.Mat());
  cv.threshold(mask, binary, iso - 1, 255, cv.THRESH_BINARY);

  const kernel = scope.track(
    cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(size, size)),
  );
  cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 1);
  cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1);

  const cleaned = binary.data as Uint8Array;
  for (let i = 0; i < score.length; i++) {
    if (cleaned[i] === 0) score[i] = 0;
  }
}

/** Region of interest helper re-exported for callers that only import this module. */
export type { Rect };
