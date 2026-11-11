import { preservesMaterial } from "@shared/geometry/boundary-contract";
import { describe, expect, it } from "vitest";

import { compareContours, outlineRoughness, pointInOutline, scaleOutline } from "@shared/geometry/contour-metrics";
import { ringPerimeter, signedArea } from "@shared/geometry/rings";
import type { Outline, Ring } from "@shared/geometry/types";

import { ringCrossesItself, smoothOuterBoundary, smoothRingOutward } from "./outer-smoothing";

const shell = (outer: Ring, holes: Ring[] = []): Outline => [{ outer, holes }];
const rect = (x0: number, y0: number, x1: number, y1: number): Ring =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const circle = (r: number, cx = 0, cy = 0, n = 256): Ring =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(i * 2 * Math.PI / n), y: cy + r * Math.sin(i * 2 * Math.PI / n) }));

/** A 60 x 30 block whose top edge climbs in `count` stairs of the given run and riser. */
function staircase(riser: number, run: number, count: number): Ring {
  const ring: Ring = [];
  let x = 0, y = 0;
  for (let i = 0; i < count; i++) { ring.push({ x, y }); x += run; ring.push({ x, y }); y += riser; }
  ring.push({ x, y }, { x, y: y + 30 }, { x: -30, y: y + 30 }, { x: -30, y: 0 });
  return ring;
}
/** A 20 x 20 block with a slot cut into its top edge. */
const slotted = (width: number, depth: number): Ring => [
  { x: 0, y: 0 }, { x: 10 - width / 2, y: 0 }, { x: 10 - width / 2, y: depth }, { x: 10 + width / 2, y: depth },
  { x: 10 + width / 2, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
];
/** A 10 x 10 body with a shaft of the given width sticking 40 out of its side. */
const shafted = (width: number): Ring => [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 - width / 2 }, { x: 50, y: 5 - width / 2 },
  { x: 50, y: 5 + width / 2 }, { x: 10, y: 5 + width / 2 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];

const ROUGHNESS = { spacing: 0.05, scale: 0.5, minAmplitude: 0.05 };
const steps = (outline: Outline) => outlineRoughness(outline, ROUGHNESS).reversals;
/** How far the input reaches outside the result, and how far the result grew beyond the input. */
function moved(input: Outline, result: Outline) {
  return {
    cutOff: compareContours(input, result, { spacing: 0.05 }).excessMax ?? 0,
    grownMean: compareContours(result, input, { spacing: 0.05 }).signedOffsetMean ?? 0,
    grownMax: compareContours(result, input, { spacing: 0.05 }).excessMax ?? 0,
  };
}

describe("smoothOuterBoundary", () => {
  it.each([
    ["one-pixel stairs at 45 degrees", staircase(0.25, 0.25, 80)],
    ["risers every 3 on a shallow edge", staircase(0.35, 3, 12)],
    ["risers every 8 on a very shallow edge", staircase(0.35, 8, 6)],
    ["half-unit risers every 2", staircase(0.5, 2, 15)],
  ])("removes %s without cutting into the shape", (_, ring) => {
    const input = shell(ring), result = smoothOuterBoundary(input, 1);
    expect(steps(input)).toBeGreaterThan(4);
    expect(steps(result)).toBe(0);
    const change = moved(input, result);
    expect(change.cutOff).toBeLessThan(0.04);
    expect(change.grownMean).toBeGreaterThan(0);
    expect(change.grownMean).toBeLessThan(0.08);
    expect(change.grownMax).toBeLessThan(0.5);
    expect(ringCrossesItself(result[0].outer)).toBe(false);
  });

  it.each([.25,.5,1,2,4])("preserves the tip of a pointed extension with base %s", width => {
    const input = shell([{x:0,y:0},{x:20,y:0},{x:20,y:10-width/2},{x:50,y:10},{x:20,y:10+width/2},{x:20,y:20},{x:0,y:20}]);
    const output=smoothOuterBoundary(input,1);
    expect(preservesMaterial(input,output,.05)).toBe(true);
    expect(Math.max(...output[0].outer.map(p=>p.x))).toBeGreaterThanOrEqual(49.95);
  });

  it("keeps a square square, growing most beside its corners", () => {
    const input = shell(rect(0, 0, 20, 20)), result = smoothOuterBoundary(input, 1);
    const change = moved(input, result);
    expect(change.cutOff).toBeLessThan(0.01);
    expect(change.grownMax).toBeGreaterThan(0.1);
    expect(change.grownMax).toBeLessThan(0.4);
    // The corner itself is still reached.
    expect(pointInOutline(result, { x: 0.02, y: 0.02 })).toBe(true);
    expect(Math.abs(signedArea(result[0].outer))).toBeLessThan(400 * 1.02);
  });

  it("keeps a sharp tip, with growth bounded by about two thirds of the length", () => {
    const input = shell([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 10.7 }]), result = smoothOuterBoundary(input, 1);
    const change = moved(input, result);
    expect(change.cutOff).toBeLessThan(0.01);
    expect(change.grownMax).toBeLessThan(0.7);
    expect(pointInOutline(result, { x: 39.9, y: 0.01 })).toBe(true);
  });

  it.each([3, 2, 1, 0.6, 0.3])("keeps a real slot %s wide open to its floor", (width) => {
    const input = shell(slotted(width, 5)), result = smoothOuterBoundary(input, 1);
    expect(ringCrossesItself(result[0].outer)).toBe(false);
    // A narrow slot keeps its traced corners, which the coarser returned sampling clips a little.
    expect(moved(input, result).cutOff).toBeLessThan(0.1);
    // The middle of the slot is still outside the outline most of the way down.
    for (const depth of [1, 2.5, 4]) expect(pointInOutline(result, { x: 10, y: depth })).toBe(false);
  });

  it("does not close the gap between two tips that nearly meet", () => {
    // A 3-thick ring-shaped band, 20 across, broken by a 0.7 gap in its right-hand wall.
    const band: Ring = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 9.65 }, { x: 17, y: 9.65 }, { x: 17, y: 3 }, { x: 3, y: 3 },
      { x: 3, y: 17 }, { x: 17, y: 17 }, { x: 17, y: 10.35 }, { x: 20, y: 10.35 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ];
    const input = shell(band), result = smoothOuterBoundary(input, 1);
    expect(result[0].outer).not.toBe(band);
    expect(ringCrossesItself(result[0].outer)).toBe(false);
    // The gap is as wide as it was: its middle and both edges are still outside the outline.
    for (const y of [9.7, 10, 10.3]) for (const x of [17.5, 18.5, 19.5]) expect(pointInOutline(result, { x, y })).toBe(false);
    // Away from the gap the band is smoothed as usual, growing beside its corners.
    const change = moved(input, result);
    expect(change.grownMax).toBeGreaterThan(0.1);
    expect(change.cutOff).toBeLessThan(0.1);
  });

  it("keeps a slit's width where growth would have narrowed it", () => {
    const input = shell(slotted(0.6, 5)), result = smoothOuterBoundary(input, 1);
    // Still at least 0.5 wide half-way down, where plain growth would leave about 0.4.
    for (const x of [9.75, 10, 10.25]) expect(pointInOutline(result, { x, y: 2.5 })).toBe(false);
  });

  it.each([3, 1, 0.6])("keeps a shaft %s wide, without fattening it along its length", (width) => {
    const input = shell(shafted(width)), result = smoothOuterBoundary(input, 1);
    expect(ringCrossesItself(result[0].outer)).toBe(false);
    expect(moved(input, result).cutOff).toBeLessThan(0.04);
    // The tip is still covered, and mid-shaft the outline is within a tenth of a unit of the wall.
    expect(pointInOutline(result, { x: 49.95, y: 5 })).toBe(true);
    expect(pointInOutline(result, { x: 30, y: 5 + width / 2 + 0.1 })).toBe(false);
    expect(pointInOutline(result, { x: 30, y: 5 - width / 2 - 0.1 })).toBe(false);
  });

  it("leaves a smooth circle where it is", () => {
    for (const radius of [1, 3, 10]) {
      const input = shell(circle(radius)), result = smoothOuterBoundary(input, 1);
      expect(result[0].outer).not.toBe(input[0].outer);
      const change = moved(input, result);
      expect(change.cutOff).toBeLessThan(0.01);
      expect(change.grownMax).toBeLessThan(0.01);
    }
  });

  it("shrinks a hole, so the material only grows", () => {
    for (const radius of [0.3, 1, 5]) {
      const hole = circle(radius, 20, 20).reverse();
      const input = shell(rect(0, 0, 40, 40), [hole]), result = smoothOuterBoundary(input, 1);
      const smoothed = result[0].holes[0];
      expect(signedArea(smoothed)).toBeLessThan(0);
      expect(Math.abs(signedArea(smoothed))).toBeLessThanOrEqual(Math.abs(signedArea(hole)));
      expect(Math.abs(signedArea(smoothed))).toBeGreaterThan(Math.abs(signedArea(hole)) * 0.85);
    }
  });

  it("smooths a stair-stepped hole inward", () => {
    // The staircase block turned inside out: a hole in a large plate.
    const hole = staircase(0.25, 0.25, 40).reverse();
    const input = shell(rect(-60, -30, 60, 80), [hole]), result = smoothOuterBoundary(input, 1);
    const smoothed = result[0].holes[0];
    expect(smoothed).not.toBe(hole);
    expect(outlineRoughness(shell([...smoothed].reverse()), ROUGHNESS).reversals).toBe(0);
    // Every point of the smoothed hole is inside the traced hole.
    expect(Math.abs(signedArea(smoothed))).toBeLessThan(Math.abs(signedArea(hole)));
  });

  it("leaves a hairline hole alone, because it could only bulge", () => {
    const sliver = [{ x: 5, y: 20 }, { x: 5.05, y: 20 }, { x: 5.05, y: 35 }, { x: 5, y: 35 }].reverse();
    const input = shell(rect(0, 0, 40, 40), [sliver]), result = smoothOuterBoundary(input, 1);
    expect(result[0].holes[0]).toBe(sliver);
  });

  it("keeps two tools apart that smoothing would have grown into each other", () => {
    const input: Outline = [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(10.2, 0, 20, 10), holes: [] }];
    const result = smoothOuterBoundary(input, 1);
    expect(result[0].outer).toBe(input[0].outer);
    expect(result[1].outer).toBe(input[1].outer);
    // Farther apart, both are smoothed.
    const apart: Outline = [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(12, 0, 20, 10), holes: [] }];
    expect(smoothOuterBoundary(apart, 1).every((shape, i) => shape.outer !== apart[i].outer)).toBe(true);
  });

  it("keeps each ring's winding and returns an evenly sampled ring", () => {
    const hole = circle(4, 10, 15).reverse();
    const [result] = smoothOuterBoundary(shell(staircase(0.25, 0.25, 80), [hole]), 1);
    expect(signedArea(result.outer)).toBeGreaterThan(0);
    expect(signedArea(result.holes[0])).toBeLessThan(0);
    const lengths = result.outer.map((point, i) => {
      const next = result.outer[(i + 1) % result.outer.length];
      return Math.hypot(next.x - point.x, next.y - point.y);
    });
    // A quarter of the smoothing length, which keeps reconstruction's allowance where it is today.
    expect(Math.max(...lengths)).toBeLessThanOrEqual(0.2501);
    expect(Math.min(...lengths)).toBeGreaterThan(0.2);
  });

  it("works in any unit: scaling the outline and the length scales the result", () => {
    const input = shell(staircase(0.25, 0.25, 80));
    const millimetres = smoothOuterBoundary(input, 1), pixels = smoothOuterBoundary(scaleOutline(input, 4), 4);
    expect(pixels[0].outer).toHaveLength(millimetres[0].outer.length);
    const apart = compareContours(scaleOutline(pixels, 0.25), millimetres, { spacing: 0.05 });
    expect(apart.distanceP95).toBeLessThan(1e-6);
  });

  it("smooths a small ring over a shorter length instead of turning it into a blob", () => {
    const input = shell(rect(0, 0, 2, 1)), result = smoothOuterBoundary(input, 1);
    const change = moved(input, result);
    expect(change.cutOff).toBeLessThan(0.02);
    expect(change.grownMax).toBeLessThan(0.25);
  });

  it("returns finite coordinates for specks far smaller than the smoothing length", () => {
    for (const side of [0.01, 0.05, 0.24, 0.25, 0.5, 1]) {
      const hole = rect(20, 20, 20 + side, 20 + side).reverse();
      const input: Outline = [{ outer: rect(0, 0, side, side), holes: [] }, { outer: rect(10, 10, 50, 50), holes: [hole] }];
      for (const shape of smoothOuterBoundary(input, 1)) {
        for (const ring of [shape.outer, ...shape.holes]) {
          expect(ring.length).toBeGreaterThanOrEqual(3);
          expect(ring.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
        }
      }
    }
  });

  it("trims at most the tip of a spur thinner than the trace can resolve, and stays valid", () => {
    // A 0.1-wide, 3-long hairline leaning off the top edge: an artefact, not a part.
    const input = shell([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.8, y: -3 }, { x: 10.9, y: -3 }, { x: 10.1, y: 0 },
      { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ]), result = smoothOuterBoundary(input, 1);
    expect(ringCrossesItself(result[0].outer)).toBe(false);
    expect(moved(input, result).cutOff).toBeLessThan(1);
    // The body it sits on is untouched.
    expect(pointInOutline(result, { x: 5, y: 0.02 })).toBe(true);
  });

  it("stays under reconstruction's sample limits on a very long outline", () => {
    // 2.4 m of boundary in one ring, and 30 m across many.
    const long = smoothOuterBoundary(shell(rect(0, 0, 1000, 200)), 1);
    expect(long[0].outer.length).toBeLessThanOrEqual(6000);
    const many: Outline = Array.from({ length: 30 }, (_, i) => ({ outer: rect(0, i * 300, 300, i * 300 + 200), holes: [] }));
    const total = smoothOuterBoundary(many, 1).reduce((sum, shape) => sum + shape.outer.length, 0);
    expect(total).toBeLessThanOrEqual(20_000);
    // Bounded certification may keep the original sparse ring on very long edges.
    expect(total).toBeGreaterThanOrEqual(many.reduce((sum,s)=>sum+s.outer.length,0));
  });

  it("returns the outline untouched for a length that is not positive and finite", () => {
    const input = shell(staircase(0.25, 0.25, 8));
    for (const length of [0, -1, Number.NaN, Infinity]) expect(smoothOuterBoundary(input, length)).toBe(input);
    expect(smoothOuterBoundary([], 1)).toEqual([]);
  });
});

describe("smoothRingOutward", () => {
  it("returns a degenerate ring unchanged", () => {
    const line: Ring = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    expect(smoothRingOutward(line, 1)).toBe(line);
    const two: Ring = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(smoothRingOutward(two, 1)).toBe(two);
  });

  it("treats a ring wound the other way as the same material", () => {
    const ring = staircase(0.25, 0.25, 40), reversed = [...ring].reverse();
    const forward = smoothRingOutward(ring, 1), backward = smoothRingOutward(reversed, 1);
    expect(Math.sign(signedArea(backward))).toBe(Math.sign(signedArea(reversed)));
    expect(Math.abs(signedArea(backward))).toBeCloseTo(Math.abs(signedArea(forward)), 1);
    expect(ringPerimeter(backward)).toBeCloseTo(ringPerimeter(forward), 1);
  });
});

describe("ringCrossesItself", () => {
  it("tells a bow-tie from a square", () => {
    expect(ringCrossesItself(rect(0, 0, 4, 4))).toBe(false);
    expect(ringCrossesItself([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toBe(true);
  });
});
