import { convexHull } from "../geometry/obb";
import { distanceToSegment, pointInRing } from "../geometry/rings";
import type { Point } from "../geometry/types";
import { footprintOuterRingMm, signedDistanceToFootprintRing } from "./footprint";
import { binFootprintMm } from "./standard";
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
export const PEG_DENSITIES = ["corners", 1, 2, 3, 4, 5] as const;
export const DEFAULT_PEG_BOTTOM = { diameterMm: 4.8, lengthMm: 4, underside: "sloped", density: 1 } as const;

export function hasSmoothBase(spec: Pick<BinSpec, "flatBottom"> & Partial<Pick<BinSpec, "pegBottom">>): boolean {
  return spec.flatBottom || spec.pegBottom != null;
}

/** Positive extension below the existing bin frame; pocket heights stay unchanged. */
export function pegBottomExtensionMm(spec: BinSpec): number {
  return spec.pegBottom ? spec.pegBottom.lengthMm + pegBottomRootHeightMm(spec) : 0;
}

/** Sparse sloped roots grow to cover the whole footprint at 45 degrees.
 * A short bridged web starts at the flared collars; its outer chamfer grows
 * to every footprint vertex. Both calculations include tessellation margins
 * and handle a single peg or collinear peg centres.
 */
export function pegBottomRootHeightMm(spec: BinSpec): number {
  if (!spec.pegBottom) return ULTIM8_ROOT_HEIGHT_MM;
  if (spec.pegBottom.underside === "sloped") {
    if (spec.pegBottom.density === 1) return ULTIM8_ROOT_HEIGHT_MM;
    const cached = sparseRootHeights.get(spec);
    if (cached !== undefined) return cached;
    const reach = sparseCoverRadiusMm(spec, ultim8PegCenters(spec));
    // The preview's 24-sided cones are inscribed circles. Compensate for
    // their flat sides, then round upward to a printable 0.2 mm increment.
    const height = Math.max(ULTIM8_ROOT_HEIGHT_MM,
      Math.ceil((reach / Math.cos(Math.PI / 24) - spec.pegBottom.diameterMm / 2 + 0.2) * 5) / 5);
    sparseRootHeights.set(spec, height);
    return height;
  }
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

/** Full round pegs on the global mat lattice, inset from the footprint. */
function allUltim8PegCenters(spec: BinSpec): Point[] {
  if (!spec.pegBottom) return [];
  const ring = footprintOuterRingMm(spec, 24);
  const radius = spec.pegBottom.diameterMm / 2;
  const halfX = binFootprintMm(spec.gridX, spec.gridPitch) / 2;
  const halfY = binFootprintMm(spec.gridY, spec.gridPitch) / 2;
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

/** Select a regular sub-lattice without changing the manufacturer's row offsets.
 * Corner anchors use the nearest fitting hole at each actual footprint bend,
 * including concave/custom corners. Rounded-arc tessellation does not add pegs.
 * Tiny footprints may share one anchor between several corners.
 */
export function ultim8PegCenters(spec: BinSpec): Point[] {
  const all = allUltim8PegCenters(spec);
  if (!spec.pegBottom || !all.length || spec.pegBottom.density === 1) return all;
  const corners = footprintOuterRingMm(spec, 8).filter((_, index) => index % 2 === 1);
  const anchors = new Set<Point>();
  for (const corner of corners) {
    let closest = all[0], distance = Infinity;
    for (const point of all) {
      const squared = (point.x - corner.x) ** 2 + (point.y - corner.y) ** 2;
      if (squared < distance) { closest = point; distance = squared; }
    }
    anchors.add(closest);
  }
  const density = spec.pegBottom.density;
  return all.filter(point => {
    if (anchors.has(point)) return true;
    if (density === "corners") return false;
    const row = point.y / ULTIM8_ROW_PITCH_MM;
    const offset = Math.abs(row % 2) * ULTIM8_ROW_OFFSET_MM;
    const column = (point.x - offset) / ULTIM8_COLUMN_PITCH_MM;
    return row % density === 0 && column % density === 0;
  });
}

// Bin specs are immutable reducer/project snapshots; avoid repeating the
// spatial calculation for dimensions, ground placement and geometry assembly.
const sparseRootHeights = new WeakMap<BinSpec, number>();

/** Conservative nearest-anchor covering radius over the whole footprint.
 * Distance to the nearest peg is 1-Lipschitz: the centre distance plus a
 * rectangle's half-diagonal bounds every point in that rectangle. Subdivide
 * only rectangles that can exceed the best sample, until within 0.1 mm.
 * This covers interiors as well as edges, unlike a perimeter-only check.
 */
function sparseCoverRadiusMm(spec: BinSpec, centers: readonly Point[]): number {
  if (!centers.length) return 0;
  const rows = new Map<number, number[]>();
  for (const { x, y } of centers) {
    const xs = rows.get(y) ?? [];
    xs.push(x); rows.set(y, xs);
  }
  const orderedRows = [...rows].map(([y, xs]) => ({ y, xs: xs.sort((a, b) => a - b) }));
  const nearest = (x: number, y: number): number => {
    let squared = Infinity;
    for (const row of orderedRows) {
      const dy = (y - row.y) ** 2;
      if (dy >= squared) continue;
      let lo = 0, hi = row.xs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (row.xs[mid] < x) lo = mid + 1; else hi = mid;
      }
      for (const index of [lo - 1, lo]) {
        if (index >= 0 && index < row.xs.length) squared = Math.min(squared, dy + (x - row.xs[index]) ** 2);
      }
    }
    return Math.sqrt(squared);
  };
  const ring = footprintOuterRingMm(spec, 64);
  let best = Math.max(...ring.map(p => nearest(p.x, p.y)));
  let upperBound = best;
  const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pending = [{ x: (minX + maxX) / 2, y: (minY + maxY) / 2, hx: (maxX - minX) / 2, hy: (maxY - minY) / 2 }];
  while (pending.length) {
    const tile = pending.pop()!;
    const radius = Math.hypot(tile.hx, tile.hy);
    const boundaryDistance = signedDistanceToFootprintRing(tile, ring);
    if (boundaryDistance < -radius) continue;
    const distance = nearest(tile.x, tile.y);
    if (boundaryDistance >= 0) best = Math.max(best, distance);
    const upper = distance + radius;
    if (upper <= best + 0.1 || radius <= 0.1) {
      upperBound = Math.max(upperBound, upper);
      continue;
    }
    const hx = tile.hx / 2, hy = tile.hy / 2;
    for (const dx of [-hx, hx]) for (const dy of [-hy, hy]) pending.push({ x: tile.x + dx, y: tile.y + dy, hx, hy });
  }
  return Math.max(best, upperBound);
}
