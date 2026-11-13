import { describe, expect, it } from "vitest";

import { compareContours } from "./contour-metrics";
import { smoothAcceptedPolygon } from "./outline-smoothing";
import type { Outline, Ring } from "./types";

/** A circle whose radius ripples, so half of it is bumps and half is dips. */
const rippled = (cx: number, cy: number, radius: number, amplitude: number, waves: number, count = 720): Ring =>
  Array.from({ length: count }, (_, i) => {
    const angle = i * 2 * Math.PI / count, r = radius + amplitude * Math.sin(angle * waves);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

const radii = (ring: Ring, cx: number, cy: number) => ring.map((p) => Math.hypot(p.x - cx, p.y - cy));

/** How far `result` lies inside `source` at its worst point, and how far outside. */
function movement(result: Outline, source: Outline): { inward: number; outward: number } {
  const compared = compareContours(result, source, { spacing: 0.05 });
  return { inward: Math.max(compared.missingMax ?? 0, compared.cutInMax ?? 0), outward: compared.excessMax ?? 0 };
}

describe("smoothAcceptedPolygon", () => {
  const source: Outline = [{ outer: rippled(50, 50, 30, 0.3, 24), holes: [] }];

  it("averages bumps and dips alike by default, within the allowance", () => {
    const result = smoothAcceptedPolygon(source, 0.4, 0.1);
    const r = radii(result[0].outer, 50, 50);
    // The ripple is flattened from both sides.
    expect(Math.max(...r)).toBeLessThan(30.2);
    expect(Math.min(...r)).toBeGreaterThan(29.8);
    const moved = movement(result, source);
    expect(Math.max(moved.inward, moved.outward)).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it("fills the dips and leaves the bumps when inward movement is not allowed", () => {
    const result = smoothAcceptedPolygon(source, 0.4, 0.1, 0);
    const r = radii(result[0].outer, 50, 50);
    // The bumps keep their height; the dips come up towards the mean.
    expect(Math.max(...r)).toBeGreaterThan(30.29);
    expect(Math.min(...r)).toBeGreaterThan(29.8);
    // Nothing of the source is left outside the result: no material is trimmed.
    const moved = movement(result, source);
    expect(moved.inward).toBeLessThan(0.01);
    expect(moved.outward).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it("caps inward movement at its own allowance", () => {
    const result = smoothAcceptedPolygon(source, 0.4, 0.1, 0.05);
    const moved = movement(result, source);
    expect(moved.inward).toBeLessThanOrEqual(0.05 + 0.01);
    expect(moved.inward).toBeGreaterThan(0.02);
  });

  it("treats a hole the other way round: it may close in on itself, not grow into the material", () => {
    const square: Ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const hole = rippled(50, 50, 20, 0.3, 16).reverse();
    const result = smoothAcceptedPolygon([{ outer: square, holes: [hole] }], 0.4, 0.1, 0);
    const r = radii(result[0].holes[0], 50, 50);
    // The hole's widest points stay put and its narrowest points do not widen: material only grows.
    expect(Math.max(...r)).toBeLessThanOrEqual(20.3 + 1e-6);
    expect(Math.max(...r)).toBeLessThan(20.15);
    expect(Math.min(...r)).toBeGreaterThan(19.69);
    expect(Math.min(...r)).toBeLessThan(19.72);
    // The square's sharp corners stop the filter, so the outer ring is unchanged in shape.
    expect(compareContours([{ outer: result[0].outer, holes: [] }], [{ outer: square, holes: [] }], { spacing: 0.5 }).distanceP95).toBeLessThan(1e-6);
  });

  it("rejects a ring it cannot smooth", () => {
    expect(() => smoothAcceptedPolygon([{ outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }], holes: [] }], 0.2, 0.1)).toThrow();
    expect(() => smoothAcceptedPolygon([{ outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: NaN, y: 1 }], holes: [] }], 0.2, 0.1)).toThrow();
  });
});
