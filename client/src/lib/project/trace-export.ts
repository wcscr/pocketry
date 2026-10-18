import type { Outline } from "@shared/geometry/types";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";

import type { ExportScale } from "@/lib/export/scale";
import { autoPlaceFresh } from "@/lib/gridfinity/autoplace";
import { traceObjects } from "@/lib/gridfinity/trace-objects";
import { normalizeTracedShapeWithPlacement } from "@/lib/gridfinity/traced-shape";

/** Reopens the exported contour at its calibrated size using the existing Bin editor. */
export function projectFromTrace(outline: Outline, scale: ExportScale, name: string, marginMm: number): ProjectDoc {
  const entries = traceObjects(outline, false).map((part, index) => {
    const traced = normalizeTracedShapeWithPlacement(part.outline, scale, part.role ? `Hole ${index}` : name);
    if (!traced) throw new Error("Set the scale before exporting an editable Pocketry project.");
    return { ...traced, role: part.role, shape: { ...traced.shape, traceMarginMm: marginMm } };
  });
  const shapes = entries.map(entry => entry.shape);
  const positions = Object.fromEntries(entries.map(entry => [entry.shape.id, { batchId: shapes[0].id, center: entry.center }]));
  const roles = new Map(entries.map(entry => [entry.shape.id, entry.role]));
  const placement = autoPlaceFresh(shapes, "standard", "full", positions);
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: name.trim().slice(0, 80) || "Traced outline",
    shapes,
    spec: parseBinSpec({ gridX: placement.gridX, gridY: placement.gridY, heightUnits: 6, fill: "solid" }),
    cutouts: placement.cutouts.map(cutout => roles.get(cutout.shapeId) === "hole" ? { ...cutout, role: "hole",
      depth: { mode: "through" }, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 } : cutout),
    fingerHoles: [],
  };
}
