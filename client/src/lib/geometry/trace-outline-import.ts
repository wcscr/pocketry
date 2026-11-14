import { withinImportLimits } from "@shared/gridfinity/import-limits";
import type { Outline, Point, Rect } from "@shared/geometry/types";

import { mapOutline, normalizeOutline, outlineBounds, outlineRings } from "./outline";
import { applyRigid, fitOutlineRigid } from "./outline-fit";
import { importSvgCanvasOutline, importSvgShape, readSvgCanvas, ringsCrossOrTouch } from "./svg-import";

/**
 * Placing an SVG outline over the Trace workspace's working photo.
 *
 * Trace coordinates are working-image pixels, y-down. A file can be positioned
 * in that frame in exactly two ways, and nothing is fitted or guessed:
 *
 * - `"photo"`: the file's viewBox is this photo's pixel grid, which is what
 *   Trace's own SVG export writes. Its coordinates are used verbatim, so an
 *   export of the same photo returns to the pixels it was traced from.
 * - `"true-size"`: the file's physical dimensions (or a width override) are
 *   converted through the trace's scale. The outline is then turned and slid
 *   onto the trace's current outline when there is one to fit, since a file
 *   saved after straightening has the right size but not the photo's pose;
 *   otherwise it is centered on the detection region, or on the photo.
 */
export type OutlinePlacement = "photo" | "true-size";

/** The Trace state an imported outline is placed against. */
export interface TraceImportTarget {
  /** Working-image size in pixels: the frame of every Trace coordinate. */
  imageSize: { width: number; height: number };
  /** Accepted scale in millimeters per pixel, or null while none is set. */
  mmPerPx: number | null;
  /** Selected detection region, if any. */
  region?: Rect | null;
  /** Visible paper crop of a perspective-corrected photo, when the rest is hidden. */
  visibleBounds?: Rect | null;
  /** The trace's current outline: where a true-size import of the same object belongs. */
  fitTo?: Outline | null;
}

export interface TraceOutlineImportOptions {
  /** Overrides the default, which prefers the file's own positions when available. */
  placement?: OutlinePlacement;
  /** Real width of the artwork's bounds, for true-size files without physical units. */
  widthMm?: number;
  /** Set false to leave a true-size outline centered instead of fitting it to `fitTo`. */
  fit?: boolean;
}

export interface PlacedOutline {
  /** Normalized rings in working-image pixels, y-down, largest contour first. */
  outline: Outline;
  placement: OutlinePlacement;
  /** The file's viewBox is this photo's pixel grid, so `"photo"` is available. */
  matchesPhoto: boolean;
  /** The file's own scale when it shares the photo's grid and records one. */
  fileMmPerPx: number | null;
  /**
   * The file and the trace both carry a scale and they disagree, so the two
   * placements give different sizes and the choice belongs to the user.
   */
  scaleMismatch: boolean;
  /** Bounding size of the outline in pixels, as drawn in the file (before any fitting turn). */
  sizePx: { width: number; height: number };
  /** A true-size placement with a current outline to fit to, whether or not it was used. */
  fitAvailable: boolean;
  /** How the outline was turned onto the current outline, or null when it was left centered. */
  fit: { degrees: number; typicalGapPx: number } | null;
  /**
   * Some contour crosses or touches itself or another. Trace takes it as drawn,
   * because repairing an outline over its photo is what the import is for.
   */
  crossesItself: boolean;
}

/** Trace's exporter writes the viewBox to two decimals. */
const CANVAS_MATCH_PX = 0.01;
/** Chord error for curves in a photo-frame file; finer than a displayed pixel. */
const PHOTO_TOLERANCE_PX = 0.1;
/** Scales closer than this place the outline within a pixel at any working size. */
const SCALE_MATCH_FRACTION = 1e-3;

function fail(message: string): never { throw new Error(`Outline import: ${message}`); }

