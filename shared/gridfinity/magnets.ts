import { BASE_HEIGHT, CHAMFER_ADDITIONAL_RADIUS, HOLE_DISTANCE_FROM_BOTTOM_EDGE, LAYER_HEIGHT, SCREW_HOLE_RADIUS, baseBottomDimensionsMm } from "./standard";
import type { BinSpec } from "./types";

/** Actual magnet dimensions; allowances preserve the original 6.5 × 2.4 mm recess. */
export interface MagnetSize {
  magnetDiameterMm?: number;
  magnetThicknessMm?: number;
}

export const DEFAULT_MAGNET_DIAMETER_MM = 6;
export const DEFAULT_MAGNET_THICKNESS_MM = 2;
export const MAGNET_DIAMETER_ALLOWANCE_MM = 0.5;
export const MAGNET_DEPTH_ALLOWANCE_MM = 0.4;
export const MAGNET_CRUSH_INTERFERENCE_MM = 0.1;
export const BASE_MAGNET_MIN_WALL_MM = 0.8;
export const BASE_HOLE_OFFSET_MM = baseBottomDimensionsMm() / 2 - HOLE_DISTANCE_FROM_BOTTOM_EDGE;

type BaseMagnetSize = MagnetSize & { chamfer?: boolean };

export function magnetHoleRadiusMm(spec: MagnetSize): number {
  return ((spec.magnetDiameterMm ?? DEFAULT_MAGNET_DIAMETER_MM) + MAGNET_DIAMETER_ALLOWANCE_MM) / 2;
}

export function magnetHoleDepthMm(spec: MagnetSize): number {
  return (spec.magnetThicknessMm ?? DEFAULT_MAGNET_THICKNESS_MM) + MAGNET_DEPTH_ALLOWANCE_MM;
}

/** Keep the same 0.1 mm diametral interference at the eight crush-rib tips. */
export function magnetCrushRadiusMm(spec: MagnetSize): number {
  return ((spec.magnetDiameterMm ?? DEFAULT_MAGNET_DIAMETER_MM) - MAGNET_CRUSH_INTERFERENCE_MM) / 2;
}

export function hasBaseMagnets(spec: Pick<BinSpec, "flatBottom" | "gridPitch" | "magnetHoles">): boolean {
  return !spec.flatBottom && spec.gridPitch === "full" && spec.magnetHoles;
}

export function hasMagnets(spec: Pick<BinSpec, "flatBottom" | "gridPitch" | "magnetHoles" | "magneticLid" | "lidMagnetHoles">): boolean {
  return hasBaseMagnets(spec) || (spec.magneticLid && spec.lidMagnetHoles);
}

/** Move each magnet toward its cell center only when its opening needs more room. */
export function baseMagnetShiftMm(spec: BaseMagnetSize): number {
  const radius = magnetHoleRadiusMm(spec) + (spec.chamfer ? CHAMFER_ADDITIONAL_RADIUS : 0);
  return Math.max(0, radius + BASE_MAGNET_MIN_WALL_MM - HOLE_DISTANCE_FROM_BOTTOM_EDGE);
}

/** Protect pocket spacing and the closed roof after moving large magnets inward. */
export function baseMagnetSizeError(spec: BaseMagnetSize & { screwHoles?: boolean }): string | null {
  const shift = baseMagnetShiftMm(spec);
  const radius = magnetHoleRadiusMm(spec) + (spec.chamfer ? CHAMFER_ADDITIONAL_RADIUS : 0);
  if (2 * (BASE_HOLE_OFFSET_MM - shift - radius) < BASE_MAGNET_MIN_WALL_MM - 1e-6) {
    return "These magnets are too wide to keep material between the four underside holes. Reduce magnet diameter.";
  }
  // Offset magnet/screw openings have independent printable ceilings.
  const bridgeHeight = (spec.screwHoles && shift === 0 ? 2 : 3) * LAYER_HEIGHT;
  if (magnetHoleDepthMm(spec) + bridgeHeight > BASE_HEIGHT - 1 + 1e-6) {
    return "These magnets are too thick for the underside. Reduce magnet thickness to keep a closed roof above the holes.";
  }
  if (spec.screwHoles && (spec.magnetDiameterMm ?? DEFAULT_MAGNET_DIAMETER_MM) <= 2 * SCREW_HOLE_RADIUS) {
    return "Magnets must be wider than the 3 mm screw holes. Increase magnet diameter or turn off screw holes.";
  }
  return null;
}
