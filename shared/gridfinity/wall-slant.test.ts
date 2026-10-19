import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { binWidthMm, binLengthMm } from "./bin-size";
import { BASE_HEIGHT, binHeightMm } from "./standard";
import { wallSlantPointMm, wallSlantExtraSizeMm, wallSlantError } from "./wall-slant";

describe("single-wall slant", () => {
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

  it("rejects inward walls that would meet, while allowing outward tilt", () => {
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 12, lip: "none", wallSlant: { axis: "x", angleDeg: 45, side: "negative" } });
    expect(wallSlantError(spec)).toContain("opposite wall");
    expect(wallSlantError({ ...spec, wallSlant: { ...spec.wallSlant!, side: "positive" } })).toBeNull();
  });
});
