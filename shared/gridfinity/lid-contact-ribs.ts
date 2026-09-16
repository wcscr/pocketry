import type { BinSpec } from "./types";
import { BASE_TOP_RADIUS, binFootprintMm } from "./standard";

export const DEFAULT_LID_RIB_SPACING_MM = 24;
export const MIN_LID_RIB_SPACING_MM = 8;
export const MAX_LID_RIB_SPACING_MM = 60;

/** Target spacing controls count; evenly distribute ribs clear of stiff corners.
 * The default reproduces the original contact-rib positions exactly.
 */
export function lidContactRibPositions(spec: Pick<BinSpec, "gridX" | "gridY" | "gridPitch" | "lidRibSpacingMm">,
  axis: "x" | "y"): number[] {
  const span = binFootprintMm(axis === "x" ? spec.gridX : spec.gridY, spec.gridPitch) - 2 * BASE_TOP_RADIUS;
  const usable = Math.max(0, span - 16);
  const count = Math.max(1, Math.ceil(usable / spec.lidRibSpacingMm));
  return Array.from({ length: count }, (_, index) => count === 1 ? 0 : usable * (index / (count - 1) - 0.5));
}
