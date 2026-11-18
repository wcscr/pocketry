import { buildRegionEvidence, solveRegionEvidence } from "./region-evidence";
import { validDetectionGeometry } from "./boundary-validation";
import { pointInRing, signedArea } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

import { AUTO_OUTER_SMOOTHING_SEG_PIXELS, smoothOuterBoundary } from "../geometry/outer-smoothing";
import { buildOutline, normalizeOutline, outsideSilhouettes } from "../geometry/outline";
import {
  resampleOutline,
  simplifyOutline,
  smoothOutline,
} from "../geometry/simplify";
import { traceIsoRings } from "../geometry/trace";
import { loadOpenCV } from "../opencv";
import { buildScoreFieldJS, maskFromScore } from "./segment-js";
import { buildScoreFieldOpenCV, type OpenCV } from "./segment-opencv";
import { eraseSheetInk } from "./sheet-ink";
import { checkDetectionAbort, detectionCheckpoint, refineWithGrabCut } from "./grabcut";
import { restoreOccludedScore } from "./occlusions";
import { repairOccludedOutline } from "./occlusion-repair";
import { createTeedDetector, type TeedDetector } from "./teed";
import {
  DETECT_DEFAULTS,
  type DetectEngine,
  type DetectOptions,
  type DetectResult,
  type ImageLike,
  type ScoreField,
  type RefinementReport,
} from "./types";

/**
 * The single detection pipeline.
 *
 * There used to be two mutually exclusive paths chosen by a `useExperimentalMode`
 * flag. The default one bagged unordered Canny edge pixels and ran them through
 * a convex hull, so it could not represent a concave outline at all; the other
 * kept only the largest `RETR_EXTERNAL` contour, so it could not represent
 * holes. Both are gone. There is now one path, and its OpenCV and pure-JS
 * base segmentation backends are behaviourally equivalent. When OpenCV is
 * available, guarded GrabCut may refine that shared baseline; the JS fallback
 * retains the complete original pipeline without this optional solver stage.
 */
export async function detectOutline(
  image: ImageLike,
  options: DetectOptions = {},
  runtime: { loadCV: () => Promise<OpenCV>; teed?: TeedDetector } = { loadCV: loadOpenCV },
): Promise<DetectResult> {
  return detectPreparedOutline(image, options, runtime, image);
}

