/**
 * Gridfinity standard dimensions, ported from `gridfinity-rebuilt-openscad`.
 *
 * Upstream: https://github.com/kennetek/gridfinity-rebuilt-openscad
 * File:     src/core/standard.scad
 * Commit:   910e22d8607fd7f5f51ad5e5cbc5287a76810bfd (2025-08-31)
 * Licence:  MIT © 2023 Kenneth Hodson — full text in /NOTICE, provenance table in
 *           client/src/lib/gridfinity/UPSTREAM.md.
 *
 * This module is deliberately dependency-free (no zod, no manifold) so it can
 * be imported by the server, by workers, and by Node tests. Values are in
 * millimetres unless a name says otherwise. Upstream constant names are kept
 * (SCREAMING_SNAKE) so diffing against a future upstream sync is mechanical.
 */

/** A 2D point of a profile polygon: `[x, y]` in millimetres. */
export type ProfilePoint = readonly [number, number];

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Pitch of the Gridfinity grid. Bases repeat every 42 mm in x and y. */
export const GRID_DIMENSIONS_MM = 42;

/** Supported subdivisions of the standard 42 mm pitch. */
export type GridPitch = "full" | "half" | "quarter";

/** Number of equal subdivisions inside one standard 42 mm cell. */
export const GRID_PITCH_DIVISOR: Readonly<Record<GridPitch, number>> = {
  full: 1,
  half: 2,
  quarter: 4,
};

/** Physical pitch of one selected grid unit. */
export function gridPitchMm(pitch: GridPitch = "full"): number {
  return GRID_DIMENSIONS_MM / GRID_PITCH_DIVISOR[pitch];
}

/** Selected-pitch grid count expressed in standard 42 mm cells. */
export function standardCellSpan(
  gridCount: number,
  pitch: GridPitch = "full",
): number {
  return gridCount / GRID_PITCH_DIVISOR[pitch];
}

export interface RectangularGridDimensions {
  gridX: number;
  gridY: number;
  gridPitch: GridPitch;
}

/**
 * Changes one rectangular dimension in standard-cell units.
 *
 * Grid geometry remains an integer lattice internally. When a full-pitch bin
 * first receives a half-cell dimension, both axes are promoted to half pitch
 * so the untouched physical span stays fixed. Existing half/quarter pitch is
 * retained rather than silently changing the socket pattern.
 */
export function resizeGridToStandardCellSpan(
  grid: RectangularGridDimensions,
  axis: "x" | "y",
  span: number,
): RectangularGridDimensions {
  if (!Number.isFinite(span) || span <= 0) {
    throw new Error(`Grid span must be positive, got ${span}`);
  }

  const pitches: readonly GridPitch[] = ["full", "half", "quarter"];
  const currentIndex = pitches.indexOf(grid.gridPitch);
  const targetPitch = pitches
    .slice(currentIndex)
    .find((pitch) => Number.isInteger(span * GRID_PITCH_DIVISOR[pitch]));
  if (!targetPitch) {
    throw new Error(`Grid span must align to a quarter cell, got ${span}`);
  }

  const currentDivisor = GRID_PITCH_DIVISOR[grid.gridPitch];
  const targetDivisor = GRID_PITCH_DIVISOR[targetPitch];
  const promotion = targetDivisor / currentDivisor;
  const resized = {
    gridX: grid.gridX * promotion,
    gridY: grid.gridY * promotion,
    gridPitch: targetPitch,
  };
  if (axis === "x") resized.gridX = Math.round(span * targetDivisor);
  else resized.gridY = Math.round(span * targetDivisor);
  return resized;
}

/** Height of one Gridfinity height unit ("u"). A "6u" bin is 42 mm tall. */
export const HEIGHT_UNIT_MM = 7;

// ---------------------------------------------------------------------------
// Base (the socket that clips into a baseplate)
// ---------------------------------------------------------------------------

/**
 * Outer surface of the base, bottom to top, as `[outward, up]` offsets from
 * the innermost bottom point: a 0.8 chamfer, a 1.8 straight, a 2.15 chamfer.
 * Both chamfers are 45°.
 */
export const BASE_PROFILE: readonly ProfilePoint[] = [
  [0, 0],
  [0.8, 0.8],
  [0.8, 2.6], // 0.8 + 1.8
  [2.95, 4.75], // 0.8 + 2.15, 0.8 + 1.8 + 2.15 — written as literals so
  // downstream sums (e.g. +BASE_BOTTOM_RADIUS) stay on exact binary values
];

