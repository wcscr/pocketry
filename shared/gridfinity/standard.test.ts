import { describe, expect, it } from "vitest";

import {
  BASE_BOTTOM_RADIUS,
  BASE_BRIDGE_HEIGHT,
  BASE_GAP_MM,
  BASE_HEIGHT,
  BASE_PROFILE,
  BASE_PROFILE_HEIGHT,
  BASE_PROFILE_MAX_X,
  BASE_TOP_DIMENSIONS_MM,
  BASE_TOP_RADIUS,
  baseBottomDimensionsMm,
  binFootprintMm,
  binHeightMm,
  binTotalHeightMm,
  binWallHeightMm,
  D_WALL,
  GRID_PITCH_DIVISOR,
  gridPitchMm,
  resizeGridToStandardCellSpan,
  standardCellSpan,
  R_F2,
  STACKING_LIP_DEPTH,
  STACKING_LIP_FILLET_RADIUS,
  STACKING_LIP_HEIGHT,
  STACKING_LIP_HEIGHT_ACTUAL,
  STACKING_LIP_LINE,
  MAGNET_HOLE_CRUSH_RIB_COUNT,
  MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
  TAB_DEPTH_MM,
  TAB_HEIGHT_MM,
  TAB_PROFILE,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_SUPPORT_HEIGHT_MM,
  TAB_WIDTH_NOMINAL_MM,
} from "./standard";

/**
 * These are ported constants, so the tests pin the *relationships* upstream
 * relies on rather than restating each number: if someone "fixes" one value
 * the derived identities go red.
 */
