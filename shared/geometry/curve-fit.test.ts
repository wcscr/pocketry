import { describe, expect, it } from "vitest";
import { curveFitRange, fitContour } from "./curve-fit";
import { curveControls, curvesFromOutline, evaluateCurve, mapCurves, sampleCurveRing, type CurveRing } from "./curves";
import { distanceToSegment, pointInRing, signedArea } from "./rings";
import type { Point } from "./types";

const ref = { shapeIndex: 0, ringIndex: -1 };
const circle = (radius: number, count = 96): Point[] => Array.from({ length: count }, (_, i) => ({ x: radius * Math.cos(i * 2 * Math.PI / count), y: radius * Math.sin(i * 2 * Math.PI / count) }));
const arch = () => curvesFromOutline([{ outer: [
  ...Array.from({ length: 41 }, (_, i) => ({ x: 50 + 40 * Math.cos(Math.PI + i * Math.PI / 40), y: 50 + 40 * Math.sin(Math.PI + i * Math.PI / 40) })),
  { x: 90, y: 80 }, { x: 10, y: 80 },
], holes: [] }]);
function dense(ring: CurveRing): Point[] {
  return ring.flatMap((_, i) => Array.from({ length: 100 }, (_, j) => evaluateCurve(curveControls(ring, i), j / 100)));
}
function distance(p: Point, points: Point[]) {
  return Math.min(...points.map((a, i) => distanceToSegment(p, a, points[(i + 1) % points.length])));
}