/** Total horizontal extent of {@link BASE_PROFILE}: how far the top overhangs the bottom. */
export const BASE_PROFILE_MAX_X = 2.95;

/** Height of the swept base profile alone, without the bridge above it. */
export const BASE_PROFILE_HEIGHT = 4.75;

/** Full height of the base: profile plus the bridge tying multiple bases together. */
export const BASE_HEIGHT = 7;

/** Height of the solid structure above the profile that ties bases together. */
export const BASE_BRIDGE_HEIGHT = 2.25; // BASE_HEIGHT − BASE_PROFILE_HEIGHT

/** Top of one base is 41.5 × 41.5 — leaves {@link BASE_GAP_MM} to the 42 pitch. */
export const BASE_TOP_DIMENSIONS_MM = 41.5;

/** Gap between adjacent bases (and around the perimeter) demanded by the spec. */
export const BASE_GAP_MM = GRID_DIMENSIONS_MM - BASE_TOP_DIMENSIONS_MM; // 0.5

/** Corner radius at the top of the base (and of the bin body above it). */
export const BASE_TOP_RADIUS = 7.5 / 2;

/**
 * Corner radius at the bottom of the base. Also how far {@link BASE_PROFILE}
 * is translated outward before sweeping, so the corner revolve produces it.
 */
export const BASE_BOTTOM_RADIUS = 0.8; // BASE_TOP_RADIUS − BASE_PROFILE_MAX_X

/** Bottom footprint of a base for a given top footprint. */
export function baseBottomDimensionsMm(
  topDimensionsMm: number = BASE_TOP_DIMENSIONS_MM,
): number {
  return topDimensionsMm - 2 * BASE_PROFILE_MAX_X; // 35.6 for the standard base
}

// ---------------------------------------------------------------------------
// Stacking lip
// ---------------------------------------------------------------------------

/**
 * Recess surface of the stacking lip, bottom-inner tip to top-outer edge, as
 * `[outward, up]` from the tip: a 0.7 chamfer, a 1.8 straight, a 1.9 chamfer —
 * the base profile shrunk by the stacking clearance, so a base drops in.
 */
export const STACKING_LIP_LINE: readonly ProfilePoint[] = [
  [0, 0],
  [0.7, 0.7],
  [0.7, 2.5], // 0.7 + 1.8
  [2.6, 4.4], // 0.7 + 1.9, 0.7 + 1.8 + 1.9
];

/** How far the lip protrudes into the bin, measured from the outer wall face. */
export const STACKING_LIP_DEPTH = 2.6;

/** Nominal height of the lip above the bin's nominal top (sharp-cornered). */
export const STACKING_LIP_HEIGHT = 4.4;

/** Radius of the fillet that replaces the lip's sharp top edge. */
export const STACKING_LIP_FILLET_RADIUS = 0.6;

/**
 * Actual lip height once the top corner is filleted.
 *
 * The corner sits between a 45° rising edge and a vertical falling edge, so
 * the fillet centre lies `r·(1+√2)` below the sharp corner (at `x = 2.6 − r`),
 * and the arc's summit is `r` above that: `4.4 − r·(1+√2) + r = 4.4 − r·√2`.
 */
export const STACKING_LIP_HEIGHT_ACTUAL =
  STACKING_LIP_HEIGHT - STACKING_LIP_FILLET_RADIUS * Math.SQRT2;

/** Vertical extent of the straight inner face below the lip's support cone. */
export const STACKING_LIP_SUPPORT_HEIGHT = 1.2;

/**
 * Full height of the 45° support under the lip, from the bin's nominal top
 * down to where the support meets the outer wall:
 * `STACKING_LIP_SUPPORT_HEIGHT + tan(45°)·STACKING_LIP_DEPTH`.
 */
export const STACKING_LIP_SUPPORT_HEIGHT_MM = 3.8; // SUPPORT_HEIGHT + DEPTH

// ---------------------------------------------------------------------------
// Walls and interior
// ---------------------------------------------------------------------------

/** Minimum wall thickness of a bin. */
export const D_WALL = 0.95;

/** Interior fillet radius (`BASE_TOP_RADIUS − D_WALL`). */
export const R_F2 = 2.8;

/** Width of a divider between compartments. */
export const D_DIV = 1.2;

// ---------------------------------------------------------------------------
// Label tab (upstream `standard.scad` TAB_* constants)
// ---------------------------------------------------------------------------

/** Nominal width of a partial-width tab (`TAB_WIDTH_NOMINAL`). */
export const TAB_WIDTH_NOMINAL_MM = 42;

