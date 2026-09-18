import type { Point } from "@shared/geometry/types";
import { ARUCO_4X4_MODULES, markerBits } from "./aruco-4x4";

/** Physical contract shared by paper, 3MF and detection. Never scale to fit. */
export const REFERENCE_STRIP = {
  version: 1,
  lengthMm: 100,
  widthMm: 20,
  thicknessMm: 1.2,
  inkDepthMm: 0.4,
  markerSizeMm: 15,
  centerSpacingMm: 80,
  markerIds: [20, 21],
} as const;

/** Image/paper coordinates: x right, y down, origin at the strip's top left. */
export function referenceStripMarkers(): {
  id: number;
  center: Point;
  corners: [Point, Point, Point, Point];
}[] {
  const half = REFERENCE_STRIP.markerSizeMm / 2;
  return REFERENCE_STRIP.markerIds.map((id, index) => {
    const x = (REFERENCE_STRIP.lengthMm - REFERENCE_STRIP.centerSpacingMm) / 2 +
      index * REFERENCE_STRIP.centerSpacingMm;
    const y = REFERENCE_STRIP.widthMm / 2;
    return {
      id,
      center: { x, y },
      corners: [
        { x: x - half, y: y - half },
        { x: x + half, y: y - half },
        { x: x + half, y: y + half },
        { x: x - half, y: y + half },
      ],
    };
  });
}

/** Black cells, including the border. Used for both ink and flush 3D inlays. */
export function referenceStripBlackCells(): { x: number; y: number; size: number }[] {
  const size = REFERENCE_STRIP.markerSizeMm / ARUCO_4X4_MODULES;
  return referenceStripMarkers().flatMap(({ id, corners }) => {
    const bits = markerBits(id);
    const cells: { x: number; y: number; size: number }[] = [];
    for (let row = 0; row < ARUCO_4X4_MODULES; row++) {
      for (let col = 0; col < ARUCO_4X4_MODULES; col++) {
        const border = row === 0 || col === 0 || row === 5 || col === 5;
        if (border || !bits[row - 1][col - 1]) {
          cells.push({
            x: corners[0].x + col * size,
            y: corners[0].y + row * size,
            size,
          });
        }
      }
    }
    return cells;
  });
}

/** True-size vector label; the complete white quiet zone is part of the design. */
export function referenceStripSvg(): string {
  const { lengthMm, widthMm } = REFERENCE_STRIP;
  const cells = referenceStripBlackCells().map(({ x, y, size }) =>
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="black"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lengthMm}mm" height="${widthMm}mm" viewBox="0 0 ${lengthMm} ${widthMm}"><rect width="${lengthMm}" height="${widthMm}" fill="white"/>${cells}</svg>`;
}