async function detectPreparedOutline(
  image: ImageLike, options: DetectOptions,
  runtime: { loadCV: () => Promise<OpenCV>; teed?: TeedDetector }, sourceImage: ImageLike,
): Promise<DetectResult> {
  checkDetectionAbort(options.signal);
  const timings: Record<string, number> = {};

  // The sheet's own printing goes first, once: every later stage, and the
  // colour re-entry below, then sees paper where the printing was.
  if (options.sheetInk) {
    const ink = options.sheetInk;
    image = time(timings, "sheetInk", () => eraseSheetInk(image, ink));
    options = { ...options, sheetInk: undefined };
  }

  let { field, engine, refinement, baseline } = await segment(image, options, timings, runtime.loadCV, runtime.teed);
  throwIfAborted(options.signal);
  // A rejected optional model must preserve the normal color pipeline,
  // including guarded GrabCut and its topology checks. Re-enter once with the
  // model disabled; never leave users with an unrefined intermediate mask.
  const colorFallback = async (report: RefinementReport): Promise<DetectResult> => {
    if (options.highDetail) {
      throw new Error(report.reason === "teed-unavailable"
        ? "The high-detail edge model could not run on this device."
        : "High detail could not close a reliable outline. Try leaving more paper around the tool.");
    }
    const started = now();
    // The sheet is still white paper when the learned outline is rejected.
    const fallback = await detectPreparedOutline(image, { ...options, boundary: "color", paperBackground: options.paperBackground ?? true, engine }, runtime, sourceImage);
    return { ...fallback, refinement: report, timings: { ...timings, colorFallback: now() - started } };
  };
  if (options.highDetail && refinement?.status === "skipped") throw new Error("This image already defines its outline with transparency.");
  if (options.boundary === "teed" && refinement?.status === "fallback") return colorFallback(refinement);
  const estimatedEdgeRegions: Ring[] = [];
  const inferredOccludedEdge = options.occlusions?.length
    ? time(timings, "occlusions", () => restoreOccludedScore(field, options.occlusions!, estimatedEdgeRegions)) : false;

  let rawOutline = time(timings, "trace", () => traceToOutline(field, options));
  if (inferredOccludedEdge) rawOutline = time(timings, "occlusionRepair", () => repairOccludedOutline(rawOutline, estimatedEdgeRegions,
    Math.max(1 / field.scale, 1 / (field.scaleY ?? field.scale))));
  if (baseline && refinement?.status === "accepted") {
    const original = time(timings, "validateTopology", () => traceToOutline(baseline, options));
    // Polygon thresholds are relative to each parent (especially holes in a
    // small second object). Check the actual normalized rings as well as the
    // raster graph, before exposing any refined result to the editor.
    const fragmented = options.boundary === "teed" &&
      outsideSilhouettes(rawOutline).length > outsideSilhouettes(original).length;
    if (fragmented) return colorFallback({ ...refinement, status: "fallback", reason: "fragmented-outline" });
    if (options.boundary !== "teed" && (original.length !== rawOutline.length || original.some((shape, i) =>
      shape.holes.length !== rawOutline[i].holes.length))) {
      field = baseline;
      rawOutline = original;
      refinement = { ...refinement, status: "fallback", reason: "outline-topology" };
    }
  }
  throwIfAborted(options.signal);

  // Every path that reaches the user passes here exactly once: the learned
  // fallbacks above return the colour re-entry's result, which already ran it.
  if (options.hints?.length) {
    const evidence = time(timings, "evidence", () => buildRegionEvidence(sourceImage, field, options.hints));
    field = time(timings, "regionCorrection", () => solveRegionEvidence(field, evidence));
    // A marked part may be smaller than the speck filter allows, so trace everything and
    // then drop the small parts no mark asks for.
    rawOutline = time(timings, "correctionTrace", () => keepMarkedParts(
      traceToOutline(field, { ...options, minShellAreaFrac: 0, minHoleAreaFrac: 0 }), options));
    // The retrace starts from the corrected mask, so an edge hidden by a measurement aid needs its repair again.
    if (inferredOccludedEdge) rawOutline = time(timings, "occlusionRepair", () => repairOccludedOutline(rawOutline, estimatedEdgeRegions,
      Math.max(1 / field.scale, 1 / (field.scaleY ?? field.scale))));
  }
  const materialOutline = rawOutline;
  const allowance = options.inwardTolerancePx ?? Math.max(0.5, options.tolerancePx ?? DETECT_DEFAULTS.tolerancePx);
  let growth = options.outwardTolerancePx ?? 4;
  if (options.outerSmoothingPx) {
    const sourcePerSegPixel = field.scale > 0 ? 1 / field.scale : 1;
    const lengthPx = options.outerSmoothingPx === "auto"
      ? AUTO_OUTER_SMOOTHING_SEG_PIXELS * sourcePerSegPixel
      : options.outerSmoothingPx;
    // Outward smoothing grows a sharp corner by up to two thirds of its length, so the growth
    // limit cannot be shorter than that length without refusing the smoothing's own result.
    growth = Math.max(growth, lengthPx);
    rawOutline = time(timings, "outerSmoothing", () => smoothOuterBoundary(rawOutline, lengthPx, allowance));
  }

  // The trace has already removed specks. Filtering again after simplification could drop a
  // part that sits at the limit, and one missing part would fail the whole comparison below.
  const refining: DetectOptions = { ...options, minShellAreaFrac: 0, minHoleAreaFrac: 0 };
  const candidate = time(timings, "refine", () => refineOutline(rawOutline, refining, field));
  const outline = time(timings, "containment", () => {
    if (validDetectionGeometry(materialOutline, candidate, allowance, growth)) return candidate;
    // Keep what the outward smoothing achieved: simplify it less and without the corner-cutting
    // smoothing passes, and failing that use it as traced. Neither brings the stair-steps back.
    const conservative = refineOutline(rawOutline, { ...refining, smoothing: 0,
      tolerancePx: Math.min(allowance * .4, options.tolerancePx ?? DETECT_DEFAULTS.tolerancePx) }, field);
    if (validDetectionGeometry(materialOutline, conservative, allowance, growth)) return conservative;
    // The unsmoothed trace is the last resort: it always passes, at the price of its stair-steps.
    return validDetectionGeometry(materialOutline, rawOutline, allowance, growth) ? rawOutline : materialOutline;
  });

  return {
    inferredOccludedEdge,
    estimatedEdgeRegions,
    outline,
    rawOutline,
    materialOutline,
    threshold: field.iso,
    otsuThreshold: field.otsu,
    engine,
    timings,
    refinement,
    debug: options.debug ? buildDebug(field) : undefined,
  };
}

