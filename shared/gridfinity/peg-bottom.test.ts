import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { defaultPocketFloorThicknessMm } from "./cutout";
import { changeBinGridPitchPreservingSize } from "./grid-pitch";
import { footprintOuterRingMm, signedDistanceToFootprintRing } from "./footprint";
import { DEFAULT_PEG_BOTTOM, ultim8PegCenters, pegBottomExtensionMm, pegBridgeSpanMm } from "./peg-bottom";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";

const bin = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, pegBottom: DEFAULT_PEG_BOTTOM, ...patch });

describe("ULTIM8 peg specification", () => {
  it("retains existing bases by default and validates fit settings", () => {
    expect(bin({ pegBottom: undefined }).pegBottom).toBeNull();
    expect(bin({ pegBottom: {} }).pegBottom).toEqual(DEFAULT_PEG_BOTTOM);
    expect(() => bin({ flatBottom: true })).toThrow(/either/);
    for (const pegBottom of [{ diameterMm: 5.1 }, { diameterMm: 3.9 }, { lengthMm: 1 }, { lengthMm: 6 }]) {
      expect(() => bin({ pegBottom })).toThrow();
    }
    expect(defaultPocketFloorThicknessMm(bin())).toBe(2);
    expect(pegBottomExtensionMm(bin({ pegBottom: null }))).toBe(0);
  });
  it("uses one staggered mat lattice and keeps full round pegs inside the footprint", () => {
    const spec = bin();
    const centers = ultim8PegCenters(spec);
    expect(centers.length).toBeGreaterThan(4);
    expect(centers).toContainEqual({ x: 0, y: 0 });
    expect(centers).toContainEqual({ x: 5, y: 5 });
    expect(centers).not.toContainEqual({ x: 0, y: 5 });
    const ring = footprintOuterRingMm(spec, 24);
    for (const point of centers) {
      expect(Math.abs(point.y % 5)).toBe(0);
      expect(Math.abs((point.x - Math.abs((point.y / 5) % 2) * 5) % 10)).toBe(0);
      expect(signedDistanceToFootprintRing(point, ring)).toBeGreaterThanOrEqual(spec.pegBottom!.diameterMm / 2);
    }
  });
  it.each(["half", "quarter"] as const)("preserves the peg lattice when converting a custom bin to %s pitch", pitch => {
    const original = bin({ footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    const converted = parseBinSpec({ ...original, ...changeBinGridPitchPreservingSize(original, pitch) });
    expect(ultim8PegCenters(converted)).toEqual(ultim8PegCenters(original));
  });
  it("sizes bridged roots for the actual footprint and fit diameter", () => {
    const small = bin({ gridX: 2, gridY: 2, gridPitch: "quarter", pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged" } });
    expect(pegBottomExtensionMm(small)).toBeCloseTo(7.8);
    expect(pegBottomExtensionMm(bin({ pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged" } }))).toBeCloseTo(9.8);
    expect(pegBottomExtensionMm(small)).toBeLessThan(pegBottomExtensionMm(bin()));
    expect(() => bin({ pegBottom: { underside: "invalid" } })).toThrow();
    expect(pegBridgeSpanMm(ultim8PegCenters(small))).toBe(10);
    expect(pegBridgeSpanMm([{ x: 0, y: 0 }])).toBe(0);
    expect(pegBridgeSpanMm([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBe(10);
    expect(pegBridgeSpanMm([{ x: 0, y: 0 }, { x: 20, y: 0 }])).toBe(20);
  });
  it.each([31, 32, 33, 34, 35])("migrates v%s projects and round-trips peg settings in saved history", version => {
    const spec = bin({ pegBottom: { diameterMm: 4.7, lengthMm: 3.5, underside: "bridged" } });
    const doc = { spec, cutouts: [], fingerHoles: [] };
    const project = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], ...doc,
      history: { stack: [{ doc, label: "Change bottom" }], index: 0 } })!;
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(project))))).toEqual(project);
    const legacy = JSON.parse(JSON.stringify(project));
    legacy.schemaVersion = version;
    const withPegs = parseProjectDoc(legacy)!;
    expect(withPegs).toEqual(project); // Includes the earlier version-32 peg prototype.
    delete legacy.spec.pegBottom;
    delete legacy.history.stack[0].doc.spec.pegBottom;
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.pegBottom).toBeNull();
    expect(migrated.history!.stack[0].doc.spec.pegBottom).toBeNull();
  });
});
