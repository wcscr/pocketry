import { describe, expect, it } from "vitest";
import { signedArea } from "@shared/geometry/rings";
import type { Point, Shape } from "@shared/geometry/types";
import { outlineBounds, pointInOutline } from "./outline";
import { hookedToolRing, rectRing } from "./fixtures";
import syringe from "./fixtures/syringe-contour.json";
import { alignShapeUpright, suggestSymmetryAxis, symmetrizeShape, type SymmetryAxis, type SymmetrySide } from "./symmetry";

const axis: SymmetryAxis = { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };
// A narrow shaft, square shoulders, and a handle widened on the right by shadow.
const tool: Shape = { outer: [
  { x: -2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 60 }, { x: 12, y: 60 },
  { x: 14, y: 100 }, { x: -10, y: 100 }, { x: -8, y: 60 }, { x: -2, y: 60 },
], holes: [] };
function corrected(side: SymmetrySide): Shape {
  const result = symmetrizeShape(tool, axis, side);
  expect(result.error).toBeUndefined();
  return result.shape!;
}

describe("contour symmetry", () => {
  it.each(["left", "right"] as const)("mirrors the reported syringe photo's %s side without filling its grip recess", side => {
    const result = symmetrizeShape(syringe.shape, syringe.axis, side);
    expect(result.error).toBeUndefined();
    expect(signedArea(result.shape!.outer)).toBeGreaterThan(0);
    const { start, end } = syringe.axis;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const sign = side === "left" ? -1 : 1;
    const point = (x: number, y: number) => ({ x: start.x + along.x * y + along.y * x, y: start.y + along.y * y - along.x * x });
    for (let y = 1; y < 470; y += 3) for (let x = 1; x < 100; x += 3) {
      const expected = pointInOutline([syringe.shape], point(sign * x, y));
      expect(pointInOutline([result.shape!], point(x, y))).toBe(expected);
      expect(pointInOutline([result.shape!], point(-x, y))).toBe(expected);
    }
    expect(symmetrizeShape(syringe.shape, syringe.axis, "average").error).toContain("Choose Use left side");
  });

  it.each([0, Math.PI / 2, -.6, 2.1])("aligns a tool rotated by %s upright without resizing or losing its profile", angle => {
    const source: Shape = { ...tool, holes: [rectRing(-1, 70, 2, 5)] };
    const rotate = (p: Point): Point => ({
      x: 80 + Math.cos(angle) * p.x - Math.sin(angle) * (p.y - 50),
      y: 170 + Math.sin(angle) * p.x + Math.cos(angle) * (p.y - 50),
    });
    const tilted = { outer: source.outer.map(rotate), holes: source.holes.map(ring => ring.map(rotate)) };
    const before = structuredClone(tilted);
    const result = alignShapeUpright(tilted, { start: rotate(axis.start), end: rotate(axis.end) });
    expect(result.error).toBeUndefined();
    for (const [ringIndex, ring] of [source.outer, ...source.holes].entries()) {
      const upright = [result.shape!.outer, ...result.shape!.holes][ringIndex];
      expect(upright).toHaveLength(ring.length);
      for (const [i, p] of ring.entries()) {
        expect(upright[i].x).toBeCloseTo(p.x + 80, 8);
        expect(upright[i].y).toBeCloseTo(p.y + 120, 8);
      }
      expect(signedArea(upright)).toBeCloseTo(signedArea(ring), 8);
    }
    expect(tilted).toEqual(before);
  });

  it("rejects upright rotation around a collapsed axis", () => {
    expect(alignShapeUpright(tool, { start: axis.start, end: axis.start }).error).toMatch(/farther apart/);
  });

  it.each([ ["left", 2, 9], ["right", 3, 13], ["average", 2.5, 11] ] as const)(
    "uses %s widths while preserving the shaft, taper, shoulders, and length", (side, shaft, handle) => {
      const result = corrected(side);
      for (const sign of [-1, 1]) {
        expect(pointInOutline([result], { x: sign * (shaft - .1), y: 30 })).toBe(true);
        expect(pointInOutline([result], { x: sign * (shaft + .1), y: 30 })).toBe(false);
        expect(pointInOutline([result], { x: sign * (handle - .1), y: 80 })).toBe(true);
        expect(pointInOutline([result], { x: sign * (handle + .1), y: 80 })).toBe(false);
        expect(pointInOutline([result], { x: sign * 5, y: 59.99 })).toBe(false);
        expect(pointInOutline([result], { x: sign * 5, y: 60.01 })).toBe(true);
      }
      expect(outlineBounds([result])).toMatchObject({ minY: 0, maxY: 100 });
      expect(signedArea(result.outer)).toBeGreaterThan(0);
      expect(result.outer[0]).not.toEqual(result.outer.at(-1));
    },
  );

  it("commutes with rotation and translation without changing dimensions", () => {
    const rotate = (p: Point): Point => ({ x: 40 + .8 * p.x - .6 * p.y, y: 55 + .6 * p.x + .8 * p.y });
    const result = symmetrizeShape({ outer: tool.outer.map(rotate), holes: [] },
      { start: rotate(axis.start), end: rotate(axis.end) }, "average");
    expect(result.error).toBeUndefined();
    const expected = corrected("average");
    expect(signedArea(result.shape!.outer)).toBeCloseTo(signedArea(expected.outer), 6);
    for (const p of expected.outer.map(rotate)) {
      expect(result.shape!.outer.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6)).toBe(true);
    }
  });

  it("suggests a lengthwise axis independent of extra vertices on one edge", () => {
    const plain = rectRing(-10, 0, 20, 100);
    const dense = [...plain.slice(0, 2), ...Array.from({ length: 90 }, (_, i) => ({ x: 10, y: i + 1 })), ...plain.slice(2)];
    const denseAxis = suggestSymmetryAxis(dense), plainAxis = suggestSymmetryAxis(plain);
    for (const end of ["start", "end"] as const) {
      expect(denseAxis[end].x).toBeCloseTo(plainAxis[end].x, 8);
      expect(denseAxis[end].y).toBeCloseTo(plainAxis[end].y, 8);
    }
    const result = suggestSymmetryAxis(plain);
    expect(result.start.x).toBeCloseTo(0, 6);
    expect(result.end.x).toBeCloseTo(0, 6);
    expect(result.end.y - result.start.y).toBeCloseTo(100, 6);
  });

  it("clips a mirrored tip at its actual intersection with the axis", () => {
    const result = symmetrizeShape({ outer: [{ x: 2, y: 0 }, { x: 8, y: 10 }, { x: -2, y: 10 }], holes: [] }, axis, "left");
    expect(result.error).toBeUndefined();
    expect(outlineBounds([result.shape!])).toMatchObject({ minY: 5, maxY: 10, minX: -2, maxX: 2 });
  });

  it.each(["left", "right"] as const)("mirrors a hooked %s boundary without filling its recess", side => {
    const sign = side === "left" ? -1 : 1;
    const source: Shape = { outer: hookedToolRing().map(p => ({ x: sign * p.x, y: p.y })), holes: [] };
    const before = structuredClone(source);
    const result = symmetrizeShape(source, axis, side);
    expect(result.error).toBeUndefined();
    expect(signedArea(result.shape!.outer)).toBeCloseTo(1960, 8);
    for (const xSign of [-1, 1]) {
      expect(pointInOutline([result.shape!], { x: xSign * 15, y: 80 })).toBe(false);
      expect(pointInOutline([result.shape!], { x: xSign * 25, y: 80 })).toBe(true);
      expect(pointInOutline([result.shape!], { x: xSign * 15, y: 90 })).toBe(true);
      // Every off-axis point matches the selected half, including its gaps.
      for (let x = .5; x < 32; x += 2) for (let y = .5; y < 105; y += 2) {
        expect(pointInOutline([result.shape!], { x: xSign * x, y })).toBe(pointInOutline([source], { x: sign * x, y }));
      }
    }
    expect(result.shape!.outer[0]).not.toEqual(result.shape!.outer.at(-1));
    expect(source).toEqual(before);
  });

  it("ignores branching on the discarded side", () => {
    const result = symmetrizeShape({ outer: hookedToolRing(), holes: [] }, axis, "left");
    expect(result.error).toBeUndefined();
    expect(outlineBounds([result.shape!])).toEqual({ minX: -15, maxX: 15, minY: 0, maxY: 100 });
    expect(signedArea(result.shape!.outer)).toBeCloseTo(1440, 8);
  });

  it.each([0, .6, Math.PI / 2, 2.1])("preserves a hooked boundary rotated by %s with either winding and ring start", angle => {
    const rotate = (p: Point): Point => ({ x: 210 + Math.cos(angle) * p.x - Math.sin(angle) * p.y,
      y: 140 + Math.sin(angle) * p.x + Math.cos(angle) * p.y });
    const ring = hookedToolRing();
    for (const reversed of [false, true]) for (let start = 0; start < ring.length; start++) {
      const shifted = [...ring.slice(start), ...ring.slice(0, start)];
      if (reversed) shifted.reverse();
      const result = symmetrizeShape({ outer: shifted.map(rotate), holes: [] },
        { start: rotate(axis.start), end: rotate(axis.end) }, "right");
      expect(result.error).toBeUndefined();
      expect(signedArea(result.shape!.outer)).toBeCloseTo(1960, 7);
      for (const x of [-15, 15]) expect(pointInOutline([result.shape!], rotate({ x, y: 80 }))).toBe(false);
    }
  });

  it("handles an axis through vertices or along an edge without doubling the closing seam", () => {
    for (const outer of [rectRing(0, 0, 10, 100), [{ x: 0, y: 0 }, { x: 10, y: 50 }, { x: 0, y: 100 }, { x: -5, y: 50 }]]) {
      const result = symmetrizeShape({ outer, holes: [] }, axis, "right");
      expect(result.error).toBeUndefined();
      expect(result.shape!.outer).toHaveLength(outer.length === 4 && outer[1].y === 0 ? 6 : 4);
      expect(signedArea(result.shape!.outer)).toBeGreaterThan(0);
    }
  });

  it("rejects mirrored halves that would connect through empty space or a single point", () => {
    for (const innerX of [-5, 0]) {
      const outer = [{ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 },
        { x: innerX, y: 20 }, { x: innerX, y: 80 }, { x: 10, y: 80 }, { x: 10, y: 100 }, { x: -10, y: 100 }];
      expect(symmetrizeShape({ outer, holes: [] }, axis, "right").error).toMatch(/separates into pieces/);
    }
    const touch = [{ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 50 }, { x: 10, y: 100 }, { x: -10, y: 100 }];
    expect(symmetrizeShape({ outer: touch, holes: [] }, axis, "right").error).toMatch(/separates into pieces/);
  });

  it("rejects holes and branched sections without modifying the input", () => {
    const before = structuredClone(tool);
    expect(symmetrizeShape({ ...tool, holes: [rectRing(-1, 70, 2, 5)] }, axis, "average").error).toMatch(/holes/);
    const u: Shape = { outer: [{ x: -8, y: 0 }, { x: -4, y: 0 }, { x: -4, y: 80 }, { x: 4, y: 80 },
      { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 100 }, { x: -8, y: 100 }], holes: [] };
    expect(symmetrizeShape(u, axis, "average").error).toMatch(/Choose Use left side or Use right side/);
    corrected("left");
    expect(tool).toEqual(before);
  });

  it("does not emit invalid geometry when the axis collapses or misses the chosen side", () => {
    expect(symmetrizeShape(tool, { start: axis.start, end: axis.start }, "average").error).toMatch(/farther apart/);
    expect(symmetrizeShape(tool, { start: { x: -50, y: 0 }, end: { x: -50, y: 100 } }, "left").error).toMatch(/other side/);
  });
});
