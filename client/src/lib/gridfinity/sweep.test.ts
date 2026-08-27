import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { polygonArea, polygonCentroid, type ProfilePolygon } from "./profiles";
import { sweepRounded, sweptVolumeClosedForm } from "./sweep";

/**
 * The sweep primitive is ~80% of the Gridfinity port, so it gets the plan's
 * full battery: a closed form (prisms + faceted Pappus) that must match to
 * 1e-6 relative, exact bounding boxes, topology (a swept ring is a torus), and
 * status on every solid.
 */

let arena: Arena;
let kernel: Kernel;

beforeAll(async () => {
  const wasm = await loadManifold();
  arena = new Arena();
  kernel = createKernel(wasm, arena);
});

afterAll(() => {
  arena.dispose();
});

/** Unit square profile sitting at radial x ∈ [1, 2]: area 1, centroid x 1.5. */
const SQUARE_PROFILE: ProfilePolygon = [
  [1, 0],
  [2, 0],
  [2, 1],
  [1, 1],
];

describe("sweepRounded", () => {
  it("matches the closed-form volume for a square profile", () => {
    const path = { widthMm: 10, lengthMm: 20 };
    const swept = sweepRounded(kernel, SQUARE_PROFILE, path, 32);

    expect(swept.status()).toBe("NoError");
    const expected = sweptVolumeClosedForm(1, 1.5, path, 32);
    expect(Math.abs(swept.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("matches the closed form for an asymmetric profile and finer segments", () => {
    // A right triangle: area ½, centroid x = 3 + 2/3.
    const triangle: ProfilePolygon = [
      [3, 0],
      [4, 0],
      [3, 1],
    ];
    const path = { widthMm: 8, lengthMm: 14 };
    const swept = sweepRounded(kernel, triangle, path, 64);

    const area = polygonArea(triangle);
    const [centroidX] = polygonCentroid(triangle);
    const expected = sweptVolumeClosedForm(area, centroidX, path, 64);
    expect(Math.abs(swept.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("has an exact bounding box: path plus profile extents", () => {
    const path = { widthMm: 10, lengthMm: 20 };
    const swept = sweepRounded(kernel, SQUARE_PROFILE, path, 32);
    const box = swept.boundingBox();

    // x, y: half-path + outermost profile x = 5+2, 10+2. z: profile y range.
    expect(box.min[0]).toBeCloseTo(-7, 9);
    expect(box.max[0]).toBeCloseTo(7, 9);
    expect(box.min[1]).toBeCloseTo(-12, 9);
    expect(box.max[1]).toBeCloseTo(12, 9);
    expect(box.min[2]).toBeCloseTo(0, 9);
    expect(box.max[2]).toBeCloseTo(1, 9);
  });

  it("produces a torus: genus 1", () => {
    const swept = sweepRounded(kernel, SQUARE_PROFILE, { widthMm: 10, lengthMm: 10 }, 32);
    expect(swept.genus()).toBe(1);
  });

  it("keeps an axis-touching profile watertight (the base profile shape)", () => {
    // Simplified base-like profile touching the sweep path at x = 0.
    const profile: ProfilePolygon = [
      [0.8, 0],
      [1.6, 0.8],
      [1.6, 2.6],
      [3.75, 4.75],
      [0, 4.75],
      [0, 0],
    ];
    const path = { widthMm: 34, lengthMm: 34 };
    const swept = sweepRounded(kernel, profile, path, 32);

    expect(swept.status()).toBe("NoError");
    expect(swept.genus()).toBe(1);

    const area = polygonArea(profile);
    const [centroidX] = polygonCentroid(profile);
    const expected = sweptVolumeClosedForm(area, centroidX, path, 32);
    expect(Math.abs(swept.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("rejects clockwise, axis-crossing, and degenerate inputs", () => {
    const clockwise: ProfilePolygon = [...SQUARE_PROFILE].reverse();
    expect(() =>
      sweepRounded(kernel, clockwise, { widthMm: 10, lengthMm: 10 }, 32),
    ).toThrow(/counter-clockwise/);

    const crossing: ProfilePolygon = [
      [-0.5, 0],
      [1, 0],
      [1, 1],
      [-0.5, 1],
    ];
    expect(() =>
      sweepRounded(kernel, crossing, { widthMm: 10, lengthMm: 10 }, 32),
    ).toThrow(/x must be/);

    expect(() =>
      sweepRounded(kernel, SQUARE_PROFILE, { widthMm: 0, lengthMm: 10 }, 32),
    ).toThrow(/positive/);

    expect(() =>
      sweepRounded(kernel, SQUARE_PROFILE, { widthMm: 10, lengthMm: 10 }, 12),
    ).toThrow(/multiple of 8/);
  });
});
