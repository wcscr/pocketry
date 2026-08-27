import type { Rect } from "@shared/geometry/types";

import {
  borderBandWidth,
  DEFAULT_SCORE_WEIGHTS,
  fitIlluminationPlane,
  hasUsefulAlpha,
  isInBorderBand,
  labDistanceScore,
  medianOf,
  removeIlluminationPlane,
  rgbToLab,
  type LabColor,
} from "./background";
import { applySensitivity, otsuThreshold } from "./otsu";
import { DETECT_DEFAULTS, type DetectOptions, type ImageLike, type ScoreField } from "./types";

/**
 * Pure-TypeScript segmentation.
 *
 * This is the reference implementation of the pipeline's semantics and the
 * fallback used when OpenCV.js fails to load. `segment-opencv.ts` performs the
 * same steps with accelerated primitives and must stay behaviourally
 * equivalent — having one definition of the algorithm is why the app no longer
 * has a "standard" and an "experimental" mode that disagree.
 *
 * Steps: downscale to the pixel budget, optionally take the alpha channel
 * directly, flat-field the lightness, estimate the background from the border
 * band, score every pixel by weighted Lab distance from it, threshold with
 * Otsu plus the user's bias, clean up with morphology, and gate the score by
 * the cleaned mask so the tracer sees clean topology but sub-pixel edges.
 */
export function buildScoreFieldJS(
  image: ImageLike,
  options: DetectOptions = {},
): ScoreField {
  const roi = clampRoi(options.roi ?? null, image.width, image.height);
  const maxPixels = options.maxPixels ?? DETECT_DEFAULTS.maxPixels;
  const sensitivity = options.sensitivity ?? DETECT_DEFAULTS.sensitivity;
  const useAlpha = options.useAlpha ?? DETECT_DEFAULTS.useAlpha;

  const region = downscaleRegion(image, roi, maxPixels);
  const { width, height, data, scale } = region;

  const alphaWanted =
    useAlpha === "always" ||
    (useAlpha === "auto" && hasUsefulAlpha(data, width, height));

  const score = alphaWanted
    ? scoreFromAlpha(data, width, height)
    : scoreFromColor(data, width, height);

  // With a real alpha mask the split is unambiguous, so skip Otsu and take the
  // conventional half-opaque cut.
  const otsu = alphaWanted ? 128 : otsuThreshold(score);
  const iso = alphaWanted ? 128 : applySensitivity(otsu, sensitivity);

  const mask = threshold(score, iso);
  const kernel = morphKernelSize(width, height);
  if (kernel > 1) {
    morphOpen(mask, width, height, kernel);
    morphClose(mask, width, height, kernel);
  }
  gateByMask(score, mask);

  return {
    score,
    width,
    height,
    scale,
    offsetX: roi.x,
    offsetY: roi.y,
    iso,
    otsu,
  };
}

/** Confines a region of interest to the image, with a sane default. */
export function clampRoi(
  roi: Rect | null,
  width: number,
  height: number,
): Rect {
  if (!roi || roi.width <= 0 || roi.height <= 0) {
    return { x: 0, y: 0, width, height };
  }
  const x = Math.max(0, Math.min(Math.floor(roi.x), width - 1));
  const y = Math.max(0, Math.min(Math.floor(roi.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.ceil(roi.width), width - x)),
    height: Math.max(1, Math.min(Math.ceil(roi.height), height - y)),
  };
}

interface DownscaledRegion {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Segmentation pixels per source pixel. */
  scale: number;
}

/**
 * Crops to the ROI and area-averages down to the pixel budget.
 *
 * Area averaging (rather than nearest-neighbour) matters: it antialiases the
 * boundary, which is exactly the gradient the sub-pixel tracer interpolates
 * across.
 */
export function downscaleRegion(
  image: ImageLike,
  roi: Rect,
  maxPixels: number,
): DownscaledRegion {
  const pixels = roi.width * roi.height;
  const scale = pixels > maxPixels ? Math.sqrt(maxPixels / pixels) : 1;

  const width = Math.max(1, Math.round(roi.width * scale));
  const height = Math.max(1, Math.round(roi.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);

  const sx = roi.width / width;
  const sy = roi.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = roi.y + Math.floor(y * sy);
    const y1 = Math.min(roi.y + roi.height, roi.y + Math.ceil((y + 1) * sy));

    for (let x = 0; x < width; x++) {
      const x0 = roi.x + Math.floor(x * sx);
      const x1 = Math.min(roi.x + roi.width, roi.x + Math.ceil((x + 1) * sx));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let yy = y0; yy < Math.max(y1, y0 + 1); yy++) {
        for (let xx = x0; xx < Math.max(x1, x0 + 1); xx++) {
          const i = (yy * image.width + xx) * 4;
          r += image.data[i];
          g += image.data[i + 1];
          b += image.data[i + 2];
          a += image.data[i + 3];
          count++;
        }
      }

      const o = (y * width + x) * 4;
      out[o] = r / count;
      out[o + 1] = g / count;
      out[o + 2] = b / count;
      out[o + 3] = a / count;
    }
  }

  return { data: out, width, height, scale: width / roi.width };
}

/** Alpha channel promoted straight to a score field. */
function scoreFromAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const score = new Uint8Array(width * height);
  for (let i = 0; i < score.length; i++) score[i] = data[i * 4 + 3];
  return score;
}

