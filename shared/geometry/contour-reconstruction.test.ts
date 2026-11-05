import { describe, expect, it } from "vitest";
import { recommendedReconstructionTolerance, reconstructContour, reconstructDetectedOutline, reconstructionSourceRing } from "./contour-reconstruction";
import { curveControls, curvesFromOutline, evaluateCurve, mapCurves, sampleCurves, type CurveOutline } from "./curves";
import { distanceToSegment, pointInRing, signedArea } from "./rings";
import type { Point, Ring } from "./types";
const ref = { shapeIndex: 0, ringIndex: -1 };
const segment = (a: Point, b: Point, count = 40) => Array.from({ length: count }, (_, i) => ({ x: a.x + (b.x - a.x) * i / count, y: a.y + (b.y - a.y) * i / count }));
const polygon = (ring: Ring) => ring.flatMap((p, i) => segment(p, ring[(i + 1) % ring.length]));
const handle = (): Ring => [
  ...segment({ x: -20, y: 0 }, { x: 20, y: 0 }),
  ...segment({ x: 20, y: 0 }, { x: 20, y: 80 }, 160),
  ...Array.from({ length: 128 }, (_, i) => ({ x: 20 * Math.cos(i * Math.PI / 128), y: 80 + 20 * Math.sin(i * Math.PI / 128) })),
  ...segment({ x: -20, y: 80 }, { x: -20, y: 0 }, 160),
];
const distance = (p: Point, ring: Ring) => Math.min(...ring.map((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length])));
function verify(source: Ring, curves: CurveOutline, tolerance: number) {
  const ring = curves[0].outer;
  for (let i = 0; i < ring.length; i++) for (let j = 0; j <= 30; j++) {
    expect(distance(evaluateCurve(curveControls(ring, i), j / 30), source)).toBeLessThanOrEqual(tolerance + 1e-6);
  }
  const sampled = sampleCurves(curves, tolerance / 40)[0].outer;
  for (const p of source) expect(distance(p, sampled)).toBeLessThanOrEqual(tolerance * 1.03);
}

