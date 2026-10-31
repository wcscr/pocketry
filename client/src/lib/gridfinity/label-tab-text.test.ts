import { describe, expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { labelTabSurfaces, pointOnLabelTab } from "@shared/gridfinity/label-tab-surfaces";
import { validateBinSpec } from "@shared/gridfinity/validate";
import { BASE_HEIGHT, binHeightMm } from "@shared/gridfinity/standard";
import { placeSurfaceTextOnTab, surfaceTextZ } from "./surface-text";

const label = surfaceTextSchema.parse({ id: "first", text: "M3", font: "helvetiker", position: { x: 0, y: 0 } });
const bin = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, lip: "none", fill: "none",
  wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8,
  compartments: { enabled: true, rows: 2, columns: 3, dividerThicknessMm: 1.2 },
  labelTab: { wall: "south", scope: "compartments", width: "full" } });

describe("label-tab text placement", () => {
  it("fills the six shifted shelves in order without changing earlier labels", () => {
    const spec = { ...bin, surfaceTexts: [...bin.surfaceTexts] };
    const surfaces = labelTabSurfaces(spec);
    expect(surfaces).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const next = placeSurfaceTextOnTab(spec, { ...label, id: String(i) });
      expect(next.surface).toBe("label-tab");
      expect(pointOnLabelTab(next.position, surfaces[i])).toBe(true);
      expect(surfaceTextZ(spec, next)).toBe(38.5);
      spec.surfaceTexts.push(next);
    }
    expect(new Set(spec.surfaceTexts.map(text => JSON.stringify(text.position))).size).toBe(6);
    const extra = { ...label, id: "extra" };
    expect(placeSurfaceTextOnTab(spec, extra)).toEqual(extra);
    expect(validateBinSpec(spec).issues.filter(issue => issue.severity === "error")).toEqual([]);
  });

  it.each(["north", "south", "east", "west"] as const)("places text along the %s boundary and scales a narrow label to fit", wall => {
    const spec = parseBinSpec({ ...bin, gridX: 2, gridY: 2, labelTab: { wall, width: "center", scope: "outer" } });
    const placed = placeSurfaceTextOnTab(spec, { ...label, text: "Text", sizeMm: 20 });
    expect(placed.surface).toBe("label-tab");
    expect(placed.sizeMm).toBeLessThan(20);
    expect(placed.rotationDeg).toBe(wall === "east" || wall === "west" ? 90 : 0);
    expect(pointOnLabelTab(placed.position, labelTabSurfaces(spec)[0])).toBe(true);
  });

  it("preserves legacy floor placement and round-trips explicit targets through saved history", () => {
    const legacy = { spec: { ...bin, surfaceTexts: [label] }, cutouts: [], fingerHoles: [] };
    const migrated = parseProjectDoc({ schemaVersion: 54, ...legacy, shapes: [] })!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.surfaceTexts).toEqual([label]);
    expect(surfaceTextZ(bin, label)).toBe(BASE_HEIGHT);
    const placed = placeSurfaceTextOnTab(bin, label);
    const current = { ...legacy, spec: { ...bin, surfaceTexts: [placed] } };
    const saved = { ...migrated, ...current, history: { index: 1, stack: [
      { doc: legacy, label: "Floor label" }, { doc: current, label: "Tab label" },
    ] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(surfaceTextZ(bin, { ...placed, surface: "bin" })).toBe(BASE_HEIGHT);
    expect(surfaceTextZ(bin, placed)).toBe(binHeightMm(bin.heightUnits));
  });

  it("does not offer shelf tops above a closed wedge or silently change a requested target", () => {
    const closed = parseBinSpec({ ...bin, wallSlant: { axis: "x", angleDeg: -80, side: "positive" } });
    expect(labelTabSurfaces(closed)).toEqual([]);
    const requested = { ...label, surface: "label-tab" as const };
    expect(placeSurfaceTextOnTab(closed, requested)).toEqual(requested);
    expect(labelTabSurfaces({ ...bin, labelTab: null })).toEqual([]);
  });
});