/** Weighted Lab distance from the border-band background estimate. */
function scoreFromColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const lab = toLabPlanes(data, width, height);
  flatFieldLightness(lab.L, width, height);
  const background = estimateBackgroundLab(lab, width, height);

  const score = new Uint8Array(width * height);
  for (let i = 0; i < score.length; i++) {
    score[i] = labDistanceScore(
      { L: lab.L[i], a: lab.a[i], b: lab.b[i] },
      background,
      DEFAULT_SCORE_WEIGHTS,
    );
  }
  return score;
}

interface LabPlanes {
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
}

function toLabPlanes(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): LabPlanes {
  const n = width * height;
  const planes: LabPlanes = {
    L: new Float32Array(n),
    a: new Float32Array(n),
    b: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const lab = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    planes.L[i] = lab.L;
    planes.a[i] = lab.a;
    planes.b[i] = lab.b;
  }
  return planes;
}

/**
 * Removes the illumination ramp from the lightness plane.
 *
 * Fits a plane to the **border band only** and subtracts it, so the correction
 * models the lighting and cannot be dragged around by the subject. Dividing by
 * a blurred copy of the whole image — the obvious alternative — follows any
 * object wider than the blur kernel and cancels exactly the contrast being
 * measured.
 */
export function flatFieldLightness(
  L: Float32Array,
  width: number,
  height: number,
): void {
  const band = borderBandWidth(width, height);
  const plane = fitIlluminationPlane(L, width, height, band);
  removeIlluminationPlane(L, width, height, plane);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Median Lab colour over the border band.
 *
 * The median rather than the mean, so a subject that runs off the edge of the
 * frame — and therefore occupies part of the band — does not drag the estimate
 * toward itself.
 */
export function estimateBackgroundLab(
  lab: LabPlanes,
  width: number,
  height: number,
): LabColor {
  const band = borderBandWidth(width, height);
  const rect: Rect = { x: 0, y: 0, width, height };

  const Ls: number[] = [];
  const as: number[] = [];
  const bs: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInBorderBand(x, y, rect, band)) continue;
      const i = y * width + x;
      Ls.push(lab.L[i]);
      as.push(lab.a[i]);
      bs.push(lab.b[i]);
    }
  }

  // A region smaller than twice the band has no interior, so the band selects
  // nothing; fall back to the whole region.
  if (Ls.length === 0) {
    for (let i = 0; i < width * height; i++) {
      Ls.push(lab.L[i]);
      as.push(lab.a[i]);
      bs.push(lab.b[i]);
    }
  }

  return { L: medianOf(Ls), a: medianOf(as), b: medianOf(bs) };
}

/** Structuring-element size, scaled to the image so it means the same thing at any resolution. */
export function morphKernelSize(width: number, height: number): number {
  const size = Math.max(3, Math.round(Math.min(width, height) / 300));
  return size % 2 === 0 ? size + 1 : size; // Odd, so it has a centre.
}

function threshold(score: Uint8Array, iso: number): Uint8Array {
  const mask = new Uint8Array(score.length);
  for (let i = 0; i < score.length; i++) mask[i] = score[i] >= iso ? 1 : 0;
  return mask;
}

/** Binary erosion followed by dilation: removes speckles. */
function morphOpen(mask: Uint8Array, width: number, height: number, size: number): void {
  const radius = (size - 1) / 2;
  erode(mask, width, height, radius);
  dilate(mask, width, height, radius);
}

/** Binary dilation followed by erosion: closes pinholes. */
function morphClose(mask: Uint8Array, width: number, height: number, size: number): void {
  const radius = (size - 1) / 2;
  dilate(mask, width, height, radius);
  erode(mask, width, height, radius);
}

/** Separable min filter (square structuring element). */
function erode(mask: Uint8Array, width: number, height: number, radius: number): void {
  rankFilter(mask, width, height, radius, false);
}

/** Separable max filter (square structuring element). */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): void {
  rankFilter(mask, width, height, radius, true);
}

/**
 * Separable min/max filter over a square window.
 *
 * A square element is separable and therefore O(n·r) rather than O(n·r²); at
 * these radii the difference from a disc is a fraction of a pixel and is washed
 * out by the smoothing pass downstream.
 */
function rankFilter(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  wantMax: boolean,
): void {
  const temp = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = wantMax ? 0 : 1;
      for (let k = -radius; k <= radius; k++) {
        const v = mask[row + clamp(x + k, 0, width - 1)];
        value = wantMax ? (v > value ? v : value) : v < value ? v : value;
      }
      temp[row + x] = value;
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let value = wantMax ? 0 : 1;
      for (let k = -radius; k <= radius; k++) {
        const v = temp[clamp(y + k, 0, height - 1) * width + x];
        value = wantMax ? (v > value ? v : value) : v < value ? v : value;
      }
      mask[y * width + x] = value;
    }
  }
}

/**
 * Zeroes the score wherever morphology rejected the pixel.
 *
 * The tracer then sees the cleaned topology (no speckles, no pinholes) while
 * still getting the original gradient at real boundaries, which is what its
 * sub-pixel interpolation needs.
 */
function gateByMask(score: Uint8Array, mask: Uint8Array): void {
  for (let i = 0; i < score.length; i++) {
    if (mask[i] === 0) score[i] = 0;
  }
}

/** Rebuilds the binary mask from a gated score field, for debug output. */
export function maskFromScore(field: ScoreField): Uint8Array {
  const mask = new Uint8Array(field.width * field.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = field.score[i] >= field.iso ? 255 : 0;
  }
  return mask;
}
