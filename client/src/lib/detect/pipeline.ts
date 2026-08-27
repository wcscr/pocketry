import type { Outline, Point } from "@shared/geometry/types";

import { buildOutline, normalizeOutline } from "../geometry/outline";
import {
  resampleOutline,
  simplifyOutline,
  smoothOutline,
} from "../geometry/simplify";
import { traceIsoRings } from "../geometry/trace";
import { loadOpenCV } from "../opencv";
import { buildScoreFieldJS, maskFromScore } from "./segment-js";
import { buildScoreFieldOpenCV } from "./segment-opencv";
import {
  DETECT_DEFAULTS,
  type DetectEngine,
  type DetectOptions,
  type DetectResult,
  type ImageLike,
  type ScoreField,
} from "./types";

/**
 * The single detection pipeline.
 *
 * There used to be two mutually exclusive paths chosen by a `useExperimentalMode`
 * flag. The default one bagged unordered Canny edge pixels and ran them through
 * a convex hull, so it could not represent a concave outline at all; the other
 * kept only the largest `RETR_EXTERNAL` contour, so it could not represent
 * holes. Both are gone. There is now one path, and its OpenCV and pure-JS
 * backends are behaviourally equivalent — the JS one is a genuine fallback
 * rather than a degraded second mode.
 */
export async function detectOutline(
  image: ImageLike,
  options: DetectOptions = {},
): Promise<DetectResult> {
  const timings: Record<string, number> = {};

  const { field, engine } = await segment(image, options, timings);
  throwIfAborted(options.signal);

  const rawOutline = time(timings, "trace", () => traceToOutline(field, options));
  throwIfAborted(options.signal);

  const outline = time(timings, "refine", () => refineOutline(rawOutline, options, field));

  return {
    outline,
    rawOutline,
    threshold: field.iso,
    otsuThreshold: field.otsu,
    engine,
    timings,
    debug: options.debug ? buildDebug(field) : undefined,
  };
}

/**
 * Re-derives the presentation outline from a cached dense one.
 *
 * The Detail and Smoothing controls call this instead of `detectOutline`, so
 * dragging a slider costs a few milliseconds of polygon work rather than a full
 * re-segmentation.
 */
export function refineOutline(
  rawOutline: Outline,
  options: DetectOptions = {},
  field?: Pick<ScoreField, "scale">,
): Outline {
  const tolerancePx = options.tolerancePx ?? DETECT_DEFAULTS.tolerancePx;
  const smoothing = options.smoothing ?? DETECT_DEFAULTS.smoothing;
  const minShellAreaFrac = options.minShellAreaFrac ?? DETECT_DEFAULTS.minShellAreaFrac;
  const minHoleAreaFrac = options.minHoleAreaFrac ?? DETECT_DEFAULTS.minHoleAreaFrac;

  // Tolerances are expressed in source pixels; when segmentation ran on a
  // downscaled copy, a source pixel is worth less than a segmentation pixel and
  // the polygon steps are correspondingly coarser.
  const scale = field?.scale ?? 1;
  const sourcePerSegPixel = scale > 0 ? 1 / scale : 1;

  let outline = rawOutline;

  if (smoothing > 0) {
    // Resample first: a Taubin pass weights neighbours equally, so on an
    // unevenly sampled ring it would smooth dense stretches far harder than
    // sparse ones.
    const spacing = Math.max(1, sourcePerSegPixel);
    outline = resampleOutline(outline, spacing);
    outline = smoothOutline(outline, { iterations: smoothing });
  }

  if (tolerancePx > 0) {
    outline = simplifyOutline(outline, tolerancePx);
  }

  return normalizeOutline(outline, { minShellAreaFrac, minHoleAreaFrac });
}

/** Runs the requested backend, falling back to JS when OpenCV is unavailable. */
async function segment(
  image: ImageLike,
  options: DetectOptions,
  timings: Record<string, number>,
): Promise<{ field: ScoreField; engine: DetectEngine }> {
  const requested = options.engine ?? DETECT_DEFAULTS.engine;

  if (requested !== "js") {
    try {
      const cv = await loadOpenCV();
      const started = now();
      const field = buildScoreFieldOpenCV(cv, image, options);
      timings.segment = now() - started;
      return { field, engine: "opencv" };
    } catch (error) {
      if (requested === "opencv") throw error;
      // "auto": fall through to the pure-JS backend. Same algorithm, slower.
      console.warn("[detect] OpenCV unavailable, using the JS backend:", error);
    }
  }

  const started = now();
  const field = buildScoreFieldJS(image, options);
  timings.segment = now() - started;
  return { field, engine: "js" };
}

/**
 * Traces the score field and maps the rings back to source-image coordinates.
 *
 * The tracer works in sample space where integer coordinates are pixel centres,
 * so a crossing is offset by half a pixel before being divided by the
 * segmentation scale. Getting that half-pixel wrong biases every outline by
 * (0.5 / scale) source pixels — two pixels at a 4x downscale, which is visible.
 */
function traceToOutline(field: ScoreField, options: DetectOptions): Outline {
  const rings = traceIsoRings(field.score, field.width, field.height, {
    iso: field.iso,
    interpolate: true,
    ambiguity: "separate",
  });

  const sourcePerSegPixel = field.scale > 0 ? 1 / field.scale : 1;
  const toSource = (point: Point): Point => ({
    x: (point.x + 0.5) * sourcePerSegPixel + field.offsetX,
    y: (point.y + 0.5) * sourcePerSegPixel + field.offsetY,
  });

  const mapped = rings.map((ring) => ring.map(toSource));
  const outline = buildOutline(mapped);

  // Speckle removal happens here in polygon space rather than by tuning
  // morphology kernels: it is predictable, resolution-independent, and
  // unit-testable.
  return normalizeOutline(outline, {
    minShellAreaFrac: options.minShellAreaFrac ?? DETECT_DEFAULTS.minShellAreaFrac,
    minHoleAreaFrac: options.minHoleAreaFrac ?? DETECT_DEFAULTS.minHoleAreaFrac,
  });
}

function buildDebug(field: ScoreField): DetectResult["debug"] {
  const toRaster = (values: Uint8Array): ImageLike => {
    const data = new Uint8ClampedArray(field.width * field.height * 4);
    for (let i = 0; i < values.length; i++) {
      data[i * 4] = values[i];
      data[i * 4 + 1] = values[i];
      data[i * 4 + 2] = values[i];
      data[i * 4 + 3] = 255;
    }
    return { width: field.width, height: field.height, data };
  };

  return { score: toRaster(field.score), mask: toRaster(maskFromScore(field)) };
}

function time<T>(timings: Record<string, number>, label: string, fn: () => T): T {
  const started = now();
  const result = fn();
  timings[label] = now() - started;
  return result;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Detection aborted", "AbortError");
}