/** Where `"true-size"` centers an outline; mirrors where Add contour starts its square. */
export function importCenter(target: TraceImportTarget): Point {
  const frame = target.visibleBounds ?? { x: 0, y: 0, ...target.imageSize };
  const region = target.region ?? frame;
  const left = Math.max(frame.x, region.x), top = Math.max(frame.y, region.y);
  const right = Math.min(frame.x + frame.width, region.x + region.width);
  const bottom = Math.min(frame.y + frame.height, region.y + region.height);
  // A region wholly outside the visible photo cannot anchor anything.
  const bounds = right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : frame;
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * Parses `svgText` with the shared SVG importer and positions its closed
 * silhouettes over the working photo. Throws an `Error` whose message can be
 * shown to the user when the file is unreadable or cannot be placed.
 */
export function placeSvgOutline(svgText: string, target: TraceImportTarget,
  options: TraceOutlineImportOptions = {}): PlacedOutline {
  const { width, height } = target.imageSize;
  if (!(width > 0 && height > 0)) fail("Choose a photo first.");
  const mmPerPx = target.mmPerPx !== null && Number.isFinite(target.mmPerPx) && target.mmPerPx > 0 ? target.mmPerPx : null;

  // Reading the canvas also rejects an unreadable file before any scale advice.
  const canvas = readSvgCanvas(svgText);
  const matchesPhoto = canvas !== null && Math.abs(canvas.width - width) <= CANVAS_MATCH_PX &&
    Math.abs(canvas.height - height) <= CANVAS_MATCH_PX;
  const fileMmPerPx = matchesPhoto ? canvas.mmPerUnit : null;
  const scaleMismatch = fileMmPerPx !== null && mmPerPx !== null &&
    Math.abs(fileMmPerPx / mmPerPx - 1) > SCALE_MATCH_FRACTION;
  const placement = options.placement ?? (matchesPhoto ? "photo" : "true-size");

  let placed: Outline;
  if (placement === "photo") {
    if (!matchesPhoto) fail(`This file's canvas is not this photo's ${width} × ${height} px, so its positions cannot be kept.`);
    placed = importSvgCanvasOutline(svgText, PHOTO_TOLERANCE_PX, { allowCrossing: true });
  } else {
    if (mmPerPx === null) {
      fail(`Set the scale first. This file was not saved from this ${width} × ${height} px photo, so Pocketry needs the scale to place it at true size.`);
    }
    const center = importCenter(target);
    // The shared importer returns centered, y-up millimeters; Trace is y-down pixels.
    placed = mapOutline(importSvgShape(svgText, { widthMm: options.widthMm, allowCrossing: true }).outlineMm,
      point => ({ x: center.x + point.x / mmPerPx, y: center.y - point.y / mmPerPx }));
  }

  // The same normalization the tracer applies: winding, hole convention, order.
  const centered = normalizeOutline(placed);
  const drawn = outlineBounds(centered);
  if (!drawn) fail("No usable closed silhouettes found.");
  if (!withinImportLimits(centered)) fail("Outline exceeds Pocketry's import limits; simplify it first.");

  const fitAvailable = placement === "true-size" && Boolean(target.fitTo?.length);
  const pose = fitAvailable && options.fit !== false ? fitOutlineRigid(centered, target.fitTo!) : null;
  const outline = pose ? applyRigid(centered, pose) : centered;
  const bounds = outlineBounds(outline)!;
  if (bounds.maxX <= 0 || bounds.maxY <= 0 || bounds.minX >= width || bounds.minY >= height) {
    fail("This outline lies entirely outside the photo.");
  }
  return { outline, placement, matchesPhoto, fileMmPerPx, scaleMismatch,
    sizePx: { width: drawn.maxX - drawn.minX, height: drawn.maxY - drawn.minY },
    fitAvailable, fit: pose ? { degrees: pose.radians * 180 / Math.PI, typicalGapPx: pose.typicalGap } : null,
    crossesItself: ringsCrossOrTouch(outlineRings(outline)) };
}
