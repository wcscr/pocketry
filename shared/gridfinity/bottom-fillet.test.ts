import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { effectiveBottomFilletRadiusMm } from "./bottom-fillet";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";

const spec = (extra: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 4, fill: "none", lip: "none", ...extra });

describe("hollow bottom fillet", () => {
  it("defaults off and rejects malformed radii", () => {
    expect(spec().bottomFilletRadiusMm).toBe(0);
    for (const bottomFilletRadiusMm of [-1, 50.01, NaN, Infinity]) {
      expect(() => spec({ bottomFilletRadiusMm })).toThrow();
    }
  });
  it("limits the effective profile without discarding the request", () => {
    const bin = spec({ bottomFilletRadiusMm: 50, compartments: { columns: 4 } });
    expect(effectiveBottomFilletRadiusMm(bin)).toBeCloseTo(9.75);
    expect(bin.bottomFilletRadiusMm).toBe(50);
    expect(effectiveBottomFilletRadiusMm({ ...bin, fill: "solid" })).toBe(0);
    expect(effectiveBottomFilletRadiusMm({ ...bin, heightUnits: 1 })).toBe(0);
    expect(effectiveBottomFilletRadiusMm({ ...bin, heightUnits: 1.5 })).toBe(3.5);
    expect(effectiveBottomFilletRadiusMm({ ...bin, compartments: { ...bin.compartments, enabled: false } })).toBe(21);
  });
  it.each([32, 51, 52])("migrates v%s projects and all history snapshots with rounding off", schemaVersion => {
    const { bottomFilletRadiusMm: _, ...legacy } = spec();
    const doc = { spec: legacy, cutouts: [], fingerHoles: [] };
    const input = { schemaVersion, shapes: [], ...doc, history: { index: 0, stack: [{ label: "Before", doc }] } };
    const migrated = parseProjectDoc(input)!;
    expect(migrated).not.toBeNull();
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.bottomFilletRadiusMm).toBe(0);
    expect(migrated.history!.stack[0].doc.spec.bottomFilletRadiusMm).toBe(0);
    expect(input.spec).not.toHaveProperty("bottomFilletRadiusMm");
  });
  it("round-trips radius, slant, scoops, disabled dividers and undo history", () => {
    const before = spec();
    const after = spec({ bottomFilletRadiusMm: 3.5, fill: "solid", wallSlant: { axis: "x", side: "positive", angleDeg: -25 },
      compartments: { enabled: false, rows: 3, columns: 4, scoop: true } });
    const doc = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], spec: after, cutouts: [], fingerHoles: [],
      history: { index: 1, stack: [before, after].map(spec => ({ label: "Fillet", doc: { spec, cutouts: [], fingerHoles: [] } })) } })!;
    expect(doc).not.toBeNull();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(doc))))).toEqual(doc);
  });
});
