import { binHeightMm, binWallHeightMm, infillTopAllowanceMm } from "./standard";
import type { BinSpec } from "./types";

/** Older callers without a percentage retain the full-height surface. */
export type FillHeightSpec = Pick<BinSpec, "heightUnits" | "lip"> &
  Partial<Pick<BinSpec, "fillHeightPercent" | "magneticLid" | "magneticLidStyle" | "magneticLidTop" | "lidMagnetHoles" | "lidFit" | "lidInterface">>;

/** Solid fill above the fixed base; the walls and stacking lip keep their height. */
export function infillHeightMm(spec: FillHeightSpec): number {
  const lipAllowance = infillTopAllowanceMm(spec);
  const available = Math.max(0, binWallHeightMm(spec.heightUnits) - lipAllowance);
  return available * (spec.fillHeightPercent ?? 100) / 100;
}

/** Shared surface for mesh construction, pocket depths, finger access and validation. */
export function infillTopZ(spec: FillHeightSpec): number {
  const lipAllowance = infillTopAllowanceMm(spec);
  // Preserve the legacy support plane for very short bins with no infill space.
  const fullTop = binHeightMm(spec.heightUnits) - lipAllowance;
  const fullHeight = infillHeightMm({ ...spec, fillHeightPercent: 100 });
  return fullTop - (fullHeight - infillHeightMm(spec));
}
