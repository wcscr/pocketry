import { describe, expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { labelTabSurfaces, pointOnLabelTab } from "@shared/gridfinity/label-tab-surfaces";
import { validateBinSpec } from "@shared/gridfinity/validate";
import { binHeightMm } from "@shared/gridfinity/standard";
import { withKernel } from "@/lib/manifold/runtime";
import { buildSurfaceTexts, placeSurfaceTextOnTab, surfaceTextZ } from "./surface-text";

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
    expect(placeSurfaceTextOnTab(spec, extra)).toEqual({ ...extra, surface: "label-tab" });
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

  it.each([54, 55])("retargets version %i hollow labels and history without changing their design", schemaVersion => {
    const legacy = { spec: { ...bin, surfaceTexts: [label] }, cutouts: [], fingerHoles: [] };
    const explicit = { ...legacy, spec: { ...bin, surfaceTexts: [{ ...label, surface: "bin" as const }] } };
    const migrated = parseProjectDoc({ schemaVersion, ...explicit, shapes: [], history: { index: 1, stack: [
      { doc: legacy, label: "Add text" }, { doc: explicit, label: "Choose surface" },
    ] } })!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.surfaceTexts).toEqual([{ ...label, surface: "label-tab" }]);
    for (const entry of migrated.history!.stack) expect(entry.doc.spec.surfaceTexts).toEqual(migrated.spec.surfaceTexts);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(surfaceTextZ(bin, label)).toBe(binHeightMm(bin.heightUnits));
    expect(surfaceTextZ(bin, { ...label, surface: "bin" })).toBe(binHeightMm(bin.heightUnits));
  });

  it("keeps solid-fill targets and uses label tabs even when no shelf fits a new hollow-bin label", () => {
    for (const surface of [undefined, "bin", "label-tab"] as const) {
      const original = { ...label, surface };
      expect(parseBinSpec({ ...bin, fill: "solid", surfaceTexts: [original] }).surfaceTexts).toEqual([original]);
    }
    expect(placeSurfaceTextOnTab({ ...bin, labelTab: null }, label)).toEqual({ ...label, surface: "label-tab" });
    expect(placeSurfaceTextOnTab(bin, { ...label, text: "M".repeat(120) })).toEqual({ ...label, text: "M".repeat(120), surface: "label-tab" });
  });

  it("does not offer shelf tops above a closed wedge or silently change a requested target", () => {
    const closed = parseBinSpec({ ...bin, wallSlant: { axis: "x", angleDeg: -80, side: "positive" } });
    expect(labelTabSurfaces(closed)).toEqual([]);
    const requested = { ...label, surface: "label-tab" as const };
    expect(placeSurfaceTextOnTab(closed, requested)).toEqual(requested);
    expect(labelTabSurfaces({ ...bin, labelTab: null })).toEqual([]);
  });

  it("explains when an enabled tab's front rim consumes its writing surface without moving text", async () => {
    const requested = { ...label, surface: "label-tab" as const, position: { x: -12.75, y: 27.06 }, rotationDeg: -15 };
    const spec = parseBinSpec({ ...bin, wallSlant: null, wallThicknessMm: 1.6, surfaceTexts: [requested],
      labelTab: { wall: "south", scope: "compartments", depthMm: 1, widthMm: 10, width: "center", recessMm: 0.5, frontRim: true } });
    expect(labelTabSurfaces(spec)).toEqual([]);
    expect(labelTabSurfaces({ ...spec, labelTab: { ...spec.labelTab!, frontRim: false } }).length).toBeGreaterThan(0);
    await withKernel(kernel => {
      const body = kernel.arena.track(kernel.Manifold.cube([1, 1, 1]));
      expect(() => buildSurfaceTexts(kernel, spec, body)).toThrow("Increase Tab depth or turn off Front rim");
    });
    expect(spec.surfaceTexts).toEqual([requested]);
  });

  it("distinguishes a missing tab from an enabled shelf that cannot fit above the floor", async () => {
    const requested = { ...label, surface: "label-tab" as const };
    const absent = parseBinSpec({ ...bin, labelTab: null, surfaceTexts: [requested] });
    const tooLow = parseBinSpec({ ...absent, heightUnits: 2, wallSlant: null,
      labelTab: { wall: "south", width: "full", depthMm: 5, recessMm: 6, frontRim: false } });
    expect(labelTabSurfaces(tooLow)).toEqual([]);
    await withKernel(kernel => {
      const body = kernel.arena.track(kernel.Manifold.cube([1, 1, 1]));
      expect(() => buildSurfaceTexts(kernel, absent, body)).toThrow("Enable label tabs in Construction");
      expect(() => buildSurfaceTexts(kernel, tooLow, body)).toThrow("Reduce Recess, increase bin height, or choose another label-tab placement");
    });
    expect(absent.surfaceTexts).toEqual([requested]);
    expect(tooLow.surfaceTexts).toEqual([requested]);
  });
});
