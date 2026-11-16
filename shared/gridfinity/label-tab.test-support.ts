import { ringBounds } from "../geometry/rings";
import { labelTabSurfaces } from "./label-tab-surfaces";
import { surfaceTextSchema } from "./surface-text";
import { parseBinSpec, type BinSpec } from "./types";

/** A small last-cell label can still physically fit on another shelf after grid reduction. */
export function labelledTabGrid(rows = 1, columns = 3, lip: BinSpec["lip"] = "none"): BinSpec {
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip,
    compartments: { rows, columns }, labelTab: { wall: "north", scope: "compartments", width: "full", recessMm: 0.5 } });
  const surface = labelTabSurfaces(spec).at(-1)!;
  const bounds = ringBounds(surface.ring)!;
  spec.surfaceTexts = [surfaceTextSchema.parse({ id: "last-cell", text: "C", sizeMm: 3, surface: "label-tab",
    position: { x: (bounds.minX + bounds.maxX) / 2 + 0.3, y: (bounds.minY + bounds.maxY) / 2 - 0.2 } })];
  return spec;
}
