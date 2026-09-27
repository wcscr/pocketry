import type { Point } from "@shared/geometry/types";
import type { PerspectiveLayout, PerspectiveQuad } from "./perspective";

export class PhotoPerspectiveBoundsError extends Error {}

export interface PhotoPerspectiveLayout {
  layout: PerspectiveLayout;
  /** Row-major source-photo to output-pixel homography. */
  transform: number[];
}

/** Keep every source pixel after rectification, including tools outside the
 * reference sheet. Translate the projected bounds, then uniformly downsample
 * within the existing raster budget; that same scale updates the ruler. */
export function photoPerspectiveLayout(
  matrix: ArrayLike<number>,
  image: { width: number; height: number },
  paperLayout: PerspectiveLayout,
  max: { width: number; height: number },
): PhotoPerspectiveLayout {
  const h = Array.from(matrix);
  if (h.length !== 9 || h.some(value => !Number.isFinite(value)) ||
    !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 2 || image.height < 2 ||
    !Number.isFinite(max.width) || !Number.isFinite(max.height) || max.width < 2 || max.height < 2) {
    throw new PhotoPerspectiveBoundsError("The photo could not define a stable correction area.");
  }
  const corners = [
    { x: 0, y: 0 }, { x: image.width - 1, y: 0 },
    { x: image.width - 1, y: image.height - 1 }, { x: 0, y: image.height - 1 },
  ];
  const weights = corners.map(({ x, y }) => h[6] * x + h[7] * y + h[8]);
  // The denominator is linear, so consistent corner signs exclude a horizon
  // anywhere inside the photo. Bounding just the divided corners would miss
  // an infinite span in its interior and silently lose part of a large tool.
  const tolerance = Math.max(...weights.map(Math.abs)) * 1e-8;
  if (!weights.every(value => value > tolerance) && !weights.every(value => value < -tolerance)) {
    throw new PhotoPerspectiveBoundsError("The photo is too tilted to keep the full image during correction. Retake it from more directly above, or use scale without correction.");
  }
  const projected = corners.map(({ x, y }, index) => ({
    x: (h[0] * x + h[1] * y + h[2]) / weights[index],
    y: (h[3] * x + h[4] * y + h[5]) / weights[index],
  }));
  const minX = Math.min(...projected.map(point => point.x));
  const minY = Math.min(...projected.map(point => point.y));
  const spanX = Math.max(...projected.map(point => point.x)) - minX;
  const spanY = Math.max(...projected.map(point => point.y)) - minY;
  if (![minX, minY, spanX, spanY].every(Number.isFinite) || spanX <= 0 || spanY <= 0) {
    throw new PhotoPerspectiveBoundsError("The photo could not define a stable correction area.");
  }
  const widthLimit = Math.floor(max.width);
  const heightLimit = Math.floor(max.height);
  const scale = Math.min(1, (widthLimit - 1) / spanX, (heightLimit - 1) / spanY);
  const destination = paperLayout.destination.map(({ x, y }: Point) => ({
    x: (x - minX) * scale, y: (y - minY) * scale,
  })) as PerspectiveQuad;
  return {
    layout: {
      width: Math.min(widthLimit, Math.ceil(spanX * scale) + 1),
      height: Math.min(heightLimit, Math.ceil(spanY * scale) + 1),
      pxPerMm: paperLayout.pxPerMm * scale,
      destination,
    },
    // Compose output translation and uniform scale with the fitted homography.
    transform: [
      scale * (h[0] - minX * h[6]), scale * (h[1] - minX * h[7]), scale * (h[2] - minX * h[8]),
      scale * (h[3] - minY * h[6]), scale * (h[4] - minY * h[7]), scale * (h[5] - minY * h[8]),
      h[6], h[7], h[8],
    ],
  };
}
