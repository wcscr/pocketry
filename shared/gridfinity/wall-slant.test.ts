import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { binWidthMm, binLengthMm } from "./bin-size";
import { BASE_HEIGHT, binHeightMm } from "./standard";
import { wallSlantPointMm, wallSlantExtraSizeMm, wallSlantCloses, wallSlantHeightMm, wallSlantOutlineMm } from "./wall-slant";

describe("single-wall slant", () => {
  it("does not construct a closing wall below the fixed base", () => {
    const spec = parseBinSpec({ gridX: 1, gridY: 1, arbitrarySizeMm: { width: 10, length: 10 }, flatBottom: true,
      heightUnits: 2 / 7, lip: "none", wallSlant: { axis: "x", side: "positive", angleDeg: 89 } });
    expect(wallSlantCloses(spec)).toBe(false);
    expect(wallSlantHeightMm(spec)).toBe(2);
  });
  it.each(["x", "y"] as const)("moves either %s wall while keeping the opposite wall vertical", axis => {
    for (const side of ["negative", "positive"] as const) {
      for (const angleDeg of [-20, 20]) {
        const spec = parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, lip: "none", wallSlant: { axis, angleDeg, side } });
        const half = (axis === "x" ? binWidthMm(spec) : binLengthMm(spec)) / 2;
        const delta = (binHeightMm(spec.heightUnits) - BASE_HEIGHT) * Math.tan(angleDeg * Math.PI / 180);
        const moving = { x: 0, y: 0, [axis]: side === "positive" ? half : -half };
        const fixed = { x: 0, y: 0, [axis]: -moving[axis] };
        expect(wallSlantPointMm(spec, moving, BASE_HEIGHT)).toEqual(moving);
        expect(wallSlantPointMm(spec, fixed, binHeightMm(spec.heightUnits))).toEqual(fixed);
        expect(wallSlantPointMm(spec, moving, binHeightMm(spec.heightUnits))[axis]).toBeCloseTo(moving[axis] + delta, 8);
        expect(wallSlantExtraSizeMm(spec)[axis]).toBeCloseTo(Math.max(0, side === "positive" ? delta : -delta), 8);
      }
    }
  });

  it("clips inward walls at their meeting height without enlarging the base", () => {
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 12, lip: "none", wallSlant: { axis: "x", angleDeg: 45, side: "negative" } });
    expect(wallSlantCloses(spec)).toBe(true);
    expect(wallSlantHeightMm(spec)).toBeCloseTo(BASE_HEIGHT + binWidthMm(spec));
    expect(wallSlantExtraSizeMm(spec)).toEqual({ x: 0, y: 0 });
    expect(wallSlantCloses({ ...spec, wallSlant: { ...spec.wallSlant!, side: "positive" } })).toBe(false);
  });

  it.each(["x", "y"] as const)("clips a steep %s rim outline instead of reflecting it through the upright wall", axis => {
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 12, lip: "none", wallSlant: { axis, angleDeg: -75, side: "positive" } });
    const half = binWidthMm(spec) / 2;
    const ring = [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
    const clipped = wallSlantOutlineMm(spec, ring, wallSlantHeightMm(spec));
    expect(clipped.length).toBeGreaterThan(1);
    clipped.forEach(point => expect(point[axis]).toBeCloseTo(-half, 6));
  });
});