describe("explicit contour fitting", () => {
  it("fits an adjacent run with fixed endpoints and leaves the complement and source untouched", () => {
    const source = arch(), original = structuredClone(source);
    const fit = fitContour(source, ref, { kind: "range", start: 0, end: 40 }, 0.1);
    expect(fit.changed).toBe(true);
    expect(fit.after).toBeLessThan(12);
    expect(fit.curves[0].outer[0].point).toEqual(source[0].outer[0].point);
    expect(fit.curves[0].outer.at(-3)!.point).toEqual(source[0].outer[40].point);
    expect(fit.curves[0].outer.slice(-2)).toEqual(source[0].outer.slice(-2));
    expect(source).toEqual(original);
    expect(fit.maxDeviation).toBeLessThanOrEqual(0.1);
    for (const p of dense(fit.curves[0].outer)) expect(distance(p, source[0].outer.map(a => a.point))).toBeLessThanOrEqual(0.100001);
  });

  it("supports a range across the closing edge and keeps outward endpoint handles", () => {
    const source = arch();
    source[0].outer = [...source[0].outer.slice(20), ...source[0].outer.slice(0, 20)];
    // 23..42,0..20 is the original arch; the bottom edges stay untouched.
    source[0].outer[23].in = { x: 12, y: 65 };
    source[0].outer[20].out = { x: 88, y: 65 };
    const fit = fitContour(source, ref, { kind: "range", start: 23, end: 20 }, 0.1);
    const first = fit.curves[0].outer.find(a => a.point.x === source[0].outer[23].point.x && a.point.y === source[0].outer[23].point.y)!;
    const last = fit.curves[0].outer.find(a => a.point.x === source[0].outer[20].point.x && a.point.y === source[0].outer[20].point.y)!;
    expect(first.in).toEqual(source[0].outer[23].in);
    expect(last.out).toEqual(source[0].outer[20].out);
    expect(curveFitRange(8, 6, 2)).toEqual([6, 7, 0, 1, 2]);
  });

  it("auto-fits a closed smooth ring, preserves winding and holes, and is repeatable without another edit", () => {
    const source = curvesFromOutline([{ outer: circle(30), holes: [circle(10).reverse()] }]);
    const fit = fitContour(source, ref, { kind: "auto" }, 0.1);
    expect(fit.after).toBeGreaterThanOrEqual(3);
    expect(fit.after).toBeLessThan(20);
    expect(fit.curves[0].holes).toEqual(source[0].holes);
    expect(signedArea(sampleCurveRing(fit.curves[0].outer, 0.001))).toBeGreaterThan(0);
    for (const p of dense(fit.curves[0].outer)) expect(distance(p, source[0].outer.map(a => a.point))).toBeLessThanOrEqual(0.100001);
    expect(fitContour(fit.curves, ref, { kind: "auto" }, 0.1).changed).toBe(false);
    const hole = fitContour(fit.curves, { shapeIndex: 0, ringIndex: 0 }, { kind: "auto" }, 0.05);
    expect(hole.curves[0].outer).toEqual(fit.curves[0].outer);
    expect(signedArea(sampleCurveRing(hole.curves[0].holes[0], 0.001))).toBeLessThan(0);
  });

  it("keeps sharp recesses and true straight edges even with a loose tolerance", () => {
    const points = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      { x: 6, y: 10 }, { x: 6, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const source = curvesFromOutline([{ outer: points, holes: [] }]);
    const fit = fitContour(source, ref, { kind: "auto" }, 5);
    expect(fit.curves[0].outer.map(a => a.point)).toEqual(points.filter((_, i) => i !== 1));
    expect(fit.curves[0].outer.some(a => a.in || a.out)).toBe(false);
  });

  it("keeps existing curves and manual corner anchors during auto-fit", () => {
    const source = arch();
    source[0].outer[10].smooth = false;
    source[0].outer[41].out = { x: 70, y: 90 }; source[0].outer[42].in = { x: 30, y: 90 };
    const fit = fitContour(source, ref, { kind: "auto" }, 0.1);
    expect(fit.curves[0].outer.some(a => a.point.x === source[0].outer[10].point.x && a.smooth === false)).toBe(true);
    expect(fit.curves[0].outer.at(-2)!.out).toEqual(source[0].outer[41].out);
    expect(fit.curves[0].outer.at(-1)!.in).toEqual(source[0].outer[42].in);
    expect(() => fitContour(source, ref, { kind: "range", start: 40, end: 42 }, 0.1)).toThrow(/already contains curves/);
  });

  it("rejects invalid inputs, degenerate ranges and expensive contours without changing them", () => {
    const source = arch();
    for (const tolerance of [0, -1, Infinity, NaN]) expect(() => fitContour(source, ref, { kind: "auto" }, tolerance)).toThrow(/positive/);
    for (const end of [0, 1, 999]) expect(() => fitContour(source, ref, { kind: "range", start: 0, end }, 0.1)).toThrow(/three adjacent/);
    const huge = curvesFromOutline([{ outer: circle(30, 6001), holes: [] }]);
    expect(() => fitContour(huge, ref, { kind: "auto" }, 0.1)).toThrow(/too detailed/);
  });

  it("bounds fit error after calibration and nonuniform placement scaling", () => {
    const source = arch(), scale = 3.4, tolerance = 0.1;
    const fit = fitContour(source, ref, { kind: "auto" }, tolerance / scale);
    const transform = (p: Point) => ({ x: -scale * p.x + 100, y: 0.7 * p.y - 40 });
    const placed = mapCurves(fit.curves, transform)[0].outer;
    for (const p of dense(placed)) expect(distance(p, source[0].outer.map(a => transform(a.point)))).toBeLessThanOrEqual(tolerance + 1e-6);
  });

  it("rejects a fit that would cross a small nearby hole", () => {
    const source = arch();
    const fit = fitContour(source, ref, { kind: "auto" }, 0.5);
    const polygon = source[0].outer.map(a => a.point);
    const center = dense(fit.curves[0].outer).find(p => pointInRing(polygon, p) && distance(p, polygon) > 0.02)!;
    expect(center).toBeDefined();
    source[0].holes.push(circle(0.01, 12).reverse().map(p => ({ point: { x: p.x + center.x, y: p.y + center.y } })));
    expect(() => fitContour(source, ref, { kind: "auto" }, 0.5)).toThrow(/cross|hole/);
  });
});
