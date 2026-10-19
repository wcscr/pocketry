import { binFootprintMm, binHeightMm, gridPitchMm, type GridPitch } from "./standard";
import type { BinSpec } from "./types";

export interface BinSizeSpec {
  gridX: number;
  gridY: number;
  gridPitch?: GridPitch;
  arbitrarySizeMm?: { width: number; length: number } | null;
}

/** Actual outer size, without the Gridfinity gap being applied to explicit mm sizes. */
export function binWidthMm(spec: BinSizeSpec): number {
  return spec.arbitrarySizeMm?.width ?? binFootprintMm(spec.gridX, spec.gridPitch);
}
export function binLengthMm(spec: BinSizeSpec): number {
  return spec.arbitrarySizeMm?.length ?? binFootprintMm(spec.gridY, spec.gridPitch);
}

/** Enter mm mode without moving pockets or changing the body. Grid choices are retained. */
export function arbitrarySizePatch(spec: BinSpec): Partial<BinSpec> | null {
  if (spec.footprint.kind !== "rectangle") return null;
  return { arbitrarySizeMm: { width: binWidthMm(spec), length: binLengthMm(spec) },
    flatBottom: !spec.pegBottom, magnetHoles: false, magnetCrushRibs: false, screwHoles: false };
}

/** Return to a grid only when all dimensions are exactly representable; never silently snap. */
export function gridSizeFromArbitrary(spec: BinSpec, gridPitch: GridPitch): Pick<BinSpec, "gridX" | "gridY" | "gridPitch" | "arbitrarySizeMm"> | null {
  const pitch = gridPitchMm(gridPitch);
  const x = (binWidthMm(spec) + 0.5) / pitch, y = (binLengthMm(spec) + 0.5) / pitch;
  const gridX = Math.round(x), gridY = Math.round(y);
  if (Math.abs(x - gridX) > 1e-7 || Math.abs(y - gridY) > 1e-7 || Math.abs(binHeightMm(spec.heightUnits) / 3.5 - Math.round(binHeightMm(spec.heightUnits) / 3.5)) > 1e-7) return null;
  return { gridX, gridY, gridPitch, arbitrarySizeMm: null };
}
