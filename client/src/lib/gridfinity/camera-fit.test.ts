import { describe, expect, it } from "vitest";

import { fitDistanceMm } from "./camera-fit";

describe("fitDistanceMm", () => {
  it("grows with the bin", () => {
    const small = fitDistanceMm({ widthMm: 83.5, lengthMm: 83.5, heightMm: 45 }, 40, 1.6);
    const large = fitDistanceMm({ widthMm: 293.5, lengthMm: 419.5, heightMm: 45 }, 40, 1.6);
    expect(large).toBeGreaterThan(small * 2);
  });

  it("keeps the bounding sphere inside the vertical frustum", () => {
    const size = { widthMm: 200, lengthMm: 300, heightMm: 50 };
    const distance = fitDistanceMm(size, 40, 2.0);
    const radius = 0.5 * Math.hypot(200, 300, 50);
    // At the fitted distance the sphere subtends less than the fov.
    const halfAngle = Math.asin(Math.min(1, radius / distance));
    expect(halfAngle).toBeLessThan((40 / 2) * (Math.PI / 180));
  });

  it("uses the horizontal frustum when the viewport is narrow", () => {
    const size = { widthMm: 200, lengthMm: 200, heightMm: 40 };
    const wide = fitDistanceMm(size, 40, 2.0);
    const narrow = fitDistanceMm(size, 40, 0.5);
    // A narrow viewport needs more distance for the same bin.
    expect(narrow).toBeGreaterThan(wide);
  });
});
