import type { Point } from "./types";

/**
 * A completed ruler calibration: two points the user placed on a known-length
 * feature, plus that length in millimetres. Coordinates are in the same pixel
 * space as the traced outline.
 */
export interface Calibration {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  lengthMm: number;
}

/**
 * A calibration still being placed. The first click sets the start; optional
 * end coordinates track the pointer until the second click commits it.
 */
export type DraftCalibration = Partial<Calibration>;

export type CalibrationEndpoints = Omit<Calibration, "lengthMm">;

/** True once both manual ruler endpoints have been placed on the image. */
export function hasCalibrationEndpoints(
  draft: DraftCalibration | null | undefined,
): draft is DraftCalibration & CalibrationEndpoints {
  return Boolean(
    draft &&
      Number.isFinite(draft.startX) &&
      Number.isFinite(draft.startY) &&
      Number.isFinite(draft.endX) &&
      Number.isFinite(draft.endY),
  );
}

/** Completes a placed manual ruler only after its known length is confirmed. */
export function calibrationFromDraft(
  draft: DraftCalibration | null | undefined,
  lengthMm: number,
): Calibration | null {
  if (
    !hasCalibrationEndpoints(draft) ||
    !Number.isFinite(lengthMm) ||
    lengthMm <= 0
  ) {
    return null;
  }
  const calibration = {
    startX: draft.startX,
    startY: draft.startY,
    endX: draft.endX,
    endY: draft.endY,
    lengthMm,
  };
  return rulerPixelLength(calibration) > 0 ? calibration : null;
}

/** Pixel distance between the two calibration points. */
export function rulerPixelLength(calibration: Calibration): number {
  return Math.hypot(
    calibration.endX - calibration.startX,
    calibration.endY - calibration.startY,
  );
}

/**
 * Millimetres per pixel, or `null` when there is no usable calibration.
 *
 * Returning `null` rather than a `1` fallback is deliberate: silently treating
 * an uncalibrated outline as 1 mm/px is how a bin gets printed at the wrong
 * size. Callers must decide explicitly what to do without a scale.
 */
export function mmPerPixel(calibration: Calibration | null | undefined): number | null {
  if (!calibration || !Number.isFinite(calibration.lengthMm)) return null;
  if (calibration.lengthMm <= 0) return null;
  const pixels = rulerPixelLength(calibration);
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  return calibration.lengthMm / pixels;
}

/** Pixels per millimetre — the reciprocal of {@link mmPerPixel}. */
export function pixelsPerMm(calibration: Calibration | null | undefined): number | null {
  const mmPerPx = mmPerPixel(calibration);
  return mmPerPx === null ? null : 1 / mmPerPx;
}

/**
 * Rescales a calibration recorded in one pixel space into another.
 *
 * Needed when the working resolution changes (for example moving from the
 * legacy 800x600 downscale to native resolution): the ruler must move with the
 * points, or every export silently changes size.
 */
export function rescaleCalibration(
  calibration: Calibration,
  factor: number,
): Calibration {
  return {
    startX: calibration.startX * factor,
    startY: calibration.startY * factor,
    endX: calibration.endX * factor,
    endY: calibration.endY * factor,
    lengthMm: calibration.lengthMm,
  };
}

/** Converts a pixel-space point to millimetres. */
export function pointToMm(point: Point, mmPerPx: number): Point {
  return { x: point.x * mmPerPx, y: point.y * mmPerPx };
}

/** Converts a millimetre-space point back to pixels. */
export function pointToPixels(point: Point, mmPerPx: number): Point {
  return { x: point.x / mmPerPx, y: point.y / mmPerPx };
}
