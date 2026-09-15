import type { Outline } from "@shared/geometry/types";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";

import type { ExportScale } from "@/lib/export/scale";
import { autoPlaceFresh } from "@/lib/gridfinity/autoplace";
import { normalizeTracedShape } from "@/lib/gridfinity/traced-shape";

/** Reopens the exported contour at its calibrated size using the existing Bin editor. */
export function projectFromTrace(outline: Outline, scale: ExportScale, name: string, marginMm: number): ProjectDoc {
  const traced = normalizeTracedShape(outline, scale, name);
  if (!traced) throw new Error("Set the scale before exporting an editable Pocketry project.");
  const shape = { ...traced, traceMarginMm: marginMm };
  const placement = autoPlaceFresh([shape], "standard");
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: name.trim().slice(0, 80) || "Traced outline",
    shapes: [shape],
    spec: parseBinSpec({ gridX: placement.gridX, gridY: placement.gridY, heightUnits: 6, fill: "solid" }),
    cutouts: placement.cutouts,
    fingerHoles: [],
  };
}
