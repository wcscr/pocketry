import { expect, it } from "vitest";
import { curvesFromOutline, sampleCurves } from "./curves";
import { reconstructDetectedForEditing } from "./detected-cleanup";
import { distanceToSegment } from "./rings";

const circle = [{ outer: Array.from({ length: 512 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 256), y: 50 + 40 * Math.sin(i * Math.PI / 256) })), holes: [] }];
it("reconstructs a smooth boundary as bounded points with no authored curve handles", () => {
  const source = curvesFromOutline(circle), before = structuredClone(source), tolerance = .6;
  const result = reconstructDetectedForEditing(source, circle, tolerance, false);
  const ring = result.curves[0].outer.map(a => a.point);
  expect(result.curves[0].outer.every(a => !a.in && !a.out)).toBe(true);
  expect(ring.length).toBeLessThan(128); expect(ring.length).toBeGreaterThan(12);
  for (const p of circle[0].outer)
    expect(Math.min(...ring.map((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length])))).toBeLessThanOrEqual(tolerance);
  expect(result.maxDeviation).toBeLessThanOrEqual(tolerance);
  expect(source).toEqual(before);
});
it("retains native curves only when opted in", () => {
  const result = reconstructDetectedForEditing(curvesFromOutline(circle), circle, .6, true);
  expect(result.curves[0].outer.some(a => a.in || a.out)).toBe(true);
  expect(sampleCurves(result.curves, .025)[0].outer.length).toBeGreaterThan(result.after);
});
it("rejects invalid bounds without mutating the detected source", () => {
  const source = curvesFromOutline(circle), before = structuredClone(source);
  for (const tolerance of [0, -1, NaN]) expect(() => reconstructDetectedForEditing(source, circle, tolerance, false)).toThrow();
  expect(source).toEqual(before);
});
