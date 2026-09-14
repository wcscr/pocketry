import type { Point } from "../geometry/types";
import { BASE_HEIGHT, BASE_PROFILE_MAX_X, D_WALL, HOLE_DISTANCE_FROM_BOTTOM_EDGE, MAGNET_HOLE_DEPTH, MAGNET_HOLE_RADIUS, binFootprintMm, binHeightMm } from "./standard";
import type { BinSpec } from "./types";

/** Lid retention uses the same magnet recess dimensions as the base. */
export const LID_MAGNET_WALL_MM = 1.2;
export const LID_PAD_DEPTH_MM = MAGNET_HOLE_DEPTH + LID_MAGNET_WALL_MM;
/** Same inset as the outermost base magnets, independent of socket pitch. */
export const LID_MAGNET_INSET_MM = BASE_PROFILE_MAX_X + HOLE_DISTANCE_FROM_BOTTOM_EDGE;
export const LID_PAD_EXTENT_MM = LID_MAGNET_INSET_MM + MAGNET_HOLE_RADIUS + LID_MAGNET_WALL_MM;
export const LID_CLEARANCE_MM = 0.2;
export const LID_PREVIEW_LIFT_MM = 16;

/** Four paired recesses; no per-cell duplication in a large lid. */
export function lidMagnetCenters(spec: BinSpec): Point[] {
  const x = binFootprintMm(spec.gridX, spec.gridPitch) / 2 - LID_MAGNET_INSET_MM;
  const y = binFootprintMm(spec.gridY, spec.gridPitch) / 2 - LID_MAGNET_INSET_MM;
  return [{ x, y }, { x: -x, y }, { x: -x, y: -y }, { x, y: -y }];
}

/** Unbuildable combinations remain editable but must not produce an export. */
export function magneticLidError(spec: BinSpec): string | null {
  if (!spec.magneticLid) return null;
  if (spec.footprint.kind !== "rectangle") return "Magnetic lids currently need a rectangular footprint.";
  if (spec.lip !== "standard") return "Magnetic lids need the stacking lip for alignment.";
  if (binHeightMm(spec.heightUnits) < BASE_HEIGHT + LID_PAD_DEPTH_MM) return "Magnetic lids need a bin at least 2u tall.";
  const minimum = 2 * LID_PAD_EXTENT_MM + 2 * D_WALL;
  if ([spec.gridX, spec.gridY].some(count => binFootprintMm(count, spec.gridPitch) < minimum)) {
    return "This bin is too narrow for four lid magnet supports. Increase its width and length to at least 27 mm.";
  }
  return null;
}
