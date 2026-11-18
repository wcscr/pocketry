import { describe, expect, it } from "vitest";
import { curvesFromOutline, curveControls, evaluateCurve } from "./curves";
import { redrawAttachments, redrawEdgeOptions } from "./redraw-edge";
import { pointInRing, signedArea } from "./rings";

const redrawEdge = (...args: Parameters<typeof redrawEdgeOptions>) => redrawEdgeOptions(...args)[0];
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

  it("distinguishes precise loop closure from tracing back to a nearby edge point", () => {
    const trace = [point(45, 100), point(35, 80), point(55, 70)];
    expect(redrawAttachments(source, [...trace, point(45, 100)], 1, 12)).toBeUndefined();
    expect(redrawAttachments(source, [...trace, point(45.5, 100)], 1, 12)).toBeDefined();
    expect(redrawAttachments(source, [trace[0], point(45.5, 100)], 1, 12)).toBeUndefined();
  });

  it("previews both sides of a wide recess and keeps the handles by default in either direction", () => {
    const gap = [point(5, 100), point(5, 10), point(95, 10), point(95, 100)];
    for (const stroke of [gap, [...gap].reverse()]) {
      const [pocket, plug] = redrawEdgeOptions(source, stroke, 1, 12).map(curves => curves[0].outer.map(a => a.point));
      expect(signedArea(pocket)).toBeCloseTo(1900);
      expect(pointInRing(pocket, point(2, 55))).toBe(true);
      expect(pointInRing(pocket, point(50, 55))).toBe(false);
      expect(signedArea(plug)).toBeCloseTo(8100);
    }
  });

  it("preserves existing pocket intersections and rejects fresh ones", () => {
    const other = [point(70, 30), point(110, 30), point(110, 70), point(70, 70)];
    const pair = curvesFromOutline([{ outer: square, holes: [] }, { outer: other, holes: [] }]);
    const options = redrawEdgeOptions(pair, [point(0, 70), point(7, 55), point(0, 40)], 1, 12);
    expect(options).toHaveLength(1);
    expect(options[0][1]).toBe(pair[1]);
    expect(() => redrawEdgeOptions(pair, [point(0, 70), point(85, 55), point(0, 40)], 1, 12)).toThrow("cross");
  });

  it("previews a shared exclusion on all of its pockets", () => {
    const hole = [point(43, 30), point(43, 60), point(60, 60), point(60, 30)];
    const other = square.map(p => point(p.x + 20, p.y));
    const pair = curvesFromOutline([{ outer: square, holes: [hole] }, { outer: other, holes: [[...hole.slice(1), hole[0]]] }]);
    const [result] = redrawEdgeOptions(pair, [point(43, 35), point(47, 45), point(43, 55)], 1, 12);
    expect(result[0].holes[0]).toBe(result[1].holes[0]);
    expect(result[0].holes[0].map(a => a.point)).toContainEqual(point(47, 45));
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

  it("never snaps a visible stroke to a hidden edge beyond the paper crop", () => {
    const stroke = [point(91, 32), point(76, 48), point(91, 67)];
    expect(redrawAttachments(source, stroke, 1, 12)).toBeDefined();
    expect(redrawAttachments(source, stroke, 1, 12, p => p.x <= 95)).toBeUndefined();
  });

  it("rejects distant joins and self-crossings without changing the outline", () => {
    expect(() => redrawEdge(source, [point(49, 50), point(52, 55)], 2, 6)).toThrow("Start and finish");
    expect(() => redrawEdge(source, [point(0, 30), point(70, 65), point(70, 30), point(0, 65)], 1, 12)).toThrow();
    expect(source[0].outer.map(a => a.point)).toEqual(square);
  });
});
