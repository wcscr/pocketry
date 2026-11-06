import { expect, it } from "vitest";
import { curveControls, curvesFromOutline, evaluateCurve, mapCurves, sampleCurveRing, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import { distanceToSegment } from "@shared/geometry/rings";
import { symmetrizeCurves } from "./curve-symmetry";
import type { SymmetrySide } from "./symmetry";
import type { Point } from "@shared/geometry/types";

import { asymmetricHandle } from "./curve-symmetry.test-support";
const axis = { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };
const distance = (p: Point, ring: Point[]) => Math.min(...ring.map((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length])));

it.each(["left", "right", "average"] as const)("keeps a rounded handle as native curves using %s", side => {
  const before = structuredClone(asymmetricHandle);
  const result = symmetrizeCurves({ source: asymmetricHandle, shapeIndex: 0, axis, side, tolerance: .025 });
  const ring = result.curves[0].outer, samples = sampleCurveRing(ring, .0005);
  expect(result.cubics).toBeGreaterThanOrEqual(2);
  for (const p of samples) expect(distance({ x: -p.x, y: p.y }, samples)).toBeLessThan(.002);
  const width = side === "left" ? 10 : side === "right" ? 15 : 12.5;
  const crossings = samples.flatMap((p, i) => { const q = samples[(i + 1) % samples.length];
    return (p.y > 50) !== (q.y > 50) ? [p.x + (50 - p.y) * (q.x - p.x) / (q.y - p.y)] : []; });
  expect(Math.max(...crossings)).toBeCloseTo(width, 2);
  const bottom = ring.find(a => Math.abs(a.point.x) < 1e-7 && a.point.y > 99.9)!;
  expect(bottom).toBeDefined(); expect(bottom.in).toBeDefined(); expect(bottom.out).toBeDefined(); expect(bottom.smooth).toBe(true);
  expect(Math.abs(bottom.in!.y - bottom.point.y)).toBeLessThan(1e-7); expect(Math.abs(bottom.out!.y - bottom.point.y)).toBeLessThan(1e-7);
  expect(asymmetricHandle).toEqual(before);
});

it.each([0, .65, Math.PI / 2, Math.PI, -.75])("preserves the chosen native controls after rotation %s, scaling and translation", angle => {
  for (const scale of [.25, 1, 4]) {
    const transform = (p: Point) => ({ x: 210 + scale * (Math.cos(angle) * p.x - Math.sin(angle) * p.y), y: 400 + scale * (Math.sin(angle) * p.x + Math.cos(angle) * p.y) });
    const source = mapCurves(asymmetricHandle, transform);
    for (const side of ["left", "right"] as const) {
      const result = symmetrizeCurves({ source, shapeIndex: 0, axis: { start: transform(axis.start), end: transform(axis.end) }, side, tolerance: .025 * scale });
      const index = side === "right" ? 2 : 4, p = source[0].outer[index];
      const match = result.curves[0].outer.find(a => Math.hypot(a.point.x - p.point.x, a.point.y - p.point.y) < 1e-7)!;
      expect(match).toBeDefined();
      const handle = side === "right" ? "out" : "in";
      expect(match[handle]!.x).toBeCloseTo(p[handle]!.x, 8); expect(match[handle]!.y).toBeCloseTo(p[handle]!.y, 8);
    }
  }
});

it("splits an interior cubic axis crossing without changing the retained curve", () => {
  const result = symmetrizeCurves({ source: asymmetricHandle, shapeIndex: 0,
    axis: { start: { x: 2, y: 0 }, end: { x: 2, y: 100 } }, side: "right", tolerance: .01 });
  const samples = sampleCurveRing(result.curves[0].outer, .0001);
  for (let i = 0; i < 100; i++) { const p = evaluateCurve(curveControls(asymmetricHandle[0].outer, 2), i / 100);
    if (p.x > 2) expect(distance(p, samples)).toBeLessThan(.0003);
  }
  expect(result.curves[0].outer.some(a => Math.abs(a.point.x - 2) < 1e-8 && a.point.y > 99)).toBe(true);
});

it("keeps unrelated curves unchanged and rejects new overlaps, holes, and disconnected halves", () => {
  const other = curvesFromOutline([{ outer: [{ x: 30, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 30 }, { x: 30, y: 30 }], holes: [] }])[0];
  const source = [...asymmetricHandle, other];
  expect(symmetrizeCurves({ source, shapeIndex: 0, axis, side: "left", tolerance: .025 }).curves[1]).toEqual(other);
  const conflict = mapCurves([other], p => ({ x: p.x - 44, y: p.y }))[0];
  expect(() => symmetrizeCurves({ source: [...asymmetricHandle, conflict], shapeIndex: 0, axis, side: "right", tolerance: .025 })).toThrow(/another contour|hole/);
  const holed = [{ ...asymmetricHandle[0], holes: [other.outer] }];
  expect(() => symmetrizeCurves({ source: holed, shapeIndex: 0, axis, side: "left", tolerance: .025 })).toThrow(/interior holes/);
  const separated = curvesFromOutline([{ outer: [{ x: -8, y: 0 }, { x: -4, y: 0 }, { x: -4, y: 80 }, { x: 4, y: 80 }, { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 100 }, { x: -8, y: 100 }], holes: [] }]);
  expect(() => symmetrizeCurves({ source: separated, shapeIndex: 0, axis, side: "average", tolerance: .025 })).toThrow(/continuous width/);
  expect(sampleCurves(source)).toHaveLength(2);
});

it.each([NaN, Infinity, 0, -1])("rejects invalid precision %s without touching source", tolerance => {
  const before = structuredClone(asymmetricHandle);
  expect(() => symmetrizeCurves({ source: asymmetricHandle, shapeIndex: 0, axis, side: "left", tolerance })).toThrow();
  expect(asymmetricHandle).toEqual(before);
});
