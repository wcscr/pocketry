import { describe, expect, it } from "vitest";

import { distanceToSegment, ringArea, signedArea } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

import { applyRigid, fitOutlineRigid, rigidPoint, type RigidTransform } from "./outline-fit";

/** A wrench-like silhouette: long handle, jaw at one end, nothing symmetric about it. */
const WRENCH: Ring = [
  { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 130, y: -14 }, { x: 158, y: -18 }, { x: 150, y: -4 }, { x: 150, y: 16 },
  { x: 162, y: 30 }, { x: 132, y: 28 }, { x: 120, y: 14 }, { x: 0, y: 14 }, { x: -8, y: 7 },
];
const outline = (ring: Ring, holes: Ring[] = []): Outline => [{ outer: ring, holes }];
const pose = (radians: number, shift: Point, pivot: Point = { x: 60, y: 7 }): RigidTransform => ({ radians, pivot, shift });
const degrees = (radians: number) => radians * 180 / Math.PI;
/** Largest distance from the vertices of `a` to the boundary of `b`. */
const worstGap = (a: Ring, b: Ring) => Math.max(...a.map(point =>
  Math.min(...b.map((start, index) => distanceToSegment(point, start, b[(index + 1) % b.length])))));

describe("rigidPoint and applyRigid", () => {
  it("turn about the pivot, then shift, keeping size and winding", () => {
    expect(rigidPoint({ x: 10, y: 0 }, { radians: Math.PI / 2, pivot: { x: 0, y: 0 }, shift: { x: 5, y: 1 } })).toEqual({ x: expect.closeTo(5, 9), y: expect.closeTo(11, 9) });
    const moved = applyRigid(outline(WRENCH, [[{ x: 20, y: 4 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 4 }]]), pose(1.1, { x: 40, y: -25 }));
    expect(ringArea(moved[0].outer)).toBeCloseTo(ringArea(WRENCH), 6);
    expect(Math.sign(signedArea(moved[0].outer))).toBe(Math.sign(signedArea(WRENCH)));
    expect(Math.sign(signedArea(moved[0].holes[0]))).toBe(-Math.sign(signedArea(WRENCH)));
  });

  it("a move without a turn only adds the shift", () => {
    const point = { x: 14.666666666666668, y: 121.33333333333334 };
    expect(rigidPoint(point, { radians: 0, pivot: { x: 97.3, y: 41.9 }, shift: { x: 8, y: -0.25 } })).toEqual({ x: point.x + 8, y: point.y - 0.25 });
  });
});

