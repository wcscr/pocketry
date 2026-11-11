import { expect, it } from "vitest";
import { compareContours, outlineRoughness, sampleRing } from "./contour-metrics";
import { curvesFromOutline, sampleCurves } from "./curves";
import { reconstructDetectedForEditing } from "./detected-cleanup";
import { simplifyAcceptedOutline } from "./outline-simplification";
import calipers from "./fixtures/accepted-calipers-outline.json";

const circle = [{ outer: Array.from({ length: 256 }, (_, i) => ({
  x: 50 + 40 * Math.cos(i * Math.PI / 128), y: 50 + 40 * Math.sin(i * Math.PI / 128),
})), holes: [] }];

it("actually reduces ripple amplitude progressively across all three levels", () => {
  const outline = [{ outer: Array.from({ length: 256 }, (_, i) => {
    const angle = i * Math.PI / 128, radius = 10 + .15 * Math.sin(angle * 23);
    return { x: 20 + radius * Math.cos(angle), y: 20 + radius * Math.sin(angle) };
  }), holes: [] }];
  const amplitudes = [.05, .1, .2].map(tolerance => {
    const result = simplifyAcceptedOutline({ source: curvesFromOutline(outline), tolerance, sampleTolerance: .025, editableCurves: false });
    const radii = sampleRing(sampleCurves(result.curves)[0].outer, .05).map(p => Math.hypot(p.x - 20, p.y - 20));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    return Math.sqrt(radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length);
  });
  // This measures the shape, independently of point count and runtime guards.
  expect(amplitudes[1]).toBeLessThan(amplitudes[0] * .9);
  expect(amplitudes[2]).toBeLessThan(amplitudes[1] * .5);
});

it.each([.5, 1, 2])("keeps rounded edges finely sampled even at a %s-unit allowance", tolerance => {
  const source = curvesFromOutline(circle), before = structuredClone(source);
  const result = simplifyAcceptedOutline({ source, tolerance, sampleTolerance: .025, editableCurves: false });
  const ring = sampleCurves(result.curves)[0].outer;
  // A large distance allowance alone permits a visibly faceted polygon. Check
  // actual turning angles too, independently of the fitter's distance bound.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
    const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: c.x - b.x, y: c.y - b.y };
    expect(Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y))).toBeLessThan(.15);
  }
  expect(result.curves[0].outer.every(a => !a.in && !a.out)).toBe(true);
  expect(result.maxDeviation).toBeLessThanOrEqual(tolerance);
  expect(source).toEqual(before);
});

it.each([false, true])("bounds movement from existing native curves (editable curves: %s)", editableCurves => {
  const source = reconstructDetectedForEditing(curvesFromOutline(circle), circle, .1, true).curves;
  const result = simplifyAcceptedOutline({ source, tolerance: .2, sampleTolerance: .025, editableCurves });
  const distance = compareContours(sampleCurves(result.curves, .001), sampleCurves(source, .001), { spacing: .05 });
  expect(Math.max(distance.missingMax!, distance.excessMax!, distance.cutInMax!)).toBeLessThanOrEqual(.2);
  expect(result.maxDeviation).toBeLessThanOrEqual(.2);
  expect(result.before).toBe(source[0].outer.length);
});

it("preserves separate shapes, holes and sharp rectangular corners", () => {
  const box = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];
  const outline = [{ outer: box(0, 0, 40), holes: [box(10, 10, 10).reverse()] }, { outer: box(50, 0, 10), holes: [] }];
  const result = simplifyAcceptedOutline({ source: curvesFromOutline(outline), tolerance: .2, sampleTolerance: .025, editableCurves: false });
  expect(sampleCurves(result.curves)).toEqual(outline);
});

it("rejects invalid allowances without changing the current outline", () => {
  const source = curvesFromOutline(circle), before = structuredClone(source);
  for (const value of [0, -1, NaN, Infinity]) {
    expect(() => simplifyAcceptedOutline({ source, tolerance: value, sampleTolerance: .025 })).toThrow();
    expect(() => simplifyAcceptedOutline({ source, tolerance: .2, sampleTolerance: value })).toThrow();
  }
  expect(source).toEqual(before);
});

it("does not reintroduce caliper ripples when increasing the preset", () => {
  const source = curvesFromOutline(calipers.outline), before = structuredClone(source);
  const rough = (curves: typeof source) => outlineRoughness(sampleCurves(curves), {
    spacing: .05 / calipers.mmPerPx, scale: .5 / calipers.mmPerPx, minAmplitude: .05 / calipers.mmPerPx });
  let previous = rough(source);
  for (const amount of [.05, .1, .2]) {
    const result = simplifyAcceptedOutline({ source, tolerance: amount / calipers.mmPerPx,
      sampleTolerance: .025 / calipers.mmPerPx, editableCurves: false });
    const current = rough(result.curves);
    expect(current.reversals).toBeLessThanOrEqual(previous.reversals);
    expect(current.jaggedLength).toBeLessThanOrEqual(previous.jaggedLength + .05 / calipers.mmPerPx);
    previous = current;
  }
  expect(source).toEqual(before);
});
