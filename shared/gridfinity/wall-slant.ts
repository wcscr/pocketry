import { BASE_HEIGHT, binHeightMm } from "./standard";
import type { BinSpec } from "./types";

/** The flat base is fixed. Every body cross-section above it moves at one slope. */
export function wallSlantOffsetMm(spec: Pick<BinSpec, "wallSlant">, zMm: number): { x: number; y: number } {
  const slant = spec.wallSlant;
  if (!slant) return { x: 0, y: 0 };
  const offset = (zMm - BASE_HEIGHT) * Math.tan(slant.angleDeg * Math.PI / 180);
  return slant.axis === "x" ? { x: offset, y: 0 } : { x: 0, y: offset };
}

export function wallSlantTopOffsetMm(spec: Pick<BinSpec, "wallSlant" | "heightUnits">): { x: number; y: number } {
  return wallSlantOffsetMm(spec, binHeightMm(spec.heightUnits));
}