describe("gridfinity standard constants", () => {
  it("base profile is the documented chamfer–straight–chamfer line", () => {
    expect(BASE_PROFILE).toEqual([
      [0, 0],
      [0.8, 0.8],
      [0.8, 2.6],
      [2.95, 4.75],
    ]);
    // Both chamfers are exactly 45°.
    expect(BASE_PROFILE[1][0]).toBeCloseTo(BASE_PROFILE[1][1], 12);
    const [dx, dy] = [
      BASE_PROFILE[3][0] - BASE_PROFILE[2][0],
      BASE_PROFILE[3][1] - BASE_PROFILE[2][1],
    ];
    expect(dx).toBeCloseTo(dy, 12);
  });

  it("derives the base radii and footprints the way upstream does", () => {
    expect(BASE_PROFILE_MAX_X).toBeCloseTo(BASE_PROFILE[3][0], 12);
    expect(BASE_PROFILE_HEIGHT).toBeCloseTo(BASE_PROFILE[3][1], 12);
    expect(BASE_BOTTOM_RADIUS).toBeCloseTo(BASE_TOP_RADIUS - BASE_PROFILE_MAX_X, 12);
    expect(BASE_BRIDGE_HEIGHT).toBeCloseTo(BASE_HEIGHT - BASE_PROFILE_HEIGHT, 12);
    expect(baseBottomDimensionsMm()).toBeCloseTo(35.6, 12);
    expect(BASE_TOP_DIMENSIONS_MM + BASE_GAP_MM).toBeCloseTo(42, 12);
    // The interior fillet is the top radius minus one wall.
    expect(R_F2).toBeCloseTo(BASE_TOP_RADIUS - D_WALL, 12);
  });

  it("stacking lip line mirrors the base profile with stacking clearance", () => {
    expect(STACKING_LIP_LINE).toEqual([
      [0, 0],
      [0.7, 0.7],
      [0.7, 2.5],
      [2.6, 4.4],
    ]);
    expect(STACKING_LIP_DEPTH).toBeCloseTo(STACKING_LIP_LINE[3][0], 12);
    expect(STACKING_LIP_HEIGHT).toBeCloseTo(STACKING_LIP_LINE[3][1], 12);
    // 45° support under a 2.6 mm overhang plus the 1.2 mm inner face.
    expect(STACKING_LIP_SUPPORT_HEIGHT_MM).toBeCloseTo(1.2 + 2.6, 12);
  });

  it("computes the filleted lip height exactly (nominal − r·√2)", () => {
    expect(STACKING_LIP_HEIGHT_ACTUAL).toBeCloseTo(
      STACKING_LIP_HEIGHT - STACKING_LIP_FILLET_RADIUS * Math.SQRT2,
      12,
    );
    // Matches the arc-summit derivation upstream verifies visually:
    // centre y = 4.4 − 0.6·(1+√2) = 2.951472, summit = centre + 0.6.
    expect(STACKING_LIP_HEIGHT_ACTUAL).toBeCloseTo(3.5514718, 6);
  });

  it("sizes bins the way the milestone table expects", () => {
    expect(binFootprintMm(2)).toBeCloseTo(83.5, 12);
    expect(binFootprintMm(3)).toBeCloseTo(125.5, 12);
    expect(binHeightMm(6)).toBeCloseTo(42, 12);
    expect(binWallHeightMm(6)).toBeCloseTo(35, 12);
    expect(binTotalHeightMm(6, false)).toBeCloseTo(42, 12);
    expect(binTotalHeightMm(6, true)).toBeCloseTo(42 + STACKING_LIP_HEIGHT_ACTUAL, 12);
  });

  it("keeps the 0.5 mm gap constant on half/quarter pitches", () => {
    expect(GRID_PITCH_DIVISOR).toEqual({ full: 1, half: 2, quarter: 4 });
    expect(gridPitchMm("full")).toBe(42);
    expect(gridPitchMm("half")).toBe(21);
    expect(gridPitchMm("quarter")).toBe(10.5);
    expect(binFootprintMm(2, "half")).toBe(41.5);
    expect(binFootprintMm(4, "quarter")).toBe(41.5);
    expect(binFootprintMm(1, "quarter")).toBe(10);
  });

  it("expresses rectangular dimensions in standard cells and promotes fractional spans", () => {
    expect(standardCellSpan(3, "half")).toBe(1.5);
    expect(standardCellSpan(5, "quarter")).toBe(1.25);
    expect(
      resizeGridToStandardCellSpan(
        { gridX: 2, gridY: 3, gridPitch: "full" },
        "x",
        1.5,
      ),
    ).toEqual({ gridX: 3, gridY: 6, gridPitch: "half" });
    expect(
      resizeGridToStandardCellSpan(
        { gridX: 3, gridY: 6, gridPitch: "half" },
        "y",
        2.5,
      ),
    ).toEqual({ gridX: 3, gridY: 5, gridPitch: "half" });
  });
});

describe("label tab constants (upstream TAB_*)", () => {
  it("pins the ported values", () => {
    expect(TAB_WIDTH_NOMINAL_MM).toBe(42);
    expect(TAB_DEPTH_MM).toBe(15.85);
    expect(TAB_SUPPORT_ANGLE_DEG).toBe(36);
    expect(TAB_SUPPORT_HEIGHT_MM).toBe(1.2);
    // _tab_height = tan(36°)·15.85 + 1.2
    expect(TAB_HEIGHT_MM).toBeCloseTo(Math.tan(Math.PI / 5) * 15.85 + 1.2, 12);
  });

  it("mirrors upstream TAB_POLYGON's shape", () => {
    expect(TAB_PROFILE).toEqual([
      [0, 0],
      [0, TAB_HEIGHT_MM],
      [15.85, TAB_HEIGHT_MM],
      [15.85, TAB_HEIGHT_MM - 1.2],
    ]);
  });
});

describe("crush rib constants (upstream MAGNET_HOLE_CRUSH_RIB_*)", () => {
  it("pins the ported values", () => {
    expect(MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS).toBe(5.9 / 2);
    expect(MAGNET_HOLE_CRUSH_RIB_COUNT).toBe(8);
  });
});
