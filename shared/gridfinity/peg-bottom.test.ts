import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { defaultPocketFloorThicknessMm } from "./cutout";
import { changeBinGridPitchPreservingSize } from "./grid-pitch";
import { footprintOuterRingMm, signedDistanceToFootprintRing } from "./footprint";
import { DEFAULT_PEG_BOTTOM, ultim8PegCenters, pegBottomExtensionMm, pegBridgeSpanMm, selectUltim8PegCenters } from "./peg-bottom";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";

const bin = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, pegBottom: DEFAULT_PEG_BOTTOM, ...patch });

describe("ULTIM8 peg specification", () => {
  it("retains existing bases by default and validates fit settings", () => {
    expect(bin({ pegBottom: undefined }).pegBottom).toBeNull();
    expect(bin().pegBottom).toEqual({ diameterMm: 4.8, lengthMm: 4, underside: "flat", density: "corners" });
    expect(selectUltim8PegCenters(bin(), ultim8PegCenters(bin()))).toHaveLength(4);
    expect(pegBottomExtensionMm(bin())).toBe(4);
    expect(bin({ pegBottom: {} }).pegBottom).toEqual({ ...DEFAULT_PEG_BOTTOM, underside: "sloped", density: 1 });
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
    const small = bin({ gridX: 2, gridY: 2, gridPitch: "quarter", pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged", density: 1 } });
    expect(pegBottomExtensionMm(small)).toBeCloseTo(7.8);
    expect(pegBottomExtensionMm(bin({ pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged", density: 1 } }))).toBeCloseTo(9.8);
    expect(pegBottomExtensionMm(small)).toBeLessThan(pegBottomExtensionMm(bin({ pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "sloped", density: 1 } })));
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

it.each(["corners", 1, 2, 3, 4, 5] as const)("selects sparse %s pegs from fitting holes without raising the backing", density => {
  const spec = bin({ gridX: 16, gridY: 3, gridPitch: "quarter", pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "flat", lengthMm: 3.5, density } });
  const full = ultim8PegCenters(spec), selected = selectUltim8PegCenters(spec, full);
  expect(pegBottomExtensionMm(spec)).toBe(3.5);
  if (density === "corners") expect(selected).toHaveLength(4);
  else if (density === 1) expect(selected).toEqual(full);
  else {
    expect(selected.length).toBeLessThan(full.length);
    const anchors = selectUltim8PegCenters(bin({ ...spec, pegBottom: { ...spec.pegBottom!, density: "corners" } }), full);
    for (const point of selected.filter(p => !anchors.includes(p))) {
      for (const other of selected.filter(p => p !== point)) {
        expect(Math.max(Math.abs(point.x - other.x) / 10, Math.abs(point.y - other.y) / 5)).toBeGreaterThanOrEqual(density);
      }
    }
    for (const point of full) {
      expect(Math.min(...selected.map(peg => Math.max(Math.abs(point.x - peg.x) / 10, Math.abs(point.y - peg.y) / 5)))).toBeLessThan(density);
    }
  }
  const omitted = selected[0];
  const available = full.filter(p => p !== omitted);
  const replacement = selectUltim8PegCenters(spec, available);
  expect(replacement).not.toContain(omitted);
  if (density === "corners") expect(replacement).toHaveLength(4);
});

it("adds edge pegs when increasing density around a large through opening", () => {
  const spec = bin({ arbitrarySizeMm: { width: 100, length: 100 } });
  const available = ultim8PegCenters(spec).filter(point => Math.abs(point.x) > 42.4 || Math.abs(point.y) > 42.4);
  const selections = [5, 4, 3, 2, 1].map(density => selectUltim8PegCenters(
    bin({ ...spec, pegBottom: { ...spec.pegBottom!, density } }), available));
  expect(selections.map(pegs => pegs.length)).toEqual([6, 12, 12, 26, 36]);
  for (let i = 1; i < selections.length; i++) {
    for (const point of selections[i - 1]) expect(selections[i]).toContain(point);
  }
  expect(selections[3].filter(point => point.y === 45).length).toBeGreaterThan(2);
  expect(selections[3].filter(point => point.y === -45).length).toBeGreaterThan(2);
});

it.each([
  { arbitrarySizeMm: { width: 100, length: 60 } },
  { arbitrarySizeMm: { width: 10, length: 30 } },
  { arbitrarySizeMm: { width: 171.2, length: 29.7 } },
  { footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } },
])("keeps nested, deterministic density selections on %j", patch => {
  const spec = bin(patch);
  const full = ultim8PegCenters(spec);
  for (const available of [full, full.filter(point => Math.abs(point.x) > 10),
    full.filter(point => Math.abs((point.y / 5) % 2) === 1), full.slice(0, 1), []]) {
    const before = structuredClone(available);
    let previous = selectUltim8PegCenters(spec, available);
    for (const density of [5, 4, 3, 2, 1] as const) {
      const currentSpec = bin({ ...spec, pegBottom: { ...spec.pegBottom!, density } });
      const selected = selectUltim8PegCenters(currentSpec, available);
      expect(selected).toEqual(selectUltim8PegCenters(currentSpec, available));
      for (const point of previous) expect(selected).toContain(point);
      for (const point of selected) expect(available).toContain(point);
      expect(new Set(selected).size).toBe(selected.length);
      previous = selected;
    }
    expect(previous).toEqual(available);
    expect(available).toEqual(before);
  }
});
