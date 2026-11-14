import { describe, expect, it } from "vitest";

import {
  compareContours,
  distanceToOutlineBoundary,
  isLoopback,
  outlineRoughness,
  pointInOutline,
  sampleOutlineBoundary,
  sampleRing,
  scaleOutline,
} from "./contour-metrics";
import { ringPerimeter } from "./rings";
import type { Outline, Ring } from "./types";

/** Axis-aligned rectangle wound as an outer ring in the y-down image frame. */
function rect(x0: number, y0: number, x1: number, y1: number): Ring {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
const shell = (outer: Ring, holes: Ring[] = []): Outline => [{ outer, holes }];

const square = shell(rect(0, 0, 10, 10));
const options = { spacing: 0.05, tolerances: [0.5, 1.5] };

describe("sampleRing", () => {
  it("spaces samples evenly around the closed ring", () => {
    const ring = rect(0, 0, 10, 10);
    const samples = sampleRing(ring, 1);
    expect(samples).toHaveLength(ringPerimeter(ring));
    expect(samples[0]).toEqual({ x: 0.5, y: 0 });
    // The closing edge is sampled too.
    expect(samples.at(-1)).toEqual({ x: 0, y: 0.5 });
  });

  it("keeps a ring that is shorter than half a step", () => {
    expect(sampleRing(rect(0, 0, 0.01, 0.01), 1)).toHaveLength(1);
  });

  it("returns nothing for a degenerate ring and rejects a non-positive spacing", () => {
    expect(sampleRing([{ x: 1, y: 1 }], 1)).toEqual([]);
    expect(() => sampleRing(rect(0, 0, 1, 1), 0)).toThrow();
    expect(() => sampleRing(rect(0, 0, 1, 1), Number.NaN)).toThrow();
  });
});

describe("pointInOutline and distanceToOutlineBoundary", () => {
  const holed = shell(rect(0, 0, 10, 10), [rect(4, 4, 6, 6).reverse()]);

  it("treats a hole as outside and samples its boundary", () => {
    expect(pointInOutline(holed, { x: 1, y: 1 })).toBe(true);
    expect(pointInOutline(holed, { x: 5, y: 5 })).toBe(false);
    expect(pointInOutline(holed, { x: 11, y: 5 })).toBe(false);
    expect(distanceToOutlineBoundary(holed, { x: 5, y: 5 })).toBeCloseTo(1);
    expect(sampleOutlineBoundary(holed, 1)).toHaveLength(40 + 8);
  });

  it("reports an infinite distance to an empty outline", () => {
    expect(distanceToOutlineBoundary([], { x: 0, y: 0 })).toBe(Infinity);
  });
});

describe("compareContours", () => {
  it("scores identical outlines as a perfect match", () => {
    const result = compareContours(square, square, options);
    expect(result.signedOffsetMean).toBeCloseTo(0);
    expect(result.missingMax).toBe(0);
    expect(result.excessMax).toBe(0);
    expect(result.distanceP95).toBeCloseTo(0);
    expect(result.scores.map((score) => score.f)).toEqual([1, 1]);
    expect(result.shellDelta).toBe(0);
  });

  it("reports a uniformly larger candidate as positive offset and excess, with nothing missing", () => {
    const result = compareContours(shell(rect(-1, -1, 11, 11)), square, options);
    expect(result.signedOffsetMedian).toBeCloseTo(1, 5);
    expect(result.signedOffsetMean).toBeGreaterThan(1);
    expect(result.excessMax).toBeCloseTo(Math.SQRT2, 1);
    expect(result.missingMax).toBe(0);
    // One unit out fails a 0.5 tolerance and passes a 1.5 tolerance.
    expect(result.scores[0].f).toBe(0);
    expect(result.scores[1].f).toBe(1);
  });

  it("reports a uniformly smaller candidate as negative offset and missing material", () => {
    const result = compareContours(shell(rect(1, 1, 9, 9)), square, options);
    expect(result.signedOffsetMedian).toBeCloseTo(-1, 5);
    expect(result.excessMax).toBe(0);
    expect(result.missingMax).toBeCloseTo(Math.SQRT2, 1);
  });

  it("measures a lost thin feature by how far it sticks out, not by its width", () => {
    // A 10 x 10 body with a 1-wide, 20-long shaft. The candidate keeps only the body.
    const withShaft = shell([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.5 }, { x: 30, y: 4.5 },
      { x: 30, y: 5.5 }, { x: 10, y: 5.5 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    const result = compareContours(square, withShaft, options);
    expect(result.missingMax).toBeGreaterThan(19.9);
    expect(result.missingMax).toBeLessThan(20.1);
    expect(result.excessMax).toBe(0);
    // The candidate's own boundary barely moves, which is why offset alone hides this.
    expect(Math.abs(result.signedOffsetMean ?? 1)).toBeLessThan(0.05);
  });

  it("measures an attached spur as excess", () => {
    const withSpur = shell([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.5 }, { x: 16, y: 4.5 },
      { x: 16, y: 5.5 }, { x: 10, y: 5.5 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    const result = compareContours(withSpur, square, options);
    expect(result.excessMax).toBeCloseTo(6, 1);
    expect(result.missingMax).toBe(0);
  });

  it("counts extra and missing shells", () => {
    const two: Outline = [...square, ...shell(rect(20, 0, 22, 2))];
    expect(compareContours(two, square, options).shellDelta).toBe(1);
    expect(compareContours(square, two, options).shellDelta).toBe(-1);
  });

  it("reports an empty candidate without throwing, and rejects an empty reference", () => {
    const result = compareContours([], square, options);
    expect(result.candidateSamples).toBe(0);
    expect(result.missingMax).toBeNull();
    expect(result.signedOffsetMean).toBeNull();
    expect(result.scores.every((score) => score.f === 0 && score.recall === 0)).toBe(true);
    expect(() => compareContours(square, [], options)).toThrow();
  });

  it("scales linearly with the outlines, so pixels convert to millimetres by one factor", () => {
    const candidate = shell(rect(-1, -1, 11, 11));
    const pixels = compareContours(candidate, square, { spacing: 0.05 });
    const millimetres = compareContours(scaleOutline(candidate, 0.25), scaleOutline(square, 0.25), { spacing: 0.0125 });
    expect(millimetres.signedOffsetMedian).toBeCloseTo((pixels.signedOffsetMedian ?? 0) * 0.25, 5);
    expect(millimetres.excessMax).toBeCloseTo((pixels.excessMax ?? 0) * 0.25, 5);
    expect(millimetres.candidateSamples).toBe(pixels.candidateSamples);
  });
});

describe("cut-ins and excursions", () => {
  const measure = (candidate: Outline) => compareContours(candidate, square, { spacing: 0.05, excursionThreshold: 0.5 });

  it("measures a narrow slit by its depth, which missing does not see", () => {
    // A 0.4-wide slit cut 3 deep into the top edge.
    const slit = shell([
      { x: 0, y: 0 }, { x: 4.8, y: 0 }, { x: 4.8, y: 3 }, { x: 5.2, y: 3 },
      { x: 5.2, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    const result = measure(slit);
    expect(result.cutInMax).toBeCloseTo(3, 5);
    expect(result.missingMax).toBeLessThan(0.25);
    expect(result.excessMax).toBe(0);
    expect(result.excursions).toHaveLength(1);
    const [excursion] = result.excursions;
    expect(excursion.side).toBe("inside");
    expect(excursion.depth).toBeCloseTo(3, 5);
    expect(excursion.mouth).toBeCloseTo(0.4, 1);
    expect(excursion.length).toBeCloseTo(5.4, 1);
    expect(isLoopback(excursion, 1)).toBe(true);
  });

  it("reports a spur as a loopback on the outside", () => {
    const withSpur = shell([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.5 }, { x: 16, y: 4.5 },
      { x: 16, y: 5.5 }, { x: 10, y: 5.5 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    const result = measure(withSpur);
    // Samples lying on the shared boundary are within rounding of zero.
    expect(result.cutInMax).toBeCloseTo(0, 9);
    expect(result.excursions).toHaveLength(1);
    expect(result.excursions[0]).toMatchObject({ side: "outside" });
    expect(result.excursions[0].depth).toBeCloseTo(6, 1);
    expect(result.excursions[0].mouth).toBeCloseTo(1, 1);
    expect(isLoopback(result.excursions[0], 1)).toBe(true);
    // Too shallow to count at a 7-unit minimum.
    expect(isLoopback(result.excursions[0], 7)).toBe(false);
  });

  it("does not call a bite that is wider than it is deep a loopback", () => {
    const bite = shell([
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 8, y: 2 },
      { x: 8, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    const result = measure(bite);
    expect(result.cutInMax).toBeCloseTo(2, 5);
    expect(result.excursions).toHaveLength(1);
    expect(result.excursions[0].mouth).toBeCloseTo(6, 1);
    expect(isLoopback(result.excursions[0], 1)).toBe(false);
  });

  it("reports a ring that never returns with an unbounded mouth", () => {
    const result = measure(shell(rect(-1, -1, 11, 11)));
    expect(result.excursions).toHaveLength(1);
    expect(result.excursions[0].mouth).toBe(Infinity);
    expect(result.excursions[0].length).toBeCloseTo(48, 5);
    expect(isLoopback(result.excursions[0], 1)).toBe(false);
  });

  it("reports no excursions without a threshold or within it, and rejects a negative one", () => {
    expect(compareContours(shell(rect(-1, -1, 11, 11)), square, { spacing: 0.05 }).excursions).toEqual([]);
    expect(measure(shell(rect(-0.25, -0.25, 10.25, 10.25))).excursions).toEqual([]);
    expect(compareContours([], square, { spacing: 0.05, excursionThreshold: 0.5 })).toMatchObject({ cutInMax: null, excursions: [] });
    expect(() => compareContours(square, square, { spacing: 0.05, excursionThreshold: -1 })).toThrow();
  });
});

describe("outlineRoughness", () => {
  const settings = { spacing: 0.05, scale: 0.5, minAmplitude: 0.05 };
  const jog = (height: number) => shell([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: height }, { x: 20, y: height }, { x: 20, y: 20 }, { x: 0, y: 20 },
  ]);

  it("finds nothing jagged in a circle or a square", () => {
    const circle = shell(Array.from({ length: 720 }, (_, i) => ({ x: 10 * Math.cos(i * Math.PI / 360), y: 10 * Math.sin(i * Math.PI / 360) })));
    for (const outline of [circle, square]) {
      expect(outlineRoughness(outline, settings)).toMatchObject({ jaggedLength: 0, jaggedShare: 0, reversals: 0, ripple: 0, rippleMax: 0 });
    }
    expect(outlineRoughness(square, settings).perimeter).toBeCloseTo(40, 5);
  });

  it("marks the whole of a zigzag edge and none of the straight ones", () => {
    // Top edge 20 long, zigzagging 0.4 peak to peak; the other three edges are straight.
    const zigzag = shell([...Array.from({ length: 21 }, (_, i) => ({ x: i, y: i % 2 ? 0.4 : 0 })), { x: 20, y: 20 }, { x: 0, y: 20 }]);
    const result = outlineRoughness(zigzag, settings);
    expect(result.jaggedLength).toBeGreaterThan(20);
    expect(result.jaggedLength).toBeLessThan(23);
    expect(result.reversals).toBeGreaterThanOrEqual(18);
    expect(result.reversals).toBeLessThanOrEqual(21);
    expect(result.ripple).toBeGreaterThan(0.2);
    expect(result.ripple).toBeLessThanOrEqual(0.4);
  });

  it("marks every step of a one-pixel staircase", () => {
    // A 45-degree edge drawn as forty 0.25 steps.
    const steps = Array.from({ length: 40 }, (_, i) => [{ x: i * 0.25, y: i * 0.25 }, { x: (i + 1) * 0.25, y: i * 0.25 }]).flat();
    const result = outlineRoughness(shell([...steps, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: -10, y: 30 }, { x: -10, y: 0 }]), settings);
    expect(result.jaggedLength).toBeGreaterThan(19);
    expect(result.jaggedLength).toBeLessThan(21.5);
    expect(result.reversals).toBeGreaterThan(70);
    expect(result.ripple).toBeGreaterThan(0.1);
    expect(result.ripple).toBeLessThan(0.25);
  });

  it("counts one small jog once, at about its height", () => {
    const result = outlineRoughness(jog(0.25), settings);
    expect(result.reversals).toBe(1);
    expect(result.ripple).toBeGreaterThan(0.2);
    expect(result.ripple).toBeLessThanOrEqual(0.25);
    expect(result.jaggedLength).toBeGreaterThan(1);
    expect(result.jaggedLength).toBeLessThan(2);
  });

  it("under-reports a jog larger than the scale, and treats a long step as shape", () => {
    const one = outlineRoughness(jog(1), settings);
    expect(one.reversals).toBe(1);
    expect(one.ripple).toBeGreaterThan(0.4);
    expect(one.ripple).toBeLessThan(0.7);
    expect(outlineRoughness(jog(3), settings).reversals).toBe(0);
  });

  it("ignores swings below the amplitude floor", () => {
    expect(outlineRoughness(jog(0.25), { ...settings, minAmplitude: 0.2 }).reversals).toBe(0);
  });

  it("scales with the outline, and reports an empty or tiny outline as smooth", () => {
    const pixels = outlineRoughness(scaleOutline(jog(0.25), 4), { spacing: 0.2, scale: 2, minAmplitude: 0.2 });
    const millimetres = outlineRoughness(jog(0.25), settings);
    expect(pixels.reversals).toBe(millimetres.reversals);
    expect(pixels.jaggedShare).toBeCloseTo(millimetres.jaggedShare, 5);
    expect(pixels.ripple).toBeCloseTo(millimetres.ripple * 4, 5);
    expect(outlineRoughness([], settings)).toMatchObject({ perimeter: 0, jaggedShare: 0, reversals: 0 });
    expect(outlineRoughness(shell(rect(0, 0, 0.05, 0.05)), settings).reversals).toBe(0);
    expect(() => outlineRoughness(square, { ...settings, scale: 0 })).toThrow();
  });
});
