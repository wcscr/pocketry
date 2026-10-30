import { describe, expect, it, vi } from "vitest";
import { withinImportLimits, readImportJson, PROJECT_FILE_MAX_BYTES, LIBRARY_FILE_MAX_BYTES } from "./import-limits";
import { parseProjectDoc } from "./project";
import samples from "../../samples/pocketry-sample-library.json";
import sample from "./fixtures/airduster-v9.pocketry.json";
const point = { x: 1, y: 2 };
describe("project import resource boundaries", () => {
  it.each([false, true])("rejects an oversized file before text or JSON allocation (library: %s)", async library => {
    const text = vi.fn(async () => "{}");
    const size = (library ? LIBRARY_FILE_MAX_BYTES : PROJECT_FILE_MAX_BYTES) + 1;
    await expect(readImportJson({ size, text }, library)).rejects.toThrow("import limits");
    expect(text).not.toHaveBeenCalled();
    await expect(readImportJson({ size: 2, text }, library)).resolves.toEqual({});
  });
  it("counts many small rings, snapshots and origins in one budget", () => {
    const rings = Array.from({ length: 11 }, () => ({ outer: Array(10_000).fill(point), holes: [] }));
    for (const input of [{ shapes: rings }, { history: { stack: rings.map(ring => ({ doc: { outline: ring } })) } }, { transformOrigins: { pockets: rings } }]) {
      expect(withinImportLimits(input)).toBe(false);
    }
    expect(withinImportLimits({ outer: Array(10_001).fill(point) })).toBe(false);
    expect(withinImportLimits({ spec: { footprint: { cells: Array(10_001).fill(point) } } })).toBe(false);
    expect(withinImportLimits({ projects: Array(501).fill({}) }, true)).toBe(false);
  });
  it("counts repeated shape placements instead of trusting claimed pointCount", () => {
    const shapes = [{ id: "s", pointCount: 1, outlineMm: [{ outer: Array(10_000).fill(point), holes: [] }] }];
    expect(withinImportLimits({ shapes, cutouts: Array(100).fill({ shapeId: "s" }) })).toBe(true);
    expect(withinImportLimits({ shapes, cutouts: Array(101).fill({ shapeId: "s" }) })).toBe(false);
  });
  it("charges repeated glyphs for sampled rendering work", () => {
    const outline = "m 0 0 " + "l 1 0 l 1 1 l 0 1 l 0 0 ".repeat(8000);
    const label = { text: "A".repeat(120), font: { kind: "local", glyphs: { A: { o: outline, ha: 1000 } }, resolution: 1000 } };
    expect(withinImportLimits({ spec: { surfaceTexts: Array(32).fill(label) } })).toBe(false);
    expect(withinImportLimits({ spec: { surfaceTexts: [{ ...label, text: "A" }] } })).toBe(true);
    const curves = { ...label, text: "A".repeat(120), font: { ...label.font, glyphs: { A: { o: "m 0 0 " + "q 1 1 2 2 ".repeat(1000) } } } };
    expect(withinImportLimits({ spec: { surfaceTexts: [curves] } })).toBe(false);
  });
  it("bounds depth and cycles before recursive schema parsing", () => {
    let nested: unknown = {};
    for (let i = 0; i < 70; i++) nested = { nested };
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(withinImportLimits(nested)).toBe(false);
    expect(parseProjectDoc(cyclic)).toBeNull();
  });
  it("rejects oversized current and legacy documents without changing them", () => {
    const valid = parseProjectDoc(sample)!;
    expect(valid).not.toBeNull();
    for (const source of [sample, valid]) {
      const input = structuredClone(source);
      input.shapes[0].outlineMm[0].outer = Array(10_001).fill(point);
      expect(parseProjectDoc(input)).toBeNull();
      expect(input.shapes[0].outlineMm[0].outer).toHaveLength(10_001);
    }
  });
  it("accepts all bundled sample designs and the complete sample library", () => {
    expect(withinImportLimits(samples, true)).toBe(true);
    for (const project of samples.projects) expect(parseProjectDoc(project.doc), project.name).not.toBeNull();
  });
  it("rejects a schema-valid repeated-glyph project before geometry expansion", () => {
    const doc = parseProjectDoc(sample)!;
    const label = { id: "label", text: "A".repeat(120), position: { x: 0, y: 0 },
      font: { kind: "local" as const, name: "Imported font", resolution: 1000, glyphs: { A: { ha: 1000,
        o: "m 0 0 " + "l 1 0 l 1 1 l 0 1 l 0 0 ".repeat(8000) } } },
      sizeMm: 6, heightMm: .8, rotationDeg: 0 };
    const hostile = { ...doc, spec: { ...doc.spec, surfaceTexts: Array.from({ length: 32 }, (_, i) => ({ ...label, id: String(i) })) } };
    expect(parseProjectDoc(hostile)).toBeNull();
    expect(parseProjectDoc({ ...doc, spec: { ...doc.spec, surfaceTexts: [{ ...label, text: "A" }] } })).not.toBeNull();
  });
  it("permits portable fonts larger than the old proposed 10 MB ceiling", () => {
    const data = "A".repeat(28_000_000);
    expect(withinImportLimits({ fontSources: { "font-1": { data, byteLength: 20 * 1024 * 1024 } }, history: { stack: Array(50).fill({ source: { data } }) } })).toBe(true);
  });
});
