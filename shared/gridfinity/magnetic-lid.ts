import type { Point } from "../geometry/types";
import { LID_OVERLAP_DEPTH_MM } from "./standard";
import { BASE_HEIGHT, BASE_TOP_RADIUS, BASE_PROFILE_MAX_X, BASE_PROFILE_HEIGHT, STACKING_LIP_HEIGHT_ACTUAL, binWallThicknessMm, HOLE_DISTANCE_FROM_BOTTOM_EDGE, MAGNET_HOLE_DEPTH, binFootprintMm, binHeightMm } from "./standard";
import { magnetHoleRadiusMm, magnetHoleDepthMm, type MagnetSize } from "./magnets";
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
export const LID_OVERLAP_MM = LID_OVERLAP_DEPTH_MM;
export const LID_SHOULDER_GAP_MM = 0.2;
export const LID_CAP_THICKNESS_MM = LID_PAD_DEPTH_MM;
/** Close the visible inset seam without lowering the magnet mating face. */
export const INSET_LID_CAP_BOTTOM_MM = STACKING_LIP_HEIGHT_ACTUAL + LID_SHOULDER_GAP_MM;
/** Exposes about 3.2 mm above the stacking lip for a finger grip. */
export const INSET_LID_TOP_MM = BASE_PROFILE_HEIGHT + 2;
/** Preload stays positive across the ±0.1 mm grip range; requires a physical fit test. */
export const LID_FRICTION_INTERFERENCE_MM = 0.15;

type InterfaceSpec = Partial<Pick<BinSpec, "magneticLid" | "lidMagnetHoles" | "lidFit" | "lidInterface">>;
type WallSpec = Pick<BinSpec, "wallThicknessMm" | "lidWallThicknessMm"> & InterfaceSpec;
/** Room for a spring, its travel gap, and a protective backing wall. */
export const COMPLIANT_LID_BAND_MM = 3.4;

export function usesCompliantInterface(spec: InterfaceSpec): boolean {
  return spec.magneticLid === true && spec.lidMagnetHoles === false && spec.lidFit === "friction"
    && spec.lidInterface !== undefined && spec.lidInterface !== "ribs";
}

export function hasSpringLatch(spec: InterfaceSpec): boolean {
  return usesCompliantInterface(spec) && spec.lidInterface === "spring-latch";
}

export function hasSideSprings(spec: InterfaceSpec): boolean {
  return usesCompliantInterface(spec) && spec.lidInterface === "side-springs";
}

export function overlapLidWallMm(spec: WallSpec): number {
  const wall = spec.lidWallThicknessMm ?? binWallThicknessMm(spec);
  return usesCompliantInterface(spec) ? Math.max(wall, COMPLIANT_LID_BAND_MM) : wall;
}

/** Preserve old printed pairs until the shared control is explicitly edited. */
export function overlapRimWallMm(spec: WallSpec): number {
  return spec.lidWallThicknessMm === undefined ? binWallThicknessMm(spec) : LID_RIM_WALL_MM;
}

/** Keep the original outer footprint and a separate mating clearance. */
export function overlapLidRimInsetMm(spec: WallSpec): number {
  return overlapLidWallMm(spec) + LID_SKIRT_CLEARANCE_MM;
}

/** Give the recessed rim its own rounded profile, retaining legacy printed pairs. */
export function overlapRimCornerRadiusMm(spec: WallSpec): number {
  return spec.lidWallThicknessMm === undefined ? BASE_TOP_RADIUS
    : Math.max(0, BASE_TOP_RADIUS - overlapLidRimInsetMm(spec));
}

/** Positive inside the rounded cavity; layout cutters must clear its corners too. */
export function overlapRimInteriorClearanceMm(point: Point, spec: BinSpec): number {
  const inset = overlapLidRimInsetMm(spec) + overlapRimWallMm(spec);
  const radius = spec.lidWallThicknessMm === undefined ? BASE_TOP_RADIUS : Math.max(0, BASE_TOP_RADIUS - inset);
  const halfW = binFootprintMm(spec.gridX, spec.gridPitch) / 2 - inset;
  const halfL = binFootprintMm(spec.gridY, spec.gridPitch) / 2 - inset;
  const ax = Math.abs(point.x), ay = Math.abs(point.y);
  if (ax > halfW - radius && ay > halfL - radius) {
    return radius - Math.hypot(ax - (halfW - radius), ay - (halfL - radius));
  }
  return Math.min(halfW - ax, halfL - ay);
}

