import { describe, expect, it } from "vitest";

import { parseCutoutPlacement, type DepthSpec, type TracedShape } from "./cutout";
import { parseBinSpec, type BinSpecInput } from "./types";
import { validatePocketFloorMaterials } from "./validate";

const shape: TracedShape = {
  id: "tool", name: "Air Duster", sourceMmPerPx: 0.5, pointCount: 4,
  bboxMm: { minX: -15, minY: -10, maxX: 15, maxY: 10 },
  outlineMm: [{ outer: [{ x: -15, y: -10 }, { x: 15, y: -10 }, { x: 15, y: 10 }, { x: -15, y: 10 }], holes: [] }],
};
const shapes = new Map([[shape.id, shape]]);
const fixedDepth: DepthSpec = { mode: "mm", value: 39 };
function warnings(depth: DepthSpec = fixedDepth, thickness = 0.6, overrides: Partial<BinSpecInput> = {}) {
  return validatePocketFloorMaterials(
    parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6.5, fill: "solid", ...overrides }),
    [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth })],
    shapes,
    thickness,
  );
}

describe("pocket floor material warnings", () => {
  it("does not warn about underside recesses for a flat bottom, including dormant holes", () => {
    expect(warnings(fixedDepth, 0.6, { flatBottom: true, screwHoles: true, magnetHoles: true })).toEqual([]);
  });

  it("warns for a 5.3 mm floor whose color reaches the raised underside, even without magnet holes", () => {
    expect(warnings()).toEqual([expect.objectContaining({
      code: "floor-color-on-underside", severity: "warning", cutoutIds: ["pocket"],
    })]);
    expect(warnings()[0].message).toContain("Air Duster");
    expect(warnings()[0].message).toContain("0.60 mm");
    expect(warnings()[0].message).toContain("recesses between the base feet");
  });

  it("also checks remaining-floor mode and contact with the underside boundary", () => {
    expect(warnings({ mode: "remaining", floorThicknessMm: 5.35 })).toHaveLength(1);
    expect(warnings({ mode: "remaining", floorThicknessMm: 5.36 })).toEqual([]);
    expect(warnings({ mode: "remaining", floorThicknessMm: 7 })).toEqual([]);
  });

  it("clears after reducing fixed depth, increasing bin height, or removing the lip allowance", () => {
    expect(warnings({ mode: "mm", value: 38.8 })).toEqual([]);
    expect(warnings(fixedDepth, 0.6, { heightUnits: 7 })).toEqual([]);
    expect(warnings(fixedDepth, 0.6, { lip: "none" })).toEqual([]);
  });

  it("responds to color thickness without needing a geometry rebuild", () => {
    expect(warnings(fixedDepth, 0.4)).toEqual([]);
    expect(warnings(fixedDepth, 0.6)).toHaveLength(1);
    expect(warnings({ mode: "remaining", floorThicknessMm: 5.8 }, 0.6)).toEqual([]);
    expect(warnings({ mode: "remaining", floorThicknessMm: 5.8 }, 1.2)).toHaveLength(1);
  });

  it.each(["half", "quarter"] as const)("checks the shaped underside for %s pitch", (gridPitch) => {
    expect(warnings(fixedDepth, 0.6, { gridPitch })).toHaveLength(1);
  });

  it.each([{ screwHoles: true }])("accounts for taller recesses with %o", (options) => {
    expect(warnings({ mode: "remaining", floorThicknessMm: 7.4 }, 0.6, options)).toHaveLength(1);
    expect(warnings({ mode: "remaining", floorThicknessMm: 7.7 }, 0.6, options)).toEqual([]);
  });

  it("ignores screw holes on a pitch where the builder omits them", () => {
    expect(warnings({ mode: "remaining", floorThicknessMm: 7 }, 0.6, { screwHoles: true, gridPitch: "half" })).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("ignores a disabled or invalid color thickness %s", (thickness) => {
    expect(warnings(fixedDepth, thickness)).toEqual([]);
  });

  it.each<DepthSpec>([
    { mode: "through" }, { mode: "remaining", floorThicknessMm: 0 },
    { mode: "mm", value: 100 }, { mode: "remaining", floorThicknessMm: 50 },
  ])("does not add material warnings for a pocket without a printable floor: %o", (depth) => {
    expect(warnings(depth)).toEqual([]);
  });

  it("leaves missing shapes and absent infill to layout validation", () => {
    expect(warnings(fixedDepth, 0.6, { fill: "none" })).toEqual([]);
    expect(validatePocketFloorMaterials(
      parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
      [parseCutoutPlacement({ id: "missing", shapeId: "missing", position: { x: 0, y: 0 }, depth: { mode: "remaining", floorThicknessMm: 5 } })],
      shapes, 0.6,
    )).toEqual([]);
  });
});
