import { expect, it } from "vitest";
import { curvesFromOutline } from "./curves";
import { distanceToSegment } from "./rings";
import { simplifyContour, simplifyDetectedOutline } from "./contour-simplification";

const rounded = [{ outer: Array.from({ length: 512 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 256), y: 50 + 40 * Math.sin(i * Math.PI / 256) })), holes: [] }];
it("defaults to a bounded point approximation without producing curve handles", () => {
  const source = curvesFromOutline(rounded), before = structuredClone(source);
  const result = simplifyDetectedOutline(source, rounded, .6), ring = result.curves[0].outer.map(a => a.point);
  expect(result.cubics).toBe(0); expect(result.after).toBeLessThan(40); expect(result.after).toBeGreaterThan(12);
  expect(result.curves[0].outer.every(a => !a.in && !a.out)).toBe(true); expect(result.maxDeviation).toBeLessThanOrEqual(.6);
  for (const p of rounded[0].outer) expect(Math.min(...ring.map((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length])))).toBeLessThanOrEqual(.6 + 1e-9);
  expect(source).toEqual(before);
});
it("simplifies a selected adjacent section while keeping the other half and other contours", () => {
  const source = curvesFromOutline([...rounded, { outer: [{ x: 200, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 10 }, { x: 200, y: 10 }], holes: [] }]);
  const result = simplifyContour(source, { shapeIndex: 0, ringIndex: -1 }, { kind: "range", start: 0, end: 128 }, .6);
  expect(result.curves[0].outer.length).toBeLessThan(512); expect(result.curves[1]).toEqual(source[1]);
  expect(result.curves[0].outer.slice(-383)).toEqual(source[0].outer.slice(129));
  expect(result.curves[0].outer.every(a => !a.in && !a.out)).toBe(true);
});
it("rejects collapse and invalid precision atomically", () => {
  const source = curvesFromOutline(rounded);
  expect(() => simplifyDetectedOutline(source, rounded, 200)).toThrow(/collapse/);
  for (const tolerance of [0, -1, NaN]) expect(() => simplifyDetectedOutline(source, rounded, tolerance)).toThrow();
  expect(source[0].outer).toHaveLength(512);
});