/** Thick stepped rims need the paired magnets farther from the outer edge. */
export function lidMagnetInsetMm(spec: BinSpec): number {
  const edgeInset = hasOverlappingLid(spec) ? overlapLidRimInsetMm(spec) : BASE_PROFILE_MAX_X + LID_CLEARANCE_MM;
  const margin = lidHoleRadiusMm(spec) + LID_MAGNET_WALL_MM;
  const radius = hasOverlappingLid(spec) ? overlapRimCornerRadiusMm(spec) : 0;
  // Small bores near a rounded corner also need the diagonal wall allowance.
  const cornerMargin = radius - (radius - margin) / Math.SQRT2;
  return Math.max(LID_MAGNET_INSET_MM, edgeInset + Math.max(margin, cornerMargin));
}

type LidMagnetSize = MagnetSize & { lidMagnetHoles?: boolean };

/** Dormant magnet preferences must not change nonmagnetic lids. */
function lidHoleRadiusMm(spec: LidMagnetSize): number {
  return magnetHoleRadiusMm(spec.lidMagnetHoles === false ? {} : spec);
}

export function lidPadDepthMm(spec: LidMagnetSize): number {
  return magnetHoleDepthMm(spec.lidMagnetHoles === false ? {} : spec) + LID_MAGNET_WALL_MM;
}

export function lidPadExtentMm(spec: BinSpec): number {
  return lidMagnetInsetMm(spec) + lidHoleRadiusMm(spec) + LID_MAGNET_WALL_MM;
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
export function lidCapTopMm(spec: Pick<BinSpec, "magneticLidStyle" | "magneticLidTop"> & LidMagnetSize): number {
  const original = spec.magneticLidStyle === "overlap"
    ? (spec.magneticLidTop === "stacking" ? 4 : LID_CAP_THICKNESS_MM)
    : (spec.magneticLidTop === "stacking" ? 8 : INSET_LID_TOP_MM);
  return Math.max(original, lidPadDepthMm(spec));
}

export function lidTopMm(spec: Pick<BinSpec, "magneticLidStyle" | "magneticLidTop"> & LidMagnetSize): number {
  return lidCapTopMm(spec) + (spec.magneticLidTop === "stacking" ? STACKING_LIP_HEIGHT_ACTUAL : 0);
}

export function lidBottomMm(spec: Pick<BinSpec, "magneticLidStyle"> & InterfaceSpec): number {
  // Side springs and their filled locator share one build plane, without
  // moving the cap, contact bumps, or closed-lid seating datum.
  return spec.magneticLidStyle === "overlap" ? -LID_OVERLAP_MM + LID_SHOULDER_GAP_MM
    : hasSideSprings(spec) ? 0.85 : 0;
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
  if (binHeightMm(spec.heightUnits) < Math.max(14, BASE_HEIGHT + lidPadDepthMm(spec))) return "Magnetic lids need a bin at least 2u tall.";
  if (usesCompliantInterface(spec)) {
    if ([spec.gridX, spec.gridY].some(count => binFootprintMm(count, spec.gridPitch) < 36)) {
      return "This lid interface needs a bin at least 36 mm wide and long to leave room for the springs and corners.";
    }
    if (hasSpringLatch(spec) && hasOverlappingLid(spec)) {
      return "Spring latches are only available for inset lids. Choose Inset or another lid interface.";
    }
  }
  const minimum = 2 * lidPadExtentMm(spec) + 2 * binWallThicknessMm(spec);
  if ([spec.gridX, spec.gridY].some(count => binFootprintMm(count, spec.gridPitch) < minimum)) {
    return spec.lidMagnetHoles
      ? `This bin is too narrow for four lid magnet supports. Increase its width and length to at least ${Math.ceil(minimum)} mm.`
      : `This bin is too narrow for the lid rim. Increase its width and length to at least ${Math.ceil(minimum)} mm.`;
  }
  return null;
}
