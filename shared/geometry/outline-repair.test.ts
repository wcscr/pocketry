import { describe, expect, it } from "vitest";
import { curvesFromOutline, curveRing, sampleCurves } from "./curves";
import { continueBoundary, repairCurveSection, sampleBoundaryBridge, visibleTangent } from "./outline-repair";

const ref = { shapeIndex: 0, ringIndex: -1 };
const source = curvesFromOutline([{ outer: [{ x: 0, y: 0 }, { x: 20, y: 2 }, { x: 40, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }],
  holes: [[{ x: 10, y: 20 }, { x: 10, y: 30 }, { x: 20, y: 30 }, { x: 20, y: 20 }]] },
{ outer: [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 20 }, { x: 100, y: 20 }], holes: [] }]);

describe("intentional line / curve repair", () => {
  it.each([false, true])("keeps endpoints and unrelated geometry; editable curves %s", editableCurves => {
    const input = structuredClone(source);
    input[0].outer[0].in = { x: 0, y: 5 };
    input[0].outer[2].out = { x: 45, y: 0 };
    const before = structuredClone(input);
    const result = repairCurveSection(input, ref, 0, 2, { mode: "curve", bend: -5, editableCurves, tolerance: .05 });
    const ring = result.curves[0].outer;
    expect(ring[0].point).toEqual(source[0].outer[0].point);
    expect(ring[0].in).toEqual(input[0].outer[0].in);
    const end = ring.find(a => a.point.x === 40 && a.point.y === 0)!;
    expect(end.out).toEqual(input[0].outer[2].out);
    expect(result.curves[0].holes).toEqual(source[0].holes); expect(result.curves[1]).toEqual(source[1]);
    expect(ring.some(a => a.in || a.out)).toBe(true); // Outside handles survive in either representation.
    expect(ring[0].out !== undefined).toBe(editableCurves);
    expect(sampleCurves(result.curves, .01)[0].outer.some(p => p.y < -4.9)).toBe(true);
    expect(ring.filter(a => a.point.y < 0).length > 0).toBe(!editableCurves);
    expect(input).toEqual(before);
  });
  it("replaces a directed wrapping section with a line and keeps outside handles", () => {
    const input = [{ ...source[0], holes: [] }, source[1]];
    const result = repairCurveSection(input, ref, 5, 1, { mode: "line", editableCurves: true, tolerance: .05 });
    expect(curveRing(result.curves, ref)!.map(a => a.point)).toEqual([source[0].outer[5].point, source[0].outer[1].point,
      ...source[0].outer.slice(2, 5).map(a => a.point)]);
    expect(source[0].outer).toHaveLength(6);
  });
  it("rejects a crossing, oversized bend, bad endpoints and a collapsed contour", () => {
    expect(() => repairCurveSection(source, ref, 0, 2, { mode: "curve", bend: 39, editableCurves: true, tolerance: .05 })).toThrow(/hole|cross|touch/);
    expect(() => repairCurveSection(source, ref, 0, 2, { mode: "curve", bend: NaN, editableCurves: true, tolerance: .05 })).toThrow(/bend/);
    expect(() => repairCurveSection(source, ref, 0, 5, { mode: "line", editableCurves: true, tolerance: .05 })).toThrow(/outside/);
    expect(() => repairCurveSection(source, ref, -1, 2, { mode: "line", editableCurves: true, tolerance: .05 })).toThrow();
    expect(repairCurveSection(source, ref, 0, 2, { mode: "line", bend: NaN, editableCurves: true, tolerance: .05 }).bend).toBe(0);
  });
  it("requires two consistent tangents and rejects loops / long turns", () => {
    expect(continueBoundary({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeUndefined();
    expect(continueBoundary({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeUndefined();
    const bridge = continueBoundary({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: -.3 }, { x: 1, y: .3 })!;
    const points = sampleBoundaryBridge(bridge, .01);
    expect(points[0]).toEqual({ x: 0, y: 0 }); expect(points.at(-1)).toEqual({ x: 10, y: 0 });
    expect(points.some(p => p.y < -.7)).toBe(true);
    expect(visibleTangent([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1)).toBeUndefined();
  });
});
