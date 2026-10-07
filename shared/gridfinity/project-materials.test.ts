import { describe, expect, it } from "vitest";
import { DEFAULT_BIN_MATERIALS } from "./materials";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";
import { parseBinSpec } from "./types";
import { DEFAULT_PEG_BOTTOM } from "./peg-bottom";

const design = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, textColor: "#fedcba" }),
  shapes: [], cutouts: [], fingerHoles: [],
};

describe("saved project materials", () => {
  it("round-trips the full appearance with independent text color and design history", () => {
    const doc = { ...design, materials: { ...DEFAULT_BIN_MATERIALS,
      binColor: "#123456", pocketFloorColor: "#abcdef", stackingRimColor: "#654321",
      colorPocketFloors: false, colorStackingRim: false,
      pocketFloorThicknessMm: 1.2, stackingRimThicknessMm: 2.5, borderWidthMm: 3,
    }, history: { index: 0, stack: [{ label: "Opened", doc: {
      spec: design.spec, cutouts: [], fingerHoles: [],
    } }] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(doc))))).toEqual(doc);
  });

  it.each([36, 39])("preserves colors and ULTIM8 sizing/history from version %i", version => {
    const spec = parseBinSpec({ ...design.spec,
      arbitrarySizeMm: version === 39 ? { width: 167.5, length: 31 } : null,
      pegBottom: version === 39 ? { ...DEFAULT_PEG_BOTTOM, underside: "flat", density: "corners" } : null,
    });
    const doc = { ...design, spec, materials: { ...DEFAULT_BIN_MATERIALS, binColor: "#123456" },
      history: { index: 0, stack: [{ label: "Opened", doc: { spec, cutouts: [], fingerHoles: [] } }] },
    };
    const legacy = { ...doc, schemaVersion: version };
    const before = JSON.stringify(legacy);
    const opened = parseProjectDoc(legacy);
    expect(opened).toEqual(doc);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(opened!))))).toEqual(doc);
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it.each([1, 7, 16, 25, 31, 35])("opens version %i without colors or mutation", version => {
    const legacy: Record<string, unknown> = { ...design, schemaVersion: version };
    if (version < 7) delete legacy.fingerHoles;
    const before = JSON.stringify(legacy);
    const opened = parseProjectDoc(legacy)!;
    expect(opened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.materials ?? DEFAULT_BIN_MATERIALS).toEqual(DEFAULT_BIN_MATERIALS);
    expect(opened.spec.textColor).toBe("#fedcba");
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it.each([
    { binColor: "red" }, { pocketFloorColor: "#123" }, { stackingRimColor: "#gggggg" },
    { colorPocketFloors: "false" }, { colorStackingRim: 1 },
    { pocketFloorThicknessMm: 0 }, { pocketFloorThicknessMm: 3.1 },
    { stackingRimThicknessMm: 8 }, { borderWidthMm: -1 }, { borderWidthMm: 21 },
    { unknown: true },
  ])("rejects invalid material settings %j", invalid => {
    expect(parseProjectDoc({ ...design, materials: { ...DEFAULT_BIN_MATERIALS, ...invalid } })).toBeNull();
  });
});
