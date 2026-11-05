import { parseBinSpec, type BinSpec } from "@shared/gridfinity/types";
import { labelTabSurfaces } from "@shared/gridfinity/label-tab-surfaces";
import { surfaceTextSchema, type SurfaceText } from "@shared/gridfinity/surface-text";
import { placeSurfaceTextOnTab } from "./surface-text";

export const TAB_WALLS = ["north", "south", "east", "west"] as const;
export type TabWall = typeof TAB_WALLS[number];
export const TAB_SCOPES = ["compartments", "outer"] as const;

/** Add text's default label. */
export const NEW_LABEL = surfaceTextSchema.parse({ id: "text", text: "Text", font: "helvetiker", position: { x: 0, y: 0 } });

/**
 * A 2×2×6u hollow bin with Construction's default tab on one wall. Sub-bin
 * shelves come four to a row along the tab, so each row has two outer and two
 * inner shelves; a boundary shelf spans the full wall.
 */
export function tabBin(lip: BinSpec["lip"], wall: TabWall, scope: typeof TAB_SCOPES[number]): BinSpec {
  const along = wall === "north" || wall === "south" ? { rows: 2, columns: 4 } : { rows: 4, columns: 2 };
  return parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip,
    compartments: { enabled: scope === "compartments", ...(scope === "compartments" ? along : { rows: 1, columns: 1 }) },
    labelTab: { wall, scope, width: "full", recessMm: 0.5, frontRim: true } });
}

/** Add one new label per shelf, in order, as repeated Add text does. */
export function fillLabelTabs(spec: BinSpec, label: Partial<SurfaceText> = {}): BinSpec {
  const filled = { ...spec, surfaceTexts: [...spec.surfaceTexts] };
  for (let i = 0; i < labelTabSurfaces(spec).length; i++) {
    filled.surfaceTexts.push(placeSurfaceTextOnTab(filled, { ...NEW_LABEL, ...label, id: `label-${i}` }));
  }
  return filled;
}
