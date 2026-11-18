import { describe, expect, it } from "vitest";
import { curvesFromOutline, curveControls, evaluateCurve } from "./curves";
import { redrawEdge } from "./redraw-edge";
import { signedArea } from "./rings";

const point = (x: number, y: number) => ({ x, y });
const square = [point(0, 0), point(100, 0), point(100, 100), point(0, 100)];
const source = curvesFromOutline([{ outer: square, holes: [] }]);

describe("edge brush", () => {
  it("traces both sides of a deep handle gap in one open stroke in either direction", () => {
    const u = [point(28, 100), point(32, 75), point(45, 22), point(52, 18), point(70, 100)];
    const forward = redrawEdge(source, u, 1, 12);
    expect(redrawEdge(source, [...u].reverse(), 1, 12)).toEqual(forward);
    const ring = forward[0].outer.map(a => a.point);
    for (const p of [...square, ...u]) expect(ring.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1e-8)).toBe(true);
    expect(signedArea(ring)).toBeLessThan(signedArea(square));
  });

  it("adds material across an existing concavity and preserves other rings", () => {
    const recessed = [square[0], square[1], square[2], point(70, 100), point(50, 24), point(30, 100), square[3]];
    const shape = curvesFromOutline([{ outer: recessed, holes: [] }, { outer: square.map(p => point(p.x + 150, p.y)), holes: [] }]);
    const next = redrawEdge(shape, [point(70, 100), point(50, 90), point(30, 100)], 2, 6);
    expect(next[0].outer.map(a => a.point)).toContainEqual(point(50, 90));
    expect(next[0].outer.map(a => a.point)).not.toContainEqual(point(50, 24));
    expect(next[1]).toBe(shape[1]);
  });

  it("keeps the far side when the traced arc is longer than the other side", () => {
    const aroundThreeSides = [point(0, 12), point(4, 90), point(8, 96), point(95, 96), point(96, 90), point(100, 12)];
    const ring = redrawEdge(source, aroundThreeSides, 1, 12)[0].outer.map(a => a.point);
    expect(ring).toContainEqual(square[0]);
    expect(ring).toContainEqual(square[1]);
    expect(ring).not.toContainEqual(square[2]);
  });

  it("edits a hole without moving its parent or a neighboring hole", () => {
    const hole = [point(20, 20), point(20, 40), point(40, 40), point(40, 20)];
    const shape = curvesFromOutline([{ outer: square, holes: [hole, hole.map(p => point(p.x + 40, p.y))] }]);
    const next = redrawEdge(shape, [point(20, 24), point(25, 30), point(20, 38)], 1, 8);
    expect(next[0].outer).toBe(shape[0].outer);
    expect(next[0].holes[1]).toBe(shape[0].holes[1]);
    expect(next[0].holes[0].map(a => a.point)).toContainEqual(point(25, 30));
  });

  it("splits the same cubic twice and retains the curved spans outside the joins", () => {
    const shape = structuredClone(source);
    shape[0].outer[0].out = point(30, -20);
    shape[0].outer[1].in = point(65, -25);
    const original = structuredClone(shape);
    const curve = curveControls(shape[0].outer, 0);
    const mid = point(50, 8);
    const next = redrawEdge(shape, [evaluateCurve(curve, .25), mid, evaluateCurve(curve, .75)], 1, 12);
    expect(next[0].outer.map(a => a.point)).toContainEqual(mid);
    expect(next[0].outer.filter(a => a.in || a.out).length).toBeGreaterThanOrEqual(4);
    expect(shape).toEqual(original);
  });

  it("uses the selected pixel width as the attachment target at the current zoom", () => {
    const line = [point(80, 32), point(72, 48), point(80, 67)];
    expect(() => redrawEdge(source, line, 2, 24 / 4)).toThrow("Start and finish");
    expect(redrawEdge(source, line, 2, 48 / 4)[0].outer.map(a => a.point)).toContainEqual(line[1]);
  });

  it("rejects distant joins and self-crossings without changing the outline", () => {
    expect(() => redrawEdge(source, [point(49, 50), point(52, 55)], 2, 6)).toThrow("Start and finish");
    expect(() => redrawEdge(source, [point(0, 30), point(70, 65), point(70, 30), point(0, 65)], 1, 12)).toThrow();
    expect(source[0].outer.map(a => a.point)).toEqual(square);
  });
});
