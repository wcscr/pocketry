import {
  mmPerPixel,
  pixelsPerMm,
  rescaleCalibration,
  rulerPixelLength,
  type Calibration,
  type DraftCalibration,
} from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";

import { flipOutlineY, scaleOutline } from "@/lib/geometry/outline";

/**
 * The unit bridge between tracing space and export space.
 *
 * Tracing works in **image pixels, y-down**. CAD and 3D printing work in
 * **millimetres, y-up**. Every exporter needs the same two facts to cross that
 * boundary — how big a pixel is, and how tall the image was — so they are named
 * once here rather than re-derived from a `Calibration` in each writer, which is
 * how the legacy DXF and STL exporters came to disagree about the flip.
 */

// The shared calibration helpers are re-exported so a caller needs one import
// to build an ExportScale; `mmPerPixel` and friends are NOT reimplemented here.
export {
  mmPerPixel,
  pixelsPerMm,
  rescaleCalibration,
  rulerPixelLength,
  type Calibration,
  type DraftCalibration,
};

export interface ExportScale {
  /** Millimetres per source pixel, or null when uncalibrated. */
  mmPerPx: number | null;
  /** Source-image height, needed for the single Y-flip. */
  imageHeight: number;
}

/**
 * Builds an {@link ExportScale} from a ruler calibration.
 *
 * `mmPerPixel` returns `null` for a missing or unusable calibration rather than
 * falling back to 1 mm/px, and that `null` is carried through here on purpose:
 * an uncalibrated export must be visibly uncalibrated, not silently wrong by a
 * factor of the pixel size.
 */
export function exportScale(
  calibration: Calibration | null | undefined,
  imageHeight: number,
): ExportScale {
  return { mmPerPx: mmPerPixel(calibration), imageHeight };
}

/** True when the outline can be exported at a real-world size. */
export function isCalibrated(scale: ExportScale): boolean {
  return scale.mmPerPx !== null;
}

/**
 * Converts a pixel-space outline into millimetre, Y-up model space.
 *
 * The flip goes through `flipOutlineY`, which reverses each ring as well as
 * negating y, so the orientation invariant (shells positive, holes negative)
 * survives into the model frame — which is exactly what manifold's default
 * `Positive` fill rule needs. This is the *only* place an exporter flips: DXF
 * and STL both call it, so they cannot disagree about handedness.
 *
 * Without a calibration the geometry is returned in pixels, still flipped. The
 * caller decides whether pixel-sized output is acceptable; see
 * {@link describeScale} for the string to put in front of the user.
 */
export function toModelSpace(outline: Outline, scale: ExportScale): Outline {
  assertUsableScale(scale);
  const flipped = flipOutlineY(outline, scale.imageHeight);
  // Flip-then-scale and scale-then-flip agree ((H − y)·s ≡ H·s − y·s), so the
  // order here is a readability choice, not a correctness one.
  return scale.mmPerPx === null ? flipped : scaleOutline(flipped, scale.mmPerPx);
}

/** Millimetres for a pixel length, or `null` when uncalibrated. */
export function toMm(pixels: number, scale: ExportScale): number | null {
  return scale.mmPerPx === null ? null : pixels * scale.mmPerPx;
}

/** Human-readable scale, for the export UI. */
export function describeScale(scale: ExportScale): string {
  if (scale.mmPerPx === null) return "Uncalibrated — exported in pixels";
  return `${formatMeasure(scale.mmPerPx)} mm/px (${formatMeasure(
    1 / scale.mmPerPx,
  )} px/mm)`;
}

/**
 * Four significant figures, with trailing zeros trimmed: enough to tell 0.2 mm
 * from 0.2004 mm without printing float noise at the user.
 */
function formatMeasure(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function assertUsableScale(scale: ExportScale): void {
  if (!Number.isFinite(scale.imageHeight)) {
    // A NaN height propagates into every coordinate and only shows up as a
    // corrupt file, so it is rejected at the boundary instead.
    throw new Error(
      `toModelSpace: imageHeight must be finite, got ${scale.imageHeight}`,
    );
  }
  if (scale.mmPerPx === null) return;
  if (!Number.isFinite(scale.mmPerPx) || scale.mmPerPx <= 0) {
    throw new Error(
      `toModelSpace: mmPerPx must be positive or null, got ${scale.mmPerPx}`,
    );
  }
}
