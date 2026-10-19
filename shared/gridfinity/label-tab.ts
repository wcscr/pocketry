import type { BinSpec } from "./types";
import {
  TAB_DEPTH_MM,
  TAB_HEIGHT_MM,
  TAB_PROFILE,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_SUPPORT_HEIGHT_MM,
  binWallHeightMm,
} from "./standard";

/** Keep a slanted tab's 36-degree underside above the fixed Gridfinity base. */
export function labelTabProfileMm(spec: Pick<BinSpec, "heightUnits" | "wallSlant">): {
  depthMm: number;
  heightMm: number;
  points: [number, number][];
} | null {
  const availableHeightMm = binWallHeightMm(spec.heightUnits);
  if (!spec.wallSlant || availableHeightMm >= TAB_HEIGHT_MM) {
    return { depthMm: TAB_DEPTH_MM, heightMm: TAB_HEIGHT_MM,
      points: TAB_PROFILE.map(([depth, height]) => [depth, height]) };
  }
  if (availableHeightMm <= TAB_SUPPORT_HEIGHT_MM) return null;
  const slope = Math.tan(TAB_SUPPORT_ANGLE_DEG * Math.PI / 180);
  const depthMm = (availableHeightMm - TAB_SUPPORT_HEIGHT_MM) / slope;
  const heightMm = availableHeightMm;
  return {
    depthMm,
    heightMm,
    points: [
      [0, 0],
      [0, heightMm],
      [depthMm, heightMm],
      [depthMm, heightMm - TAB_SUPPORT_HEIGHT_MM],
    ],
  };
}
