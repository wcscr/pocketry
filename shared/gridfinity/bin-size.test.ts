import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { arbitrarySizePatch, binWidthMm, binLengthMm, gridSizeFromArbitrary } from "./bin-size";
import { footprintOuterRingMm, resolveBoundaryRun, edgeForWall } from "./footprint";
import { binToCanvas, canvasToBin } from "./cutout";
import { DEFAULT_PEG_BOTTOM } from "./peg-bottom";
import { parseProjectDoc, serializeProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";

const standard = parseBinSpec({ gridX: 16, gridY: 3, gridPitch: "quarter", heightUnits: 1, lip: "none", pegBottom: DEFAULT_PEG_BOTTOM });
describe("arbitrary millimetre sizes", () => {
  it("preserves the physical footprint and coordinate frame when entering and returning to a grid", () => {
    const spec = parseBinSpec({ ...standard, ...arbitrarySizePatch(standard) });
    expect(spec.arbitrarySizeMm).toEqual({ width: 167.5, length: 31 });
    expect(footprintOuterRingMm(spec)).toEqual(footprintOuterRingMm(standard));
    expect(binToCanvas({ x: 42, y: 0 }, spec)).toEqual(binToCanvas({ x: 42, y: 0 }, standard));
    expect(gridSizeFromArbitrary(spec, "quarter")).toEqual({ gridX: 16, gridY: 3, gridPitch: "quarter", arbitrarySizeMm: null });
    expect(gridSizeFromArbitrary(spec, "full")).toBeNull();
  });
  it("uses exact dimensions, a reversible canvas mapping and full wall spans independent of retained grid cells", () => {
    const spec = parseBinSpec({ ...standard, arbitrarySizeMm: { width: 171.2, length: 29.7 }, heightUnits: 7.3 / 7 });
    expect(binWidthMm(spec)).toBe(171.2); expect(binLengthMm(spec)).toBe(29.7);
    const ring = footprintOuterRingMm(spec);
    expect(Math.max(...ring.map(p => p.x)) - Math.min(...ring.map(p => p.x))).toBeCloseTo(171.2, 10);
    expect(Math.max(...ring.map(p => p.y)) - Math.min(...ring.map(p => p.y))).toBeCloseTo(29.7, 10);
    const point = canvasToBin(binToCanvas({ x: 32.1, y: -4.4 }, spec), spec);
    expect(point.x).toBeCloseTo(32.1, 10); expect(point.y).toBeCloseTo(-4.4, 10);
    expect(resolveBoundaryRun(spec, edgeForWall(spec, "north"))!.lengthMm).toBeCloseTo(171.2);
    expect(gridSizeFromArbitrary(spec, "quarter")).toBeNull();
  });
  it("requires smooth rectangular bases, preserves grid height constraints, and permits thin arbitrary bodies", () => {
    expect(() => parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 1.1 })).toThrow();
    expect(() => parseBinSpec({ ...standard, pegBottom: null, arbitrarySizeMm: { width: 20, length: 20 } })).toThrow();
    expect(() => parseBinSpec({ ...standard, arbitrarySizeMm: { width: 20, length: 20 }, footprint: { kind: "custom", cells: [{ x: 0, y: 0 }] } })).toThrow();
    expect(parseBinSpec({ ...standard, arbitrarySizeMm: { width: 20.2, length: 14.1 }, heightUnits: 2.4 / 7 }).heightUnits * 7).toBeCloseTo(2.4);
  });
  it("migrates v38 unchanged and round-trips exact sizes and density in current history", () => {
    const old = { schemaVersion: 38, shapes: [], spec: standard, cutouts: [], fingerHoles: [] };
    expect(parseProjectDoc(old)!.spec).toEqual(standard);
    const spec = parseBinSpec({ ...standard, arbitrarySizeMm: { width: 171.2, length: 29.7 }, heightUnits: 7.3 / 7, pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "flat", density: "corners" } });
    const doc = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], spec, cutouts: [], fingerHoles: [], history: { stack: [{ doc: { spec, cutouts: [], fingerHoles: [] }, label: "Prototype" }], index: 0 } })!;
    expect(doc).not.toBeNull();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(doc))))).toEqual(doc);
  });
});
