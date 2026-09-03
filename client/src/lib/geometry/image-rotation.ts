import type { Calibration, DraftCalibration } from "@shared/geometry/scale";
import type { Outline, Point, Rect } from "@shared/geometry/types";

import { mapOutline } from "./outline";

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Clockwise quarter-turns from the decoded source image. */
export type ImageQuarterTurns = 0 | 1 | 2 | 3;
export type ImageRotationDirection = "clockwise" | "counterclockwise";

/** Advances a source-image orientation by exactly 90 degrees. */
export function nextImageRotation(
  current: ImageQuarterTurns,
  direction: ImageRotationDirection,
): ImageQuarterTurns {
  return ((current + (direction === "clockwise" ? 1 : 3)) % 4) as ImageQuarterTurns;
}

/** Applies a relative orientation to an already-oriented source. */
export function combineImageRotations(
  base: ImageQuarterTurns,
  relative: ImageQuarterTurns,
): ImageQuarterTurns {
  return ((base + relative) % 4) as ImageQuarterTurns;
}

/** Dimensions after applying an orientation to the decoded source. */
export function rotatedImageDimensions(
  size: ImageDimensions,
  rotation: ImageQuarterTurns,
): ImageDimensions {
  return rotation % 2 === 0
    ? { width: size.width, height: size.height }
    : { width: size.height, height: size.width };
}

/** Fits dimensions inside a cap without changing their aspect ratio. */
export function fitImageWithin(
  natural: ImageDimensions,
  max: ImageDimensions,
): ImageDimensions {
  let { width, height } = natural;
  if (width > max.width) {
    height = (max.width / width) * height;
    width = max.width;
  }
  if (height > max.height) {
    width = (max.height / height) * width;
    height = max.height;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Rotates a point between two working-resolution image frames.
 *
 * The target may use a different fit-to-cap scale after width and height swap,
 * so the transform includes the exact per-axis ratios rather than assuming the
 * new frame is merely the old dimensions reversed.
 */
export function rotateImagePoint(
  point: Point,
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): Point {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    target.width <= 0 ||
    target.height <= 0
  ) {
    return point;
  }

  const scaleX = target.width / source.height;
  const scaleY = target.height / source.width;
  return direction === "clockwise"
    ? {
        x: (source.height - point.y) * scaleX,
        y: point.x * scaleY,
      }
    : {
        x: point.y * scaleX,
        y: (source.width - point.x) * scaleY,
      };
}

/** Rotates every ring without changing its shell/hole winding. */
export function rotateImageOutline(
  outline: Outline,
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): Outline {
  return mapOutline(outline, (point) =>
    rotateImagePoint(point, source, target, direction),
  );
}

/** Rotates an axis-aligned detection region into the new image frame. */
export function rotateImageRect(
  rect: Rect,
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): Rect {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((point) => rotateImagePoint(point, source, target, direction));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Rotates the endpoints while preserving their known physical length. */
export function rotateImageCalibration(
  calibration: Calibration,
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): Calibration {
  const start = rotateImagePoint(
    { x: calibration.startX, y: calibration.startY },
    source,
    target,
    direction,
  );
  const end = rotateImagePoint(
    { x: calibration.endX, y: calibration.endY },
    source,
    target,
    direction,
  );
  return {
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    lengthMm: calibration.lengthMm,
  };
}

/** Rotates whichever complete endpoint pairs an in-progress ruler contains. */
export function rotateDraftCalibration(
  draft: DraftCalibration,
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): DraftCalibration {
  const rotated = { ...draft };
  if (draft.startX !== undefined && draft.startY !== undefined) {
    const start = rotateImagePoint(
      { x: draft.startX, y: draft.startY },
      source,
      target,
      direction,
    );
    rotated.startX = start.x;
    rotated.startY = start.y;
  }
  if (draft.endX !== undefined && draft.endY !== undefined) {
    const end = rotateImagePoint(
      { x: draft.endX, y: draft.endY },
      source,
      target,
      direction,
    );
    rotated.endX = end.x;
    rotated.endY = end.y;
  }
  return rotated;
}
