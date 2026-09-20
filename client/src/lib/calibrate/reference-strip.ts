import type { Point } from "@shared/geometry/types";
import { ARUCO_4X4_MODULES, markerBits } from "./aruco-4x4";

export interface ReferenceStripSpec {
  readonly version: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly inkDepthMm: number;
  readonly markerSizeMm: number;
  readonly centerSpacingMm: number;
  readonly markerIds: readonly [number, number];
}

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

export const MEASUREMENT_AID_LENGTHS = [50, 100, 200] as const;
export type MeasurementAidLength = typeof MEASUREMENT_AID_LENGTHS[number];

/** New sizes have distinct identities; IDs 20/21 keep the original strip valid. */
export const MEASUREMENT_AIDS: Record<MeasurementAidLength, ReferenceStripSpec> = {
  50: { version: 2, lengthMm: 50, widthMm: 15, thicknessMm: 2, inkDepthMm: 0.4, markerSizeMm: 9, centerSpacingMm: 35, markerIds: [22, 23] },
  100: { version: 2, lengthMm: 100, widthMm: 15, thicknessMm: 2, inkDepthMm: 0.4, markerSizeMm: 9, centerSpacingMm: 85, markerIds: [24, 25] },
  200: { version: 2, lengthMm: 200, widthMm: 15, thicknessMm: 2, inkDepthMm: 0.4, markerSizeMm: 9, centerSpacingMm: 185, markerIds: [26, 27] },
};
export const REFERENCE_STRIP_SPECS: readonly ReferenceStripSpec[] = [REFERENCE_STRIP, ...Object.values(MEASUREMENT_AIDS)];
export const REFERENCE_STRIP_MARKER_IDS = REFERENCE_STRIP_SPECS.flatMap((spec) => [...spec.markerIds]);

/** One complete, unambiguous pair; mixed sizes and multiple rulers are rejected. */
export function referenceStripFromMarkerIds(ids: readonly number[]): ReferenceStripSpec | null {
  if (ids.length !== 2 || ids[0] === ids[1]) return null;
  return REFERENCE_STRIP_SPECS.find((spec) => spec.markerIds.every((id) => ids.includes(id))) ?? null;
}

export function referenceStripFromRulerLength(lengthMm: number): ReferenceStripSpec | null {
  return REFERENCE_STRIP_SPECS.find((spec) => spec.centerSpacingMm === lengthMm) ?? null;
}

/** Image/paper coordinates: x right, y down, origin at the strip's top left. */
export function referenceStripMarkers(spec: ReferenceStripSpec = REFERENCE_STRIP): {
  id: number;
  center: Point;
  corners: [Point, Point, Point, Point];
}[] {
  const half = spec.markerSizeMm / 2;
  return spec.markerIds.map((id, index) => {
    const x = (spec.lengthMm - spec.centerSpacingMm) / 2 +
      index * spec.centerSpacingMm;
    const y = spec.widthMm / 2;
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
export function referenceStripBlackCells(spec: ReferenceStripSpec = REFERENCE_STRIP): { x: number; y: number; size: number }[] {
  const size = spec.markerSizeMm / ARUCO_4X4_MODULES;
  return referenceStripMarkers(spec).flatMap(({ id, corners }) => {
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
