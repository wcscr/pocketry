import { describe, expect, it, vi } from "vitest";
import { localFontSourceSchema, type LocalFont } from "./local-font";
import { parseProjectDoc, projectDocSchema, PROJECT_SCHEMA_VERSION, serializeProjectDoc, type ProjectDoc } from "./project";
import { surfaceTextSchema } from "./surface-text";
import { parseBinSpec } from "./types";
import { parseCutoutPlacement } from "./cutout";

const source = { data: "YWJjZA==", byteLength: 4 };
const font: LocalFont = { kind: "local", name: "Saved Sans", resolution: 1000, source,
  glyphs: { A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500 z" } } };
function document(): ProjectDoc {
  const label = surfaceTextSchema.parse({ id: "label", text: "A", font, position: { x: 0, y: 0 } });
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, surfaceTexts: [label] });
  const empty = { spec: { ...spec, surfaceTexts: [] }, cutouts: [], fingerHoles: [] };
  const present = { ...empty, spec };
  return { ...empty, schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], history: { index: 0, stack: [
    { doc: empty, label: "Start" }, { doc: present, label: "Add text" },
    { doc: { ...present, spec: { ...spec, surfaceTexts: [{ ...label, position: { x: 5, y: 2 } }] } }, label: "Move text" },
  ] }, transformOrigins: { pockets: [{ cutout: parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 } }), spec }], fingerHoles: [] } };
}