/**
 * The speck filter for a corrected trace: a shape or hole below the usual size
 * stays only when a mark of the matching kind lies inside it. Without this a
 * correction either loses the small part the user marked or keeps every speck
 * in the photo as a separate outline.
 */
function keepMarkedParts(outline: Outline, options: DetectOptions): Outline {
  const hints = options.hints ?? [];
  const marked = (ring: Ring, kind: "tool" | "paper") =>
    hints.some((hint) => hint.kind === kind && hint.points.some((point) => pointInRing(ring, point)));
  const area = (ring: Ring) => Math.abs(signedArea(ring));
  const shellFloor = Math.max(0, ...outline.map((shape) => area(shape.outer))) *
    (options.minShellAreaFrac ?? DETECT_DEFAULTS.minShellAreaFrac);
  const holeFraction = options.minHoleAreaFrac ?? DETECT_DEFAULTS.minHoleAreaFrac;
  return outline
    .filter((shape) => area(shape.outer) >= shellFloor || marked(shape.outer, "tool"))
    .map((shape) => ({
      outer: shape.outer,
      holes: shape.holes.filter((hole) => area(hole) >= area(shape.outer) * holeFraction || marked(hole, "paper")),
    }));
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
  loadCV: () => Promise<OpenCV>,
  teed?: TeedDetector,
): Promise<{ field: ScoreField; baseline?: ScoreField; engine: DetectEngine; refinement?: RefinementReport }> {
  const requested = options.engine ?? DETECT_DEFAULTS.engine;

  if (requested !== "js") {
    try {
      const loadStarted = now();
      const cv = await loadCV();
      timings.initialize = now() - loadStarted;
      await detectionCheckpoint(options.signal);
      const started = now();
      const field = buildScoreFieldOpenCV(cv, image, options);
      timings.segment = now() - started;
      if (options.boundary === "teed") {
        const detector = teed ?? createTeedDetector();
        const began = now();
        try {
          const result = await detector.segment(cv, image, options, field);
          timings.learnedEdges = now() - began;
          if (result.reconstructionMs !== undefined) timings.reconstruct = result.reconstructionMs;
          return { field: result.field ?? field, baseline: result.field ? field : undefined, engine: "opencv", refinement: {
            status: result.field ? "accepted" : result.reason === "alpha-mask" ? "skipped" : "fallback",
            reason: result.reason ?? "teed-edges", iterations: 0, cached: result.cached,
            ...result.selection,
            boundaryCleanup: result.cleanup,
          } };
        } catch (error) {
          timings.learnedEdges = now() - began;
          checkDetectionAbort(options.signal);
          if (error instanceof Error && error.name === "AbortError") throw error;
          return { field, engine: "opencv", refinement: { status: "fallback", reason: "teed-unavailable", iterations: 0 } };
        } finally { if (!teed) detector.dispose(); }
      }
      if ((options.refine ?? DETECT_DEFAULTS.refine) === "grabcut") {
        const refineStarted = now();
        const refined = await refineWithGrabCut(cv, image, field, options);
        timings.grabcut = now() - refineStarted;
        return { field: refined.field, baseline: field, engine: "opencv", refinement: refined.report };
      }
      return { field, engine: "opencv" };
    } catch (error) {
      checkDetectionAbort(options.signal);
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (requested === "opencv") throw error;
      // "auto": fall through to the pure-JS backend. Same algorithm, slower.
      console.warn("[detect] OpenCV unavailable, using the JS backend:", error);
    }
  }

  await detectionCheckpoint(options.signal);
  const started = now();
  const field = buildScoreFieldJS(image, options);
  timings.segment = now() - started;
  return { field, engine: "js", ...(options.boundary === "teed" ? { refinement: {
    status: "fallback" as const, reason: "teed-unavailable", iterations: 0,
  } } : {}) };
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
    y: (point.y + 0.5) / (field.scaleY ?? field.scale) + field.offsetY,
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
