import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";
import { validateBinSpec } from "./validate";
import { compartmentLabelTabPlacements, compartmentLayout, compartmentsEnabled, dividerStripRings } from "./compartments";

const spec = (extra: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", ...extra });

describe("compartment settings", () => {
  it("defaults to an unchanged hollow bin and rejects malformed settings", () => {
    expect(spec().compartments).toEqual({ rows: 1, columns: 1, dividerThicknessMm: 1.2, scoop: false });
    expect(dividerStripRings(spec())).toEqual([]);
    for (const rows of [0, -1, 1.5, 33, NaN, Infinity]) expect(() => spec({ compartments: { rows } })).toThrow();
    for (const dividerThicknessMm of [0, 0.94, 3.01, NaN, Infinity]) expect(() => spec({ compartments: { dividerThicknessMm } })).toThrow();
  });
  it("spaces equal clear compartments inside the outer walls", () => {
    const bin = spec({ compartments: { rows: 3, columns: 2 } });
    const layout = compartmentLayout(bin);
    expect(layout.cellWidth).toBeCloseTo((83.5 - 1.9 - 1.2) / 2);
    expect(layout.cellLength).toBeCloseTo((125.5 - 1.9 - 2.4) / 3);
    expect(layout.columnCenters).toHaveLength(1);
    expect(layout.columnCenters[0]).toBeCloseTo(0);
    expect(layout.rowCenters[0]).toBeCloseTo(-layout.rowCenters[1]);
    expect(dividerStripRings(bin)).toHaveLength(3);
  });
  it("blocks impossible geometry without losing stored settings", () => {
    const bin = spec({ gridX: 1, gridY: 1, gridPitch: "quarter", compartments: { rows: 12, scoop: true } });
    expect(validateBinSpec(bin).issues).toContainEqual(expect.objectContaining({ code: "invalid-compartments", severity: "error" }));
    expect(validateBinSpec({ ...bin, fill: "solid" }).issues.some(i => i.code === "invalid-compartments")).toBe(false);
    expect(validateBinSpec(spec({ heightUnits: 1, compartments: { scoop: true } })).ok).toBe(false);
  });
  it.each([32, 48, 49, 50, 51])("migrates v%s projects and history without adding walls", schemaVersion => {
    const { compartments: _, ...oldSpec } = spec();
    const doc = { spec: oldSpec, cutouts: [], fingerHoles: [] };
    const migrated = parseProjectDoc({ schemaVersion, shapes: [], ...doc, history: { index: 0, stack: [{ label: "Before", doc }] } })!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.compartments).toEqual(spec().compartments);
    expect(migrated.history!.stack[0].doc.spec.compartments).toEqual(spec().compartments);
  });
  it("round-trips counts, scoop, thickness, slant and history", () => {
    const before = spec();
    const after = spec({ lip: "none", compartments: { rows: 3, columns: 4, dividerThicknessMm: 2, scoop: true }, wallSlant: { axis: "y", angleDeg: 25, side: "positive" } });
    const doc = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], spec: after, cutouts: [], fingerHoles: [],
      history: { index: 1, stack: [before, after].map(spec => ({ label: "Change compartments", doc: { spec, cutouts: [], fingerHoles: [] } })) } })!;
    expect(doc).not.toBeNull();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(doc))))).toEqual(doc);
  });
});

it.each([
  ["x", 20, "right"], ["x", -20, "left"], ["y", 20, "back"], ["y", -20, "front"],
] as const)("faces scoops toward the obtuse angle for %s at %s degrees", (axis, angleDeg, wall) => {
  for (const side of ["both", "negative", "positive"] as const) {
    const bin = spec({ wallSlant: { axis, angleDeg, side }, compartments: { rows: 2, columns: 3, scoop: true } });
    const layout = compartmentLayout(bin);
    expect(layout.scoopWall).toBe(wall);
    expect(layout.scoopWalls).toHaveLength(axis === "x" ? 3 : 2);
  }
});

it("retains per-sub-bin tab scope and caps shelves to preserve openings", () => {
  const bin = spec({ compartments: { rows: 3, columns: 4 }, labelTab: { wall: "north", width: "full", scope: "compartments" } });
  const tabs = compartmentLabelTabPlacements(bin);
  expect(tabs).toHaveLength(12);
  expect(tabs.every(tab => tab.depth <= compartmentLayout(bin).cellLength / 2)).toBe(true);
  expect(compartmentLabelTabPlacements({ ...bin, fill: "solid" })).toEqual([]);
  const doc = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], spec: bin, cutouts: [], fingerHoles: [] })!;
  expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(doc))))!.spec.labelTab!.scope).toBe("compartments");
});


it("retains disabled grids through project reload without grouping scoops or tabs", () => {
  const bin = spec({ compartments: { enabled: false, rows: 3, columns: 4, dividerThicknessMm: 2, scoop: true },
    labelTab: { wall: "north", width: "full", scope: "compartments" } });
  expect(compartmentsEnabled(spec())).toBe(false);
  expect(compartmentsEnabled(spec({ compartments: { rows: 2 } }))).toBe(true);
  expect(compartmentsEnabled(bin)).toBe(false);
  expect(dividerStripRings(bin)).toEqual([]);
  expect(compartmentLayout(bin).scoopWalls).toHaveLength(1);
  expect(compartmentLabelTabPlacements(bin)).toHaveLength(1);
  const doc = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], spec: bin, cutouts: [], fingerHoles: [] })!;
  const reloaded = parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(doc))))!.spec;
  expect(reloaded.compartments).toEqual(bin.compartments);
  const enabled = { ...reloaded, compartments: { ...reloaded.compartments, enabled: true } };
  expect(dividerStripRings(enabled)).toHaveLength(5);
  expect(compartmentLayout(enabled).scoopWalls).toHaveLength(3);
  expect(compartmentLabelTabPlacements(enabled)).toHaveLength(12);
});

it("ignores disabled divider spacing while validating independent scoop bottoms", () => {
  const bin = spec({ gridX: 1, gridY: 1, compartments: { enabled: false, rows: 32, columns: 32, scoop: true } });
  expect(validateBinSpec(bin).issues.some(issue => issue.code === "invalid-compartments")).toBe(false);
  expect(validateBinSpec({ ...bin, compartments: { ...bin.compartments, enabled: true } }).ok).toBe(false);
});
