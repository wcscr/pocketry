import { validateDetectionHints } from "./detect/hint-validation";
import { validDetectionGeometry } from "./detect/boundary-validation";
import { mmPerPixel, type Calibration } from "@shared/geometry/scale";
import type { Outline, Point, Rect, Ring } from "@shared/geometry/types";

import { detectOutline } from "./detect/pipeline";
import { detectInWorker, reconstructInWorker } from "./detect/worker-client";
import { recommendedReconstructionTolerance } from "@shared/geometry/contour-reconstruction";
import { reconstructDetectedForEditing } from "@shared/geometry/detected-cleanup";
import { CURVE_TOLERANCE_MM, curvesFromOutline, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import { checkDetectionAbort } from "./detect/grabcut";
import { SHEET_STROKE_MM, type SheetInkRegion } from "./detect/sheet-ink";
import { DETECT_DEFAULTS, type DetectOptions, type DetectResult, type ImageLike } from "./detect/types";
import { OUTER_SMOOTHING_MM } from "./geometry/outer-smoothing";
import { offsetDetectedOutline, offsetTraceOutline, refineTraceOutline, retainSurvivingDetectionHoles } from "./geometry/trace-refinement";
import {
  flattenOutline,
  outlineBounds,
  outlineFromPoints,
  outsideSilhouettes,
} from "./geometry/outline";
export { outsideSilhouettes } from "./geometry/outline";
import { generateOutlineSVG } from "./export/svg";

export type { Point, Outline };

/**
 * Image → outline, the app-facing entry point.
 *
 * The heavy lifting now lives in `./detect` (segmentation and tracing) and
 * `./geometry` (rings, simplification, offsetting). What used to be here — a
 * hand-rolled Canny that returned an unordered bag of edge pixels, an alpha
 * shape that sorted points by angle around the centroid, two convex-hull
 * fallbacks, and a second OpenCV path behind an "experimental" flag — is gone.
 * All of it was structurally incapable of representing a concave outline or an
 * interior hole.
 */

/** The physical clearance choices exposed by the Trace workspace, in mm. */
export const MARGIN_MM_OPTIONS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;

/** The clearance selected when a Trace image first receives a valid scale. */
export const DEFAULT_MARGIN_MM = 0;

/** A physical margin in millimetres, or null while the image is unscaled. */
export type Margin = number | null;

export interface Region extends Rect {}

/** A region that has already been cropped out of the source image. */
export interface CroppedRegionInfo {
  originalRegion: Region;
  isCropped: boolean;
  /** Crop-first source pixels map back to the unchanged Trace working frame. */
  toWorking?: { x: number; y: number };
}

function isCroppedRegionInfo(
  region: Region | CroppedRegionInfo | null | undefined,
): region is CroppedRegionInfo {
  return (
    region !== null &&
    typeof region === "object" &&
    "originalRegion" in region &&
    "isCropped" in region
  );
}

/**
 * Converts a physical millimetre margin into a pixel offset.
 * An uncalibrated image has no defensible px/mm conversion, so it receives no
 * margin until the user sets or accepts a scale.
 */
export function marginToPixels(
  margin: Margin,
  calibration: Calibration | null,
): number {
  const mmPerPx = mmPerPixel(calibration);
  if (
    margin === null ||
    !Number.isFinite(margin) ||
    margin <= 0 ||
    mmPerPx === null
  ) {
    return 0;
  }
  return margin / mmPerPx;
}

/**
 * Changes only the clearance already applied to an edited contour.
 *
 * Applying the difference between the old and new physical margins is what
 * preserves moved/added/deleted vertices and removed holes. Reprocessing the
 * detector's cached raw outline here would silently resurrect discarded
 * geometry and throw away manual contour edits.
 */
export async function adjustOutlineMargin(
  outline: Outline,
  previousMargin: Margin,
  nextMargin: Margin,
  calibration: Calibration | null,
): Promise<Outline> {
  const deltaPx =
    marginToPixels(nextMargin, calibration) -
    marginToPixels(previousMargin, calibration);
  if (deltaPx === 0) return outline;
  return withoutNewInteriorHoles(await offsetTraceOutline(outline, deltaPx), outline);
}

export interface ProcessOptions {
  /** Reconstruct the detected boundary before exposing it for editing. */
  autoCleanup?: boolean;
  editableCurves?: boolean;
  /**
   * Smooth the dense trace outward before simplification and cleanup, about one
   * millimetre when a scale is known. Baked in at detection: recalibrating
   * afterwards does not re-run it.
   */
  smoothBoundary?: boolean;
  /**
   * Where a recognised calibration sheet prints, in working-photo pixels. Its
   * text, bar and markers are painted out before detection. Needs a scale.
   */
  sheetInk?: readonly SheetInkRegion[];
  /** Tool pockets normally need only the outside silhouette. */
  includeInteriorHoles?: boolean;
  /** Region of interest, or a region already cropped from the source. */
  region?: Region | CroppedRegionInfo | null;
  margin?: Margin;
  calibration?: Calibration | null;
  detect?: DetectOptions;
  /** Surfaces recoverable problems (a backend fallback, say) to the user. */
  onNotice?: (title: string, message: string) => void;
}

export interface ProcessResult {
  curves?: CurveOutline;
  /** Cleaned, unoffset baseline for later point/detail adjustments. */
  refinementBase?: Outline;
  cleanup?: { applied: boolean; tolerancePx?: number; reason?: string };
  /** Source-image regions where a calibration aid hid an estimated edge. */
  estimatedEdgeRegions?: Ring[];
  /** Rings in source-image coordinates, margin applied. */
  outline: Outline;
  /** Dense pre-simplification rings, so the detail controls can re-derive. */
  rawOutline: Outline;
  /** Preview SVG. */
  svg: string;
  /**
   * The largest shell's outer ring.
   *
   * Lossy — holes and extra shapes are dropped — and kept only for call sites
   * still on the old flat `Point[]` model.
   */
  points: Point[];
  threshold: number;
  engine: DetectResult["engine"];
  timings: DetectResult["timings"];
}

/** A margin or simplification can seal a narrow bay into a new hole. Keep an
 * outside-only contour hole-free, while preserving existing intentional holes. */
export function withoutNewInteriorHoles(outline: Outline, baseline: Outline): Outline {
  return baseline.every((shape) => shape.holes.length === 0)
    ? outline.map((shape) => ({ ...shape, holes: [] }))
    : outline;
}

export async function processImage(
  imageData: ImageLike,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { region, margin = null, calibration = null, detect = {}, onNotice } = options;

  // A pre-cropped region carries its own origin; a plain region is an ROI the
  // detector applies itself.
  const cropped = isCroppedRegionInfo(region);
  const roi = cropped ? null : (region ?? null);
  const toWorking = cropped ? region.toWorking ?? { x: 1, y: 1 } : { x: 1, y: 1 };
  // The detector works in the crop's own pixels; lengths given in working pixels shrink with it.
  const workingPerDetectPixel = Math.max(toWorking.x, toWorking.y);
  const workingMmPerPixel = mmPerPixel(calibration);
  const detectionOptions: DetectOptions = { ...detect, roi,
    frameTransform: { origin: cropped ? { x: region.originalRegion.x, y: region.originalRegion.y } : { x: 0, y: 0 }, scale: toWorking },
    tolerancePx: (detect.tolerancePx ?? DETECT_DEFAULTS.tolerancePx) / workingPerDetectPixel,
    outerSmoothingPx: !options.smoothBoundary ? detect.outerSmoothingPx
      : workingMmPerPixel ? OUTER_SMOOTHING_MM / (workingMmPerPixel * workingPerDetectPixel) : "auto",
    // Printed areas arrive in working pixels and need the scale to size a stroke.
    sheetInk: options.sheetInk?.length && workingMmPerPixel ? {
      regions: options.sheetInk.map((area) => ({
        x: (area.x - (cropped ? region.originalRegion.x : 0)) / toWorking.x,
        y: (area.y - (cropped ? region.originalRegion.y : 0)) / toWorking.y,
        width: area.width / toWorking.x, height: area.height / toWorking.y, kind: area.kind,
      })),
      strokePx: SHEET_STROKE_MM / (workingMmPerPixel * workingPerDetectPixel),
    } : detect.sheetInk,
    hints: detect.hints?.map(h => ({ ...h, radius: h.radius / workingPerDetectPixel,
      points: h.points.map(p => ({ x: (p.x - (cropped ? region.originalRegion.x : 0)) / toWorking.x, y: (p.y - (cropped ? region.originalRegion.y : 0)) / toWorking.y })) })),
    // Cleanup must honor the requested detail, rather than reject it under a
    // separate sub-pixel budget and silently restore the dense staircase.
    inwardTolerancePx: Math.max(workingMmPerPixel ? 0.1 / workingMmPerPixel : 0.5, detect.tolerancePx ?? DETECT_DEFAULTS.tolerancePx) / workingPerDetectPixel,
    outwardTolerancePx: (workingMmPerPixel ? 1 / workingMmPerPixel : 4) / workingPerDetectPixel,
    occlusions: detect.occlusions?.map(ring => ring.map(p => ({ x: p.x / toWorking.x, y: p.y / toWorking.y }))),
  };

  let result: DetectResult;
  try {
    // Node tests and non-browser consumers can still call the injected pipeline.
    // Every supported browser runs segmentation and tracing in the worker.
    result = typeof Worker === "undefined"
      ? await detectOutline(imageData, { ...detectionOptions, engine: "js", refine: "none" })
      : await detectInWorker(imageData, detectionOptions);
  } catch (error) {
    if (detect.signal?.aborted || (error instanceof Error &&
      (error.name === "AbortError" || error.name === "WorkerCancelledError"))) throw error;
    onNotice?.(
      "Detection failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  if (result.engine === "js" && detect.engine !== "js") {
    onNotice?.(
      "Using the fallback detector",
      "OpenCV could not be loaded, so detection used the basic JavaScript outline without automatic boundary refinement.",
    );
  }

  if (result.inferredOccludedEdge) {
    onNotice?.("Review the edge beneath the measurement aid",
      "The aid was removed from the trace. The edge it covers is estimated from the visible outline; check those points, or retake the photo with the aid fully inside the tool.");
  }
  if (detect.boundary === "teed" && result.refinement?.status === "fallback") {
    onNotice?.("Using color detection", result.refinement.reason === "teed-unavailable"
      ? "Learned outlines could not be loaded. Your photo was traced with the color detector."
      : "A reliable learned outer outline could not be closed. Color detection was used; try a region with white paper around the whole tool.");
  }

  const origin = cropped
    ? { x: region.originalRegion.x, y: region.originalRegion.y }
    : { x: 0, y: 0 };

  const silhouette = (outline: Outline): Outline => options.includeInteriorHoles
    ? outline
    : outsideSilhouettes(outline);
  const mapToWorking = (value: Outline) => value.map(s => ({ outer: s.outer.map(p => ({ x: p.x * toWorking.x, y: p.y * toWorking.y })),
    holes: s.holes.map(r => r.map(p => ({ x: p.x * toWorking.x, y: p.y * toWorking.y }))) }));
  let outline = translate(mapToWorking(silhouette(result.outline)), origin);
  let rawOutline = translate(mapToWorking(silhouette(result.rawOutline)), origin);
  const material = translate(mapToWorking(silhouette(result.materialOutline ?? result.rawOutline)), origin);

  let curves: CurveOutline | undefined, refinementBase: Outline | undefined;
  let cleanup: ProcessResult["cleanup"];
  if (options.autoCleanup && outline.length && rawOutline.length) {
    const began = performance.now();
    try {
      checkDetectionAbort(detect.signal);
      const units = mmPerPixel(calibration), unitsPerPixel = units ?? 1;
      const recommended = Math.max(...rawOutline.flatMap(s => [s.outer, ...s.holes])
        .map(ring => recommendedReconstructionTolerance(ring, unitsPerPixel, units ? "mm" : "px")));
      const inward = detectionOptions.inwardTolerancePx! * workingPerDetectPixel;
      const tolerance = Math.min(Math.ceil(recommended * unitsPerPixel * 1000) / 1000 / unitsPerPixel, inward);
      const native = !!options.editableCurves && (margin ?? 0) === 0;
      const request = { source: curvesFromOutline(outline), dense: rawOutline, tolerance, editableCurves: native };
      const fitted = typeof Worker === "undefined"
        ? reconstructDetectedForEditing(request.source, request.dense, tolerance, native)
        : await reconstructInWorker(request, detect.signal);
      checkDetectionAbort(detect.signal);
      const fittedOutline = sampleCurves(fitted.curves, CURVE_TOLERANCE_MM / (units ?? .1));
      if (!validDetectionGeometry(material, fittedOutline, inward, units ? 1 / units : 4)) throw new Error("Cleanup would exceed the detection detail allowance.");
      outline = fittedOutline;
      if (native) curves = fitted.curves;
      refinementBase = outline;
      cleanup = { applied: true, tolerancePx: tolerance };
    } catch (error) {
      checkDetectionAbort(detect.signal);
      if (error instanceof Error && (error.name === "AbortError" || error.name === "WorkerCancelledError")) throw error;
      cleanup = { applied: false, reason: error instanceof Error ? error.message : "Could not simplify this boundary." };
      onNotice?.("Kept the detected outline", "Automatic line and curve cleanup could not preserve this outline reliably. The detected boundary has been kept for review.");
    }
    result.timings.cleanup = performance.now() - began;
  }

  validateDetectionHints(outline, detect.hints ?? []);
  // Future simplification starts from the accepted, unsmoothed material too.
  rawOutline = material;
  const marginPx = marginToPixels(margin, calibration);
  if (marginPx !== 0) {
    // Keep independently detected tools separate as their margins grow.
    outline = await offsetDetectedOutline(outline, marginPx);
  }
  // Initial containment was resolved before clearance. The offset may now
  // overlap neighbouring tools, so do not treat one as an interior island.
  if (!options.includeInteriorHoles) outline = outline.map(part => ({ ...part, holes: [] }));
  if (marginPx !== 0) rawOutline = await retainSurvivingDetectionHoles(rawOutline, outline);

  return {
    curves,
    refinementBase,
    cleanup,
    outline,
    rawOutline,
    estimatedEdgeRegions: (result.estimatedEdgeRegions ?? []).map(ring => ring.map(p => ({ x: p.x * toWorking.x + origin.x, y: p.y * toWorking.y + origin.y }))),
    svg: generateOutlineSVG(outline, {
      curves,
      width: imageData.width,
      height: imageData.height,
      fill: "rgba(100, 100, 255, 0.3)",
      stroke: "blue",
      strokeWidth: 2,
    }),
    points: flattenOutline(outline),
    threshold: result.threshold,
    engine: result.engine,
    timings: result.timings,
  };
}

/**
 * Re-derives the presentation outline from the cached dense one.
 *
 * Backs the Detail and Smoothing controls: changing them costs a few
 * milliseconds of polygon work instead of a full re-segmentation. Margin is
 * deliberately handled by adjustOutlineMargin so manual edits survive.
 */
export async function reprocessOutline(
  rawOutline: Outline,
  options: {
    detect?: DetectOptions;
    margin?: Margin;
    calibration?: Calibration | null;
  } = {},
): Promise<Outline> {
  const { detect = {}, margin = null, calibration = null } = options;

  // Manual detail/smoothing is an explicit allowance chosen by the user.
  // The automatic detector's fixed preservation budget must not silently
  // cancel it or replace the displayed contour with the unsimplified source.
  const outline = refineTraceOutline(rawOutline, detect);
  const marginPx = marginToPixels(margin, calibration);
  const adjusted = marginPx === 0 ? outline : await offsetTraceOutline(outline, marginPx);
  return withoutNewInteriorHoles(adjusted, rawOutline);
}

function translate(outline: Outline, origin: Point): Outline {
  if (origin.x === 0 && origin.y === 0) return outline;
  return outline.map((shape) => ({
    outer: shape.outer.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
    holes: shape.holes.map((hole) =>
      hole.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
    ),
  }));
}

/** Wraps a flat point list as an outline, for call sites not yet migrated. */
export { outlineFromPoints };