describe("dense line-and-curve reconstruction", () => {
  it.each([0, 37, 90, 137, 180, 270])("keeps a rounded handle bottom as true curves at %s degrees", degrees => {
    const radians = degrees * Math.PI / 180;
    const rotate = (p: Point) => ({ x: Math.cos(radians) * p.x - Math.sin(radians) * p.y, y: Math.sin(radians) * p.x + Math.cos(radians) * p.y });
    const dense = handle().map(rotate), source = curvesFromOutline([{ outer: dense, holes: [] }]);
    const result = reconstructContour(source, ref, dense, 0.4);
    expect(result.maxDeviation).toBeLessThanOrEqual(0.4);
    expect(result.after).toBeLessThan(24);
    expect(result.lines).toBeGreaterThanOrEqual(3);
    expect(result.cubics).toBeGreaterThanOrEqual(2);
    expect(result.smoothJoins).toBeGreaterThanOrEqual(2);
    const curvedBottom = result.curves[0].outer.some((a, i, r) => {
      const p = evaluateCurve(curveControls(r, i), 0.5), inverse = rotate({ x: 0, y: 95 });
      const c = curveControls(r, i);
      return (a.out || r[(i + 1) % r.length].in) && Math.hypot(p.x - inverse.x, p.y - inverse.y) < 20
        && Math.max(distanceToSegment(c[1], c[0], c[3]), distanceToSegment(c[2], c[0], c[3])) > 0.1;
    });
    expect(curvedBottom).toBe(true);
    expect(signedArea(sampleCurves(result.curves)[0].outer)).toBeGreaterThan(0);
    verify(dense, result.curves, 0.4);
  });

  it.each([0.25, 1, 4])("is scale-consistent and keeps exact straight corners at scale %s", scale => {
    const vertices = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 100 }, { x: 0, y: 100 }].map(p => ({ x: 700 + p.x * scale, y: -500 + p.y * scale }));
    const dense = polygon(vertices), source = curvesFromOutline([{ outer: dense, holes: [] }]);
    const result = reconstructContour(source, ref, dense, 0.3 * scale);
    expect(result.lines).toBe(4); expect(result.cubics).toBe(0); expect(result.after).toBe(4);
    for (const p of vertices) expect(result.curves[0].outer.map(a => a.point)).toContainEqual(p);
    expect(source[0].outer).toHaveLength(dense.length);
    verify(dense, result.curves, 0.3 * scale);
  });

  it("retains a narrow recess and a long thin shaft", () => {
    const dense = polygon([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 },
      { x: 17, y: 30 }, { x: 17, y: 80 }, { x: 15, y: 80 }, { x: 15, y: 30 },
      { x: 12, y: 30 }, { x: 12, y: 15 }, { x: 8, y: 15 }, { x: 8, y: 30 }, { x: 0, y: 30 }]);
    const result = reconstructContour(curvesFromOutline([{ outer: dense, holes: [] }]), ref, dense, 0.2);
    const ring = sampleCurves(result.curves, 0.005)[0].outer;
    expect(pointInRing(ring, { x: 10, y: 25 })).toBe(false);
    expect(pointInRing(ring, { x: 16, y: 79 })).toBe(true);
    expect(pointInRing(ring, { x: 18, y: 60 })).toBe(false);
    verify(dense, result.curves, 0.2);
  });

  it("preserves holes and other authored curves when reconstructing one contour", () => {
    const dense = handle();
    const hole = polygon([{ x: -5, y: 20 }, { x: -5, y: 30 }, { x: 5, y: 30 }, { x: 5, y: 20 }]);
    const source = curvesFromOutline([{ outer: dense, holes: [hole] }, { outer: [{ x: 100, y: 0 }, { x: 130, y: 0 }, { x: 130, y: 30 }, { x: 100, y: 30 }], holes: [] }]);
    source[1].outer[0].out = { x: 110, y: -4 }; source[1].outer[1].in = { x: 120, y: -4 };
    const before = structuredClone(source), result = reconstructContour(source, ref, dense, 0.4);
    expect(result.curves[0].holes).toEqual(source[0].holes);
    expect(result.curves[1]).toEqual(source[1]); expect(source).toEqual(before);
    expect(() => reconstructContour(result.curves, ref, dense, 0.4)).toThrow("Undo curve edits");
    const marked = structuredClone(source); marked[0].outer[0].smooth = false;
    expect(() => reconstructContour(marked, ref, dense, 0.4)).toThrow("Undo curve edits");
  });

  it("matches re-ordered components and applies an entire reconstruction atomically", () => {
    const first = polygon([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]);
    const second = first.map(p => ({ x: p.x + 60, y: p.y + 10 }));
    const dense = [{ outer: first, holes: [] }, { outer: second, holes: [] }];
    const source = curvesFromOutline(dense.slice().reverse()), before = structuredClone(source);
    expect(reconstructionSourceRing(dense, source, ref)).toBe(second);
    const result = reconstructDetectedOutline(source, dense, 0.2);
    expect(result.lines).toBe(8); expect(result.after).toBe(8); expect(source).toEqual(before);
    const withAuthored = mapCurves(source, p => p); withAuthored[1].outer[0].out = { x: 1, y: -2 };
    const authoredBefore = structuredClone(withAuthored);
    expect(() => reconstructDetectedOutline(withAuthored, dense, 0.2)).toThrow("Undo curve edits");
    expect(withAuthored).toEqual(authoredBefore);
  });

  it("rejects ambiguous, nonfinite, oversized and invalid-tolerance inputs", () => {
    const dense = handle(), source = curvesFromOutline([{ outer: dense, holes: [] }]);
    expect(() => reconstructionSourceRing([{ outer: dense, holes: [] }, { outer: dense, holes: [] }], source, ref)).toThrow("ambiguous");
    expect(() => reconstructContour(source, ref, dense, 0)).toThrow("positive");
    expect(() => reconstructDetectedOutline([], [], 0)).toThrow("positive");
    expect(() => reconstructContour(source, ref, [{ x: NaN, y: 0 }, ...dense], 1)).toThrow("invalid");
    expect(() => reconstructContour(source, ref, Array.from({ length: 12_001 }, (_, i) => ({ x: i, y: i })), 1)).toThrow("complex");
    expect(recommendedReconstructionTolerance(dense, 0.2, "mm") * 0.2).toBeGreaterThanOrEqual(0.1);
    expect(recommendedReconstructionTolerance(dense)).toBeGreaterThanOrEqual(1);
  });
});
