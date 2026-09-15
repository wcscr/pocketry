import type { Point } from "../geometry/types";
import { BASE_HEIGHT, BASE_PROFILE_MAX_X, BASE_PROFILE_HEIGHT, STACKING_LIP_HEIGHT_ACTUAL, binWallThicknessMm, HOLE_DISTANCE_FROM_BOTTOM_EDGE, MAGNET_HOLE_DEPTH, MAGNET_HOLE_RADIUS, binFootprintMm, binHeightMm } from "./standard";
import type { BinSpec } from "./types";

/** Lid retention uses the same magnet recess dimensions as the base. */
export const LID_MAGNET_WALL_MM = 1.2;
export const LID_PAD_DEPTH_MM = MAGNET_HOLE_DEPTH + LID_MAGNET_WALL_MM;
/** Same inset as the outermost base magnets, independent of socket pitch. */
export const LID_MAGNET_INSET_MM = BASE_PROFILE_MAX_X + HOLE_DISTANCE_FROM_BOTTOM_EDGE;
export const LID_CLEARANCE_MM = 0.3;
export const LID_PREVIEW_LIFT_MM = 16;
/** The inset friction skirt remains thin enough to flex between contact ribs. */
export const INSET_LID_SKIRT_WALL_MM = 0.8;
export const LID_SKIRT_CLEARANCE_MM = 0.3;
export const LID_RIM_WALL_MM = 1.2;
export const LID_OVERLAP_MM = 5;
export const LID_SHOULDER_GAP_MM = 0.2;
export const LID_CAP_THICKNESS_MM = LID_PAD_DEPTH_MM;
/** Close the visible inset seam without lowering the magnet mating face. */
export const INSET_LID_CAP_BOTTOM_MM = STACKING_LIP_HEIGHT_ACTUAL + LID_SHOULDER_GAP_MM;
/** Exposes about 3.2 mm above the stacking lip for a finger grip. */
export const INSET_LID_TOP_MM = BASE_PROFILE_HEIGHT + 2;
/** Initial interference at the narrow contact ridge; requires a physical fit test. */
export const LID_FRICTION_INTERFERENCE_MM = 0.05;

type WallSpec = Pick<BinSpec, "wallThicknessMm" | "lidWallThicknessMm">;

export function overlapLidWallMm(spec: WallSpec): number {
  return spec.lidWallThicknessMm ?? binWallThicknessMm(spec);
}

/** Preserve old printed pairs until the shared control is explicitly edited. */
export function overlapRimWallMm(spec: WallSpec): number {
  return spec.lidWallThicknessMm === undefined ? binWallThicknessMm(spec) : LID_RIM_WALL_MM;
}

/** Keep the original outer footprint and a separate mating clearance. */
export function overlapLidRimInsetMm(spec: WallSpec): number {
  return overlapLidWallMm(spec) + LID_SKIRT_CLEARANCE_MM;
}

/** Thick stepped rims need the paired magnets farther from the outer edge. */
export function lidMagnetInsetMm(spec: BinSpec): number {
  return hasOverlappingLid(spec)
    ? Math.max(LID_MAGNET_INSET_MM, overlapLidRimInsetMm(spec) + MAGNET_HOLE_RADIUS + LID_MAGNET_WALL_MM)
    : LID_MAGNET_INSET_MM;
}

export function lidPadExtentMm(spec: BinSpec): number {
  return lidMagnetInsetMm(spec) + MAGNET_HOLE_RADIUS + LID_MAGNET_WALL_MM;
}

export function hasFrictionLid(spec: Pick<BinSpec, "lidMagnetHoles" | "lidFit">): boolean {
  return !spec.lidMagnetHoles && spec.lidFit === "friction";
}

/** Magnet closures retain their original clearance regardless of saved fit preferences. */
export function lidFitAdjustmentMm(spec: Pick<BinSpec, "lidMagnetHoles" | "lidFitAdjustmentMm">): number {
  return spec.lidMagnetHoles ? 0 : spec.lidFitAdjustmentMm;
}

export function hasOverlappingLid(spec: Pick<BinSpec, "magneticLid" | "magneticLidStyle">): boolean {
  return spec.magneticLid && spec.magneticLidStyle === "overlap";
}

/** Cap plane under an optional stacking lip, measured from the magnet faces. */
export function lidCapTopMm(spec: Pick<BinSpec, "magneticLidStyle" | "magneticLidTop">): number {
  return spec.magneticLidStyle === "overlap"
    ? (spec.magneticLidTop === "stacking" ? 4 : LID_CAP_THICKNESS_MM)
    : (spec.magneticLidTop === "stacking" ? 8 : INSET_LID_TOP_MM);
}

export function lidTopMm(spec: Pick<BinSpec, "magneticLidStyle" | "magneticLidTop">): number {
  return lidCapTopMm(spec) + (spec.magneticLidTop === "stacking" ? STACKING_LIP_HEIGHT_ACTUAL : 0);
}

export function lidBottomMm(spec: Pick<BinSpec, "magneticLidStyle">): number {
  return spec.magneticLidStyle === "overlap" ? -LID_OVERLAP_MM + LID_SHOULDER_GAP_MM : 0;
}

/** Four paired recesses; no per-cell duplication in a large lid. */
export function lidMagnetCenters(spec: BinSpec): Point[] {
  const x = binFootprintMm(spec.gridX, spec.gridPitch) / 2 - lidMagnetInsetMm(spec);
  const y = binFootprintMm(spec.gridY, spec.gridPitch) / 2 - lidMagnetInsetMm(spec);
  return [{ x, y }, { x: -x, y }, { x: -x, y: -y }, { x, y: -y }];
}

/** Unbuildable combinations remain editable but must not produce an export. */
export function magneticLidError(spec: BinSpec): string | null {
  if (!spec.magneticLid) return null;
  if (spec.footprint.kind !== "rectangle") return "Magnetic lids currently need a rectangular footprint.";
  if (spec.magneticLidStyle === "inset" && spec.lip !== "standard") return "Magnetic lids need the stacking lip for alignment.";
  if (binHeightMm(spec.heightUnits) < BASE_HEIGHT + LID_PAD_DEPTH_MM) return "Magnetic lids need a bin at least 2u tall.";
  const minimum = 2 * lidPadExtentMm(spec) + 2 * binWallThicknessMm(spec);
  if ([spec.gridX, spec.gridY].some(count => binFootprintMm(count, spec.gridPitch) < minimum)) {
    return spec.lidMagnetHoles
      ? `This bin is too narrow for four lid magnet supports. Increase its width and length to at least ${Math.ceil(minimum)} mm.`
      : `This bin is too narrow for the lid rim. Increase its width and length to at least ${Math.ceil(minimum)} mm.`;
  }
  return null;
}