describe("fitOutlineRigid", () => {
  it.each([0, 17, 90, 143, 180, 205, 311])("recovers a turn of %s° and a shift exactly when the shapes are the same", angle => {
    const truth = pose(angle * Math.PI / 180, { x: 310, y: -45 });
    const reference = applyRigid(outline(WRENCH), truth);
    const fit = fitOutlineRigid(outline(WRENCH), reference)!;
    const fitted = applyRigid(outline(WRENCH), fit)[0].outer;
    expect(worstGap(fitted, reference[0].outer)).toBeLessThan(0.01);
    expect(fit.typicalGap).toBeLessThan(0.01);
    const off = Math.atan2(Math.sin(fit.radians - truth.radians), Math.cos(fit.radians - truth.radians));
    expect(Math.abs(degrees(off))).toBeLessThan(0.01);
  });

  it("returns the turn as the shortest way round", () => {
    const fit = fitOutlineRigid(outline(WRENCH), applyRigid(outline(WRENCH), pose(350 * Math.PI / 180, { x: 0, y: 0 })))!;
    expect(degrees(fit.radians)).toBeCloseTo(-10, 2);
  });

  it("never scales: a larger reference is centered on, not matched in size", () => {
    const larger = outline(WRENCH.map(point => ({ x: point.x * 1.08 + 200, y: point.y * 1.08 + 90 })));
    const fit = fitOutlineRigid(outline(WRENCH), larger)!;
    const fitted = applyRigid(outline(WRENCH), fit);
    expect(ringArea(fitted[0].outer)).toBeCloseTo(ringArea(WRENCH), 6);
    expect(Math.abs(degrees(fit.radians))).toBeLessThan(1);
    expect(fit.typicalGap).toBeGreaterThan(0.2);
    expect(fit.typicalGap).toBeLessThan(6);
  });

  it("tolerates a rough reference: jitter, a shadow bulge and a different vertex count", () => {
    const truth = pose(64 * Math.PI / 180, { x: 150, y: 220 });
    const exact = applyRigid(outline(WRENCH), truth)[0].outer;
    // Densify, jitter every point by up to half a unit, and push one stretch outward like a shadow.
    const rough: Ring = [];
    exact.forEach((point, index) => {
      const next = exact[(index + 1) % exact.length];
      for (let step = 0; step < 6; step++) {
        const t = step / 6, wobble = Math.sin(index * 12.9898 + step * 78.233) * 0.5;
        const bulge = index === 9 ? 5 * Math.sin(Math.PI * t) : 0;
        const nx = next.y - point.y, ny = -(next.x - point.x), length = Math.hypot(nx, ny) || 1;
        rough.push({ x: point.x + (next.x - point.x) * t + (nx / length) * (bulge + wobble), y: point.y + (next.y - point.y) * t + (ny / length) * (bulge + wobble) });
      }
    });
    const fit = fitOutlineRigid(outline(WRENCH), outline(rough))!;
    const off = Math.atan2(Math.sin(fit.radians - truth.radians), Math.cos(fit.radians - truth.radians));
    expect(Math.abs(degrees(off))).toBeLessThan(1.5);
    expect(worstGap(applyRigid(outline(WRENCH), fit)[0].outer, exact)).toBeLessThan(2);
    expect(fit.typicalGap).toBeLessThan(1);
  });

  it("uses the largest contour of each outline and moves every contour with it", () => {
    const hole: Ring = [{ x: 20, y: 4 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 4 }];
    const speck: Ring = [{ x: 400, y: 400 }, { x: 403, y: 400 }, { x: 403, y: 403 }];
    const truth = pose(-0.6, { x: 80, y: 140 });
    const moving: Outline = [{ outer: WRENCH, holes: [hole] }, { outer: [{ x: 200, y: 0 }, { x: 215, y: 0 }, { x: 215, y: 12 }], holes: [] }];
    const reference: Outline = [...applyRigid(outline(WRENCH), truth), { outer: speck, holes: [] }];
    const fit = fitOutlineRigid(moving, reference)!;
    const fitted = applyRigid(moving, fit), expected = applyRigid(moving, truth);
    fitted.forEach((shape, index) => {
      expect(worstGap(shape.outer, expected[index].outer)).toBeLessThan(0.02);
      shape.holes.forEach((ring, at) => expect(worstGap(ring, expected[index].holes[at])).toBeLessThan(0.02));
    });
  });

  it("settles on one of the equally good poses of a symmetric shape", () => {
    const rectangle: Ring = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }, { x: 0, y: 30 }];
    const reference = applyRigid(outline(rectangle), pose(0.4, { x: 30, y: 30 }, { x: 40, y: 15 }));
    const fit = fitOutlineRigid(outline(rectangle), reference)!;
    expect(worstGap(applyRigid(outline(rectangle), fit)[0].outer, reference[0].outer)).toBeLessThan(0.01);
  });

  it("has nothing to fit without a usable contour on both sides", () => {
    expect(fitOutlineRigid([], outline(WRENCH))).toBeNull();
    expect(fitOutlineRigid(outline(WRENCH), [])).toBeNull();
    expect(fitOutlineRigid(outline(WRENCH), outline([{ x: 0, y: 0 }, { x: 1, y: 1 }]))).toBeNull();
  });
});