describe("project font-source references", () => {
  it("shares sources across current labels, undone/redo history, and transform references without mutation", () => {
    const original = document();
    const before = JSON.stringify(original);
    const compact = serializeProjectDoc(original);
    expect(compact.fontSources).toEqual({ "font-1": source });
    expect(JSON.stringify(compact).match(/"data":/g)).toHaveLength(1);
    expect(JSON.stringify(original)).toBe(before);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(compact)))).toEqual(original);
    expect(parseProjectDoc({ ...original, schemaVersion: 30 })).toEqual(original);
  });

  it("keeps different source bytes separate even when font names match", () => {
    const original = document();
    const other = { ...font, source: { data: "ZWZnaA==", byteLength: 4 } };
    original.spec.surfaceTexts = [surfaceTextSchema.parse({ id: "other", text: "A", font: other, position: { x: 1, y: 0 } })];
    original.history = undefined;
    const compact = serializeProjectDoc(original);
    expect(Object.keys(compact.fontSources as object)).toHaveLength(2);
    expect(parseProjectDoc(compact)).toEqual(original);
  });

  it.each(["missing table", "missing reference", "invalid source", "unknown reference field", "prototype reference"])("rejects %s without changing the input", problem => {
    const compact = serializeProjectDoc(document());
    if (problem === "missing table") delete compact.fontSources;
    if (problem === "missing reference") compact.fontSources = {};
    if (problem === "invalid source") compact.fontSources = { "font-1": { ...source, data: "not base64!" } };
    const origins = compact.transformOrigins as { pockets: { spec: { surfaceTexts: { font: { source: unknown } }[] } }[] };
    if (problem === "unknown reference field") origins.pockets[0].spec.surfaceTexts[0].font.source = { ref: "font-1", data: source.data };
    if (problem === "prototype reference") origins.pockets[0].spec.surfaceTexts[0].font.source = { ref: "__proto__" };
    const before = JSON.stringify(compact);
    expect(parseProjectDoc(compact)).toBeNull();
    expect(JSON.stringify(compact)).toBe(before);
  });

  it("keeps validating changed source metadata and bytes after a successful cached parse", () => {
    expect(localFontSourceSchema.safeParse(source).success).toBe(true);
    expect(localFontSourceSchema.safeParse({ ...source, byteLength: 0 }).success).toBe(false);
    expect(localFontSourceSchema.safeParse({ ...source, byteLength: 21 * 1024 * 1024 }).success).toBe(false);
    expect(localFontSourceSchema.safeParse({ ...source, data: source.data + "!" }).success).toBe(false);
    expect(localFontSourceSchema.safeParse({ ...source, extra: true }).success).toBe(false);
  });

  it("validates repeated large font references and inline history without serializing expanded bytes", () => {
    const data = "D".repeat(17_000_000);
    const original = document();
    const label = surfaceTextSchema.parse({ id: "label", text: "A", position: { x: 0, y: 0 },
      font: { ...font, source: { data, byteLength: 12_750_000 } } });
    original.spec.surfaceTexts = Array.from({ length: 32 }, (_, index) => ({ ...label, id: String(index) }));
    original.history = { index: 0, stack: [{ label: "Text", doc: {
      spec: original.spec, cutouts: original.cutouts, fingerHoles: original.fingerHoles,
    } }] };
    const compact = serializeProjectDoc(original);
    // A pre-fix regression fails safely instead of allocating a >544 MB string.
    const native = JSON.stringify;
    let materialSerializations = 0;
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
      if (value?.spec?.surfaceTexts?.length) { materialSerializations++; throw new Error("Expanded serialization"); }
      return native(value, replacer, space);
    });
    try {
      for (const input of [compact, original]) {
        const result = parseProjectDoc(input);
        expect(result?.spec.surfaceTexts).toHaveLength(32);
        expect(result?.spec.surfaceTexts[0].font).toMatchObject({ source: { byteLength: 12_750_000 } });
      }
      expect(projectDocSchema.safeParse(original).success).toBe(true);
      const changed = { ...original, spec: { ...original.spec, surfaceTexts: [
        { ...original.spec.surfaceTexts[0], font: { ...font, source: { data: data.slice(0, -1) + "E", byteLength: 12_750_000 } } },
        ...original.spec.surfaceTexts.slice(1),
      ] } };
      expect(parseProjectDoc(changed)).toBeNull();
      expect(materialSerializations).toBe(0);
    } finally { stringify.mockRestore(); }
  });

  it("checks each alternating large source once per project parse and still checks changed metadata", () => {
    const original = document();
    const data = ["F".repeat(17_000_000), "G".repeat(17_000_000)];
    const labels = data.map((value, index) => surfaceTextSchema.parse({ id: String(index), text: "A",
      position: { x: 0, y: 0 }, font: { ...font, source: { data: value, byteLength: 12_750_000 } } }));
    original.spec.surfaceTexts = labels;
    original.history = { index: 0, stack: Array.from({ length: 50 }, () => ({ label: "Text", doc: {
      spec: original.spec, cutouts: original.cutouts, fingerHoles: original.fingerHoles,
    } })) };
    const compact = serializeProjectDoc(original);
    const originalTest = RegExp.prototype.test;
    let scans = 0;
    const spy = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
      if (value.length === 17_000_000) scans++;
      return originalTest.call(this, value);
    });
    try {
      const parsed = parseProjectDoc(compact)!;
      expect(parsed.history?.stack).toHaveLength(50);
      expect(scans).toBeLessThanOrEqual(2);
      scans = 0;
      expect(parseBinSpec({ ...parsed.spec, heightUnits: 7 }).heightUnits).toBe(7);
      expect(scans).toBeLessThanOrEqual(2);
      const invalid = { ...original, spec: { ...original.spec, surfaceTexts: [{ ...labels[0],
        font: { ...font, source: { data: data[0], byteLength: 0 } },
      }] } };
      expect(parseProjectDoc(invalid)).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it("bounds editing work when a bin uses more sources than the retained cache holds", () => {
    const data = Array.from({ length: 9 }, (_, index) => String.fromCharCode(65 + index).repeat(1024));
    const labels = Array.from({ length: 32 }, (_, index) => ({ id: String(index), text: "A", position: { x: 0, y: 0 },
      font: { ...font, source: { data: data[index % data.length], byteLength: 768 } },
    }));
    const native = RegExp.prototype.test;
    let scans = 0;
    const spy = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
      if (value.length === 1024) scans++;
      return native.call(this, value);
    });
    try {
      expect(parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 7, surfaceTexts: labels }).surfaceTexts).toHaveLength(32);
      expect(scans).toBeLessThanOrEqual(9);
    } finally { spy.mockRestore(); }
  });

  it("unused source-table entries cannot evict checks needed by repeated labels", () => {
    const original = document();
    const values = Array.from({ length: 9 }, (_, index) => String.fromCharCode(74 + index).repeat(1024));
    original.spec.surfaceTexts = Array.from({ length: 32 }, (_, index) => surfaceTextSchema.parse({
      id: String(index), text: "A", position: { x: 0, y: 0 },
      font: { ...font, source: { data: values[index % 9], byteLength: 768 } },
    }));
    original.history = undefined;
    const compact = serializeProjectDoc(original);
    compact.fontSources = { ...Object.fromEntries(Array.from({ length: 20_001 }, (_, index) => [
      `font-${index + 100}`, { data: index.toString(36).padStart(8, "A"), byteLength: 6 },
    ])), ...compact.fontSources as object };
    const native = RegExp.prototype.test;
    let scans = 0;
    const spy = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
      if (value.length === 1024) scans++;
      return native.call(this, value);
    });
    try {
      expect(parseProjectDoc(compact)?.spec.surfaceTexts).toHaveLength(32);
      expect(scans).toBeLessThanOrEqual(9);
    } finally { spy.mockRestore(); }
  });
});