/** How deep the tab protrudes into the bin (`_tab_depth`). */
export const TAB_DEPTH_MM = 15.85;

/** Angle of the sloped support holding up the tab (`_tab_support_angle`). */
export const TAB_SUPPORT_ANGLE_DEG = 36;

/** Vertical face at the tab's tip, so it doesn't end in a knife edge. */
export const TAB_SUPPORT_HEIGHT_MM = 1.2;

/** Total tab height: `tan(36°)·depth + support` (`_tab_height`). */
export const TAB_HEIGHT_MM =
  Math.tan((TAB_SUPPORT_ANGLE_DEG * Math.PI) / 180) * TAB_DEPTH_MM +
  TAB_SUPPORT_HEIGHT_MM;

/**
 * The tab's cross-section (upstream `TAB_POLYGON`), CCW in a (depth-inward,
 * height-up) frame with the wall face at depth 0 and the tab top at
 * `TAB_HEIGHT_MM`: vertical wall face, flat top, 1.2 mm tip face, 36° sloped
 * underside back to the wall.
 */
export const TAB_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, TAB_HEIGHT_MM],
  [TAB_DEPTH_MM, TAB_HEIGHT_MM],
  [TAB_DEPTH_MM, TAB_HEIGHT_MM - TAB_SUPPORT_HEIGHT_MM],
];

// ---------------------------------------------------------------------------
// Magnet / screw holes (constants only in G1; the hole builders land in G2)
// ---------------------------------------------------------------------------

/** Assumed slicer layer height, used for printable hole ceilings. */
export const LAYER_HEIGHT = 0.2;

export const MAGNET_HEIGHT = 2;
export const MAGNET_HOLE_RADIUS = 6.5 / 2;
export const MAGNET_HOLE_DEPTH = MAGNET_HEIGHT + LAYER_HEIGHT * 2; // 2.4

/** Waist radius of the crush ribs; the ⌀6.5 magnet crushes the lobes. */
export const MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS = 5.9 / 2;

/** Upstream: "Anything 5 or under produces a hole that is not round." */
export const MAGNET_HOLE_CRUSH_RIB_COUNT = 8;

export const SCREW_HOLE_RADIUS = 3 / 2;

/** Distance of hole centres from the bottom edge of the base, per the spec. */
export const HOLE_DISTANCE_FROM_BOTTOM_EDGE = 4.8;

/** "Gridfinity Refined" press-fit magnet hole (measured, slightly undersized). */
export const REFINED_HOLE_RADIUS = 5.86 / 2;
export const REFINED_HOLE_HEIGHT = MAGNET_HEIGHT - 0.1;
export const REFINED_HOLE_BOTTOM_LAYERS = 2;

/** Radius added to a hole when chamfering its entry, at {@link CHAMFER_ANGLE}. */
export const CHAMFER_ADDITIONAL_RADIUS = 0.8;
export const CHAMFER_ANGLE = 45;

// ---------------------------------------------------------------------------
// Bin-level derived dimensions
// ---------------------------------------------------------------------------

/**
 * Outer footprint of a bin, in mm: `count·pitch − 0.5` per axis. The 0.5 mm
 * perimeter gap remains constant for full, half, and quarter pitches, matching
 * upstream's fractional-grid rule; a standard 2×3 bin is 83.5 × 125.5 mm.
 */
export function binFootprintMm(
  gridCount: number,
  pitch: GridPitch = "full",
): number {
  return gridCount * gridPitchMm(pitch) - BASE_GAP_MM;
}

/**
 * Height of a bin from the bottom of the base to the nominal top of the wall,
 * excluding the stacking lip: `units · 7`. Includes {@link BASE_HEIGHT}.
 */
export function binHeightMm(heightUnits: number): number {
  return heightUnits * HEIGHT_UNIT_MM;
}

/** Height of the plain wall between the base and the nominal top. */
export function binWallHeightMm(heightUnits: number): number {
  return binHeightMm(heightUnits) - BASE_HEIGHT;
}

/** Overall height including the (filleted) stacking lip when present. */
export function binTotalHeightMm(heightUnits: number, lip: boolean): number {
  return binHeightMm(heightUnits) + (lip ? STACKING_LIP_HEIGHT_ACTUAL : 0);
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Upstream commit these constants were verified against. */
export const UPSTREAM_REPO =
  "https://github.com/kennetek/gridfinity-rebuilt-openscad";
export const UPSTREAM_SHA = "910e22d8607fd7f5f51ad5e5cbc5287a76810bfd";
