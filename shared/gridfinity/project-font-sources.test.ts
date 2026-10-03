import { describe, expect, it } from "vitest";
import { localFontSourceSchema, type LocalFont } from "./local-font";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc, type ProjectDoc } from "./project";
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
});
