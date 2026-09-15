import { BASE_HEIGHT, HOLE_DISTANCE_FROM_BOTTOM_EDGE, LAYER_HEIGHT, SCREW_HOLE_RADIUS } from "./standard";
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

/** Preserve the standard 26 mm underside pattern with at least 0.8 mm edge material. */
export function baseMagnetSizeError(spec: MagnetSize & { screwHoles?: boolean }): string | null {
  if (magnetHoleRadiusMm(spec) > HOLE_DISTANCE_FROM_BOTTOM_EDGE - 0.8 + 1e-6) {
    return "Underside magnets must be 7.5 mm diameter or smaller to keep material around the standard mounting holes. Reduce magnet diameter or turn off base magnet holes.";
  }
  const bridgeHeight = (spec.screwHoles ? 2 : 3) * LAYER_HEIGHT;
  if (magnetHoleDepthMm(spec) + bridgeHeight > BASE_HEIGHT - 1 + 1e-6) {
    return "These magnets are too thick for the underside. Reduce magnet thickness to keep a closed roof above the holes.";
  }
  if (spec.screwHoles && (spec.magnetDiameterMm ?? DEFAULT_MAGNET_DIAMETER_MM) <= 2 * SCREW_HOLE_RADIUS) {
    return "Magnets must be wider than the 3 mm screw holes. Increase magnet diameter or turn off screw holes.";
  }
  return null;
}
