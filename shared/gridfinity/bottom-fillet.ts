import { compartmentHeightMm, compartmentLayout } from "./compartments";
import type { BinSpec } from "./types";

/** Fit the upright profile without changing the user's saved radius. Slants
 * deform this profile along with the walls, dividers and scoops. */
export function effectiveBottomFilletRadiusMm(spec: BinSpec): number {
  if (spec.fill !== "none") return 0;
  const { cellWidth, cellLength } = compartmentLayout(spec);
  return Math.max(0, Math.min(spec.bottomFilletRadiusMm, compartmentHeightMm(spec),
    cellWidth / 2, cellLength / 2));
}
