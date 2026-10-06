import type { Point, Rect } from "./types";

/** SVG/Canvas affine matrix: x' = ax + cy + e, y' = bx + dy + f. */
export type ImageMatrix = [number, number, number, number, number, number];
export interface ImageAlignment {
  sourceSize: { width: number; height: number };
  size: { width: number; height: number };
  matrix: ImageMatrix;
}
export const IDENTITY_IMAGE_MATRIX: ImageMatrix = [1, 0, 0, 1, 0, 0];

export function transformImagePoint(p: Point, m: ImageMatrix): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Apply b, then a. */
export function composeImageMatrices(a: ImageMatrix, b: ImageMatrix): ImageMatrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

export function inverseImageMatrix(m: ImageMatrix): ImageMatrix {
  const det = m[0]*m[3]-m[1]*m[2];
  return [m[3]/det, -m[1]/det, -m[2]/det, m[0]/det,
    (m[2]*m[5]-m[3]*m[4])/det, (m[1]*m[4]-m[0]*m[5])/det];
}

export function transformImageRect(rect: Rect, matrix: ImageMatrix): Rect {
  const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]
    .map(p => transformImagePoint(p, matrix));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y };
}

/** Keep the original photo intact and fit its rotated corners without resizing. */
export function rotateImageAlignment(size: ImageAlignment["size"], radians: number, previous: ImageAlignment | null = null): {
  alignment: ImageAlignment; transform: ImageMatrix;
} {
  const sourceSize = previous?.sourceSize ?? size;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const rotation: ImageMatrix = [cos, sin, -sin, cos, 0, 0];
  const matrix = composeImageMatrices(rotation, previous?.matrix ?? IDENTITY_IMAGE_MATRIX);
  const bounds = transformImageRect({ x: 0, y: 0, ...sourceSize }, matrix);
  const translation: ImageMatrix = [1, 0, 0, 1, -bounds.x, -bounds.y];
  return {
    alignment: { sourceSize, size: { width: Math.max(1, Math.ceil(bounds.width - 1e-9)),
      height: Math.max(1, Math.ceil(bounds.height - 1e-9)) }, matrix: composeImageMatrices(translation, matrix) },
    transform: composeImageMatrices(translation, rotation),
  };
}
