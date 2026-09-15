import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { hasMagnets, magnetHoleDepthMm, magnetHoleRadiusMm, magnetCrushRadiusMm } from "./magnets";
import { validateBinSpec } from "./validate";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";

const spec = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, ...patch });

describe("shared magnet size", () => {
  it("preserves original recesses and crush interference by default", () => {
    expect(magnetHoleRadiusMm(spec())).toBe(3.25);
    expect(magnetHoleDepthMm(spec())).toBe(2.4);
    expect(magnetCrushRadiusMm(spec())).toBe(2.95);
  });

  it("migrates saved designs and every undo step to the same magnet size", () => {
    const { magnetDiameterMm: _diameter, magnetThicknessMm: _thickness, ...old } = spec({ magnetHoles: true, magneticLid: true });
    const material = { spec: old, cutouts: [], fingerHoles: [] };
    const doc = parseProjectDoc({ schemaVersion: 21, shapes: [], ...material,
      history: { index: 0, stack: [{ label: "Saved", doc: material }] } })!;
    expect(doc.spec).toMatchObject({ magnetDiameterMm: 6, magnetThicknessMm: 2 });
    expect(doc.history!.stack[0].doc.spec).toEqual(doc.spec);
    const changed = { ...doc, history: undefined, spec: spec({ magnetDiameterMm: 8, magnetThicknessMm: 3 }) };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(changed)))).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: { magnetDiameterMm: 8, magnetThicknessMm: 3 } });
  });

  it("shows shared controls only for active magnets", () => {
    expect(hasMagnets(spec())).toBe(false);
    expect(hasMagnets(spec({ magnetHoles: true }))).toBe(true);
    expect(hasMagnets(spec({ magnetHoles: true, flatBottom: true }))).toBe(false);
    expect(hasMagnets(spec({ magnetHoles: true, gridPitch: "half" }))).toBe(false);
    expect(hasMagnets(spec({ magneticLid: true }))).toBe(true);
    expect(hasMagnets(spec({ magneticLid: true, lidMagnetHoles: false }))).toBe(false);
  });

  it("blocks sizes that cannot fit the standard underside while allowing larger lid magnets", () => {
    expect(validateBinSpec(spec({ magnetHoles: true, magnetDiameterMm: 7.5, magnetThicknessMm: 5 })).ok).toBe(true);
    expect(validateBinSpec(spec({ magnetHoles: true, magnetDiameterMm: 8 })).issues).toContainEqual(expect.objectContaining({ code: "magnet-size-unavailable", severity: "error" }));
    expect(validateBinSpec(spec({ magneticLid: true, magnetDiameterMm: 12, magnetThicknessMm: 5 })).ok).toBe(true);
    expect(validateBinSpec(spec({ magnetHoles: true, screwHoles: true, magnetDiameterMm: 3 })).ok).toBe(false);
    expect(validateBinSpec(spec({ magnetHoles: true, flatBottom: true, magnetDiameterMm: 12 })).ok).toBe(true);
  });

  it.each([{ magnetDiameterMm: 2 }, { magnetDiameterMm: 13 }, { magnetDiameterMm: NaN },
    { magnetThicknessMm: 0 }, { magnetThicknessMm: 6 }, { magnetThicknessMm: Infinity }])("rejects invalid size %j", patch => {
    expect(() => spec(patch)).toThrow();
  });
});
