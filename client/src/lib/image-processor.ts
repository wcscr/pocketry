import { mmPerPixel, type Calibration } from "@shared/geometry/scale";
import type { Outline, Point, Rect } from "@shared/geometry/types";

import { detectOutline, refineOutline } from "./detect/pipeline";
import type { DetectOptions, DetectResult, ImageLike } from "./detect/types";
import { offsetOutline } from "./geometry/offset";
import {
  flattenOutline,
  outlineBounds,
  outlineFromPoints,
} from "./geometry/outline";
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
export const DEFAULT_MARGIN_MM = 1.5;

/** A physical margin in millimetres, or null while the image is unscaled. */
export type Margin = number | null;

export interface Region extends Rect {}

/** A region that has already been cropped out of the source image. */
export interface CroppedRegionInfo {
  originalRegion: Region;
  isCropped: boolean;
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
  return deltaPx === 0 ? outline : offsetOutline(outline, deltaPx);
}

export interface ProcessOptions {
  /** Region of interest, or a region already cropped from the source. */
  region?: Region | CroppedRegionInfo | null;
  margin?: Margin;
  calibration?: Calibration | null;
  detect?: DetectOptions;
  /** Surfaces recoverable problems (a backend fallback, say) to the user. */
  onNotice?: (title: string, message: string) => void;
}

export interface ProcessResult {
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

export async function processImage(
  imageData: ImageLike,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { region, margin = null, calibration = null, detect = {}, onNotice } = options;

  // A pre-cropped region carries its own origin; a plain region is an ROI the
  // detector applies itself.
  const cropped = isCroppedRegionInfo(region);
  const roi = cropped ? null : (region ?? null);

  let result: DetectResult;
  try {
    result = await detectOutline(imageData, { ...detect, roi });
  } catch (error) {
    onNotice?.(
      "Detection failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  if (result.engine === "js" && detect.engine !== "js") {
    onNotice?.(
      "Using the fallback detector",
      "OpenCV could not be loaded, so detection ran in JavaScript. Results are the same but slower.",
    );
  }

  const origin = cropped
    ? { x: region.originalRegion.x, y: region.originalRegion.y }
    : { x: 0, y: 0 };

  let outline = translate(result.outline, origin);
  const rawOutline = translate(result.rawOutline, origin);

  const marginPx = marginToPixels(margin, calibration);
  if (marginPx !== 0) {
    // Offsets the whole polygon set at once, so holes shrink as shells grow.
    outline = await offsetOutline(outline, marginPx);
  }

  return {
    outline,
    rawOutline,
    svg: generateOutlineSVG(outline, {
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

  const outline = refineOutline(rawOutline, detect);
  const marginPx = marginToPixels(margin, calibration);
  return marginPx === 0 ? outline : offsetOutline(outline, marginPx);
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
