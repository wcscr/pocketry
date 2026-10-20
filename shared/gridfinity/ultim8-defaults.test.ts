import { describe, expect, it } from "vitest";
import { ultim8Defaults } from "./ultim8-defaults";
import { parseBinSpec } from "./types";
import { DEFAULT_PEG_BOTTOM } from "./peg-bottom";

describe("ULTIM8 fixture defaults", () => {
  it("returns fresh, single-color settings without changing its inputs", () => {
    const spec = parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 6, fill: "none", textColor: "#ffffff" });
    const before = structuredClone(spec);
    const defaults = ultim8Defaults(spec, 8.5, "#123456");
    expect(parseBinSpec({ ...spec, ...defaults.patch })).toMatchObject({
      pegBottom: DEFAULT_PEG_BOTTOM, arbitrarySizeMm: { width: 125.5, length: 83.5 },
      heightUnits: 8.5 / 7, lip: "none", fill: "solid", fillHeightPercent: 100, flatBottom: false, textColor: null,
    });
    expect(defaults.materialPatch).toEqual({ colorPocketFloors: false, colorStackingRim: false,
      pocketFloorColor: "#123456", stackingRimColor: "#123456" });
    expect(spec).toEqual(before);
    expect(ultim8Defaults(spec, 8.5, "#123456")).toEqual(defaults);
    expect(defaults.patch.pegBottom).not.toBe(DEFAULT_PEG_BOTTOM);
  });

  it("retains explicit dimensions and custom footprints", () => {
    const arbitrary = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, flatBottom: true, arbitrarySizeMm: { width: 159.4, length: 75 } });
    expect(ultim8Defaults(arbitrary, 10, "#123456").patch.arbitrarySizeMm).toEqual(arbitrary.arbitrarySizeMm);
    const custom = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    const result = parseBinSpec({ ...custom, ...ultim8Defaults(custom, 14, "#123456").patch });
    expect(result.footprint).toEqual(custom.footprint);
    expect(result.arbitrarySizeMm).toBeNull();
  });
});
