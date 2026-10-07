import { binWidthMm, binLengthMm } from "./bin-size";
import { convexHull } from "../geometry/obb";
import { distanceToSegment, pointInRing } from "../geometry/rings";
import type { Point } from "../geometry/types";
import { footprintOuterRingMm, signedDistanceToFootprintRing } from "./footprint";
import type { BinSpec } from "./types";

/** Manufacturer: whambamsystems.com/pages/ultim8-jig.
 * 5 mm holes, 10 mm along rows, alternating 5 mm offsets. The manufacturer's
 * calibration-guide mat photograph confirms 5 mm between staggered rows.
 * One global lattice is used across the bin, independent of Gridfinity pitch.
 */
export const ULTIM8_COLUMN_PITCH_MM = 10;
export const ULTIM8_ROW_PITCH_MM = 5;
export const ULTIM8_ROW_OFFSET_MM = 5;
/** Roots grow at 45 degrees above the mat; never flare inside its holes. */
export const ULTIM8_ROOT_HEIGHT_MM = 8;
export const ULTIM8_COLLAR_HEIGHT_MM = 1.6;
export const DEFAULT_PEG_BOTTOM = { diameterMm: 4.8, lengthMm: 4, underside: "sloped", density: 1 } as const;

export function hasSmoothBase(spec: Pick<BinSpec, "flatBottom"> & Partial<Pick<BinSpec, "pegBottom">>): boolean {
  return spec.flatBottom || spec.pegBottom != null;
}

/** Positive extension below the existing bin frame; pocket heights stay unchanged. */
export function pegBottomExtensionMm(spec: BinSpec): number {
  return spec.pegBottom ? spec.pegBottom.lengthMm + pegBottomRootHeightMm(spec) : 0;
}

/** A short bridged web starts at the flared collars. Its outer chamfer needs
 * enough height to grow to every footprint vertex at 45 degrees. The convex
 * distance reaches its maximum at a vertex; a 0.2 mm margin covers tessellation.
 * This calculation also handles a single peg and collinear peg centres.
 */
export function pegBottomRootHeightMm(spec: BinSpec): number {
  if (spec.pegBottom?.underside === "flat") return 0;
  if (!spec.pegBottom || spec.pegBottom.underside === "sloped") return ULTIM8_ROOT_HEIGHT_MM;
  const hull = convexHull(ultim8PegCenters(spec));
  if (!hull.length) return ULTIM8_ROOT_HEIGHT_MM;
  const collarRadius = spec.pegBottom.diameterMm / 2 + ULTIM8_COLLAR_HEIGHT_MM;
  const distance = (point: Point): number => pointInRing(hull, point) ? 0 :
    Math.min(...hull.map((a, i) => distanceToSegment(point, a, hull[(i + 1) % hull.length])));
  const gap = Math.max(0, ...footprintOuterRingMm(spec, 64).map(point => distance(point) - collarRadius));
  const chamferHeight = Math.max(0.4, Math.ceil((gap + 0.2) * 5) / 5);
  return ULTIM8_COLLAR_HEIGHT_MM + chamferHeight;
}

/** Maximum distance between neighbouring perimeter anchors. Rectangular
 * footprints contain every lattice point inside this hull, so interior gaps
 * stay small once the collars overlap; perimeter anchors bound edge bridges.
 */
export function pegBridgeSpanMm(centers: readonly Point[]): number {
  const hull = convexHull(centers);
  let span = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const anchors = centers.filter(point => distanceToSegment(point, a, b) < 1e-6)
      .map(point => Math.hypot(point.x - a.x, point.y - a.y)).sort((a, b) => a - b);
    for (let j = 1; j < anchors.length; j++) span = Math.max(span, anchors[j] - anchors[j - 1]);
  }
  return span;
}

/** Full round pegs only, inset from the rounded/custom footprint boundary. */
export function ultim8PegCenters(spec: BinSpec): Point[] {
  if (!spec.pegBottom) return [];
  const ring = footprintOuterRingMm(spec, 24);
  const radius = spec.pegBottom.diameterMm / 2;
  const halfX = binWidthMm(spec) / 2;
  const halfY = binLengthMm(spec) / 2;
  const centers: Point[] = [];
  for (let row = Math.ceil(-halfY / ULTIM8_ROW_PITCH_MM); row <= Math.floor(halfY / ULTIM8_ROW_PITCH_MM); row++) {
    const offset = Math.abs(row % 2) * ULTIM8_ROW_OFFSET_MM;
    for (let column = Math.ceil((-halfX - offset) / ULTIM8_COLUMN_PITCH_MM);
      column <= Math.floor((halfX - offset) / ULTIM8_COLUMN_PITCH_MM); column++) {
      const point = { x: column * ULTIM8_COLUMN_PITCH_MM + offset, y: row * ULTIM8_ROW_PITCH_MM };
      if (signedDistanceToFootprintRing(point, ring) >= radius + 0.05) centers.push(point);
    }
  }
  return centers;
}

export const PEG_DENSITIES = ["corners", 1, 2, 3, 4, 5] as const;

/** Corner anchors are selected from surviving full pegs. A through opening at a
 * corner picks the next nearest fitting hole. Sparse rows and columns keep the
 * manufacturer's stagger and always retain the nearest corner anchors.
 */
export function selectUltim8PegCenters(spec: BinSpec, available: readonly Point[]): Point[] {
  const density = spec.pegBottom?.density ?? 1;
  if (!available.length || density === 1) return [...available];
  const halfW = binWidthMm(spec) / 2, halfL = binLengthMm(spec) / 2;
  const ring = spec.footprint.kind === "rectangle" ? [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: x * halfW, y: y * halfL }))) : footprintOuterRingMm(spec, 8).filter((_, index) => index % 2 === 1);
  const anchors = new Set<Point>();
  for (const corner of ring) {
    let closest = available[0], distance = Infinity;
    for (const point of available) {
      const squared = (point.x - corner.x) ** 2 + (point.y - corner.y) ** 2;
      if (squared < distance) { closest = point; distance = squared; }
    }
    anchors.add(closest);
  }
  return available.filter(point => {
    if (anchors.has(point)) return true;
    if (density === "corners") return false;
    const row = point.y / ULTIM8_ROW_PITCH_MM;
    const column = (point.x - Math.abs(row % 2) * ULTIM8_ROW_OFFSET_MM) / ULTIM8_COLUMN_PITCH_MM;
    return row % density === 0 && column % density === 0;
  });
}
