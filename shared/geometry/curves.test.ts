import { describe, expect, it } from "vitest";
import { curveControls, curvePath, curvesFromOutline, editCurves, evaluateCurve, mapCurves,
  normalizeCurves, reverseCurveRing, sampleCurves, splitCurve, type Cubic } from "./curves";
import { signedArea } from "./rings";
import type { Point } from "./types";

const rectangle = [{ outer: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 0, y: 60 }],
  holes: [[{ x: 20, y: 20 }, { x: 20, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 20 }]] }];
const ref = { shapeIndex: 0, ringIndex: -1 };
const bent = () => editCurves(curvesFromOutline(rectangle), ref, { kind: "bend", index: 0, t: 0.4, delta: { x: 3, y: -18 } });
const close = (a: Point, b: Point) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); };

describe("authoritative contour curves", () => {
  it("preserves every legacy point and hole exactly when first entering curve mode", () => {
    expect(sampleCurves(curvesFromOutline(rectangle))).toEqual(rectangle);
  });

  it("bends the grabbed point by the requested displacement without moving anchors or the source", () => {
    const source = curvesFromOutline(rectangle), original = structuredClone(source);
    const result = bent();
    close(evaluateCurve(curveControls(result[0].outer, 0), 0.4), { x: 35, y: -18 });
    expect(result[0].outer.map(a => a.point)).toEqual(rectangle[0].outer);
    expect(source).toEqual(original);
    expect(result[0].holes).toEqual(source[0].holes);
  });

  it("splits a closing cubic without changing its geometry or duplicating the first anchor", () => {
    const source = editCurves(curvesFromOutline(rectangle), ref, { kind: "bend", index: 3, t: 0.5, delta: { x: -12, y: 0 } });
    const before = curveControls(source[0].outer, 3);
    const after = editCurves(source, ref, { kind: "split", index: 3, t: 0.37 });
    expect(after[0].outer).toHaveLength(5);
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      close(evaluateCurve(curveControls(after[0].outer, 3), t), evaluateCurve(before, t * 0.37));
      close(evaluateCurve(curveControls(after[0].outer, 4), t), evaluateCurve(before, 0.37 + t * 0.63));
    }
    expect(after[0].outer[0]).toMatchObject({ point: rectangle[0].outer[0] });
  });

  it("moves both handles with the anchor and keeps smooth handles opposite", () => {
    let source = editCurves(bent(), ref, { kind: "smooth", index: 0 });
    source = editCurves(source, ref, { kind: "handle", index: 0, side: "out", point: { x: 12, y: -4 } });
    const a = source[0].outer[0];
    expect(a.in!.x * a.out!.y - a.in!.y * a.out!.x).toBeCloseTo(0, 9);
    expect(a.in!.x * a.out!.x + a.in!.y * a.out!.y).toBeLessThan(0);
    const moved = editCurves(source, ref, { kind: "move", index: 0, point: { x: 5, y: 9 } })[0].outer[0];
    close(moved.in!, { x: a.in!.x + 5, y: a.in!.y + 9 });
    close(moved.out!, { x: a.out!.x + 5, y: a.out!.y + 9 });
  });

  it("preserves curve geometry when reversing winding and mapping affine coordinates", () => {
    const source = bent();
    const flipped = normalizeCurves(mapCurves(source, p => ({ x: -2 * p.x + 3, y: 0.5 * p.y - 8 })));
    expect(signedArea(sampleCurves(flipped)[0].outer)).toBeGreaterThan(0);
    expect(signedArea(sampleCurves(flipped)[0].holes[0])).toBeLessThan(0);
    const before = curveControls(source[0].outer, 0), after = curveControls(flipped[0].outer, 2);
    for (let i = 0; i <= 50; i++) {
      const p = evaluateCurve(before, i / 50);
      close(evaluateCurve(after, 1 - i / 50), { x: -2 * p.x + 3, y: 0.5 * p.y - 8 });
    }
    expect(reverseCurveRing(reverseCurveRing(source[0].outer))).toEqual(source[0].outer);
  });

  it("bounds each sampled chord even for looping and collinear overshooting control points", () => {
    const examples: Cubic[] = [
      [{ x: 0, y: 0 }, { x: 200, y: 400 }, { x: -200, y: 400 }, { x: 10, y: 0 }],
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -100, y: 0 }, { x: 10, y: 0 }],
    ];
    const distance = (p: Point, a: Point, b: Point) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    for (const c of examples) {
      const sampled = sampleCurves([{ outer: [{ point: c[0], out: c[1] }, { point: c[3], in: c[2] }, { point: { x: 10, y: -10 } }], holes: [] }], 0.025)[0].outer;
      for (let i = 0; i <= 1000; i++) {
        const p = evaluateCurve(c, i / 1000);
        expect(Math.min(...sampled.map((a, j) => distance(p, a, sampled[(j + 1) % sampled.length])))).toBeLessThanOrEqual(0.025 + 1e-9);
      }
    }
  });

  it("keeps explicit lines, supports corners/deletion, and refuses invalid sampling", () => {
    const straight = editCurves(bent(), ref, { kind: "straight", index: 0 });
    expect(curvePath(straight[0].outer)).not.toContain("C");
    const corner = editCurves(bent(), ref, { kind: "corner", index: 0 });
    expect(corner[0].outer[0].smooth).toBe(false);
    const triangle = editCurves(straight, ref, { kind: "delete", index: 1 });
    expect(editCurves(triangle, ref, { kind: "delete", index: 1 })).toBe(triangle);
    expect(() => sampleCurves(bent(), 0)).toThrow("positive");
    expect(() => sampleCurves(mapCurves(bent(), () => ({ x: NaN, y: 0 })))).toThrow("finite");
    const [left, right] = splitCurve(curveControls(bent()[0].outer, 0), 0.5);
    close(left[3], right[0]);
  });
});
