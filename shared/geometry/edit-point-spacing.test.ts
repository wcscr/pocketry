import { describe, expect, it } from "vitest";
import { distanceToSegment, signedArea } from "./rings";
import { collapseStraightRuns, thinEditingOutline, thinEditingRing } from "./edit-point-spacing";
import type { Ring } from "./types";

const ring = (pairs: number[][]): Ring => pairs.map(([x, y]) => ({ x, y }));

describe("point spacing on detected polygons", () => {
  it("reduces long straight runs, including across the closing seam", () => {
    const rectangle = ring([[3,0],[20,0],[40,0],[40,1],[40,2],[40,3],[0,3],[0,0],[1,0]]);
    for (let i = 0; i < rectangle.length; i++) {
      const shifted = [...rectangle.slice(i), ...rectangle.slice(0, i)];
      const result = thinEditingRing(shifted, 1, .1);
      expect(result).toHaveLength(4);
      expect(signedArea(result)).toBe(signedArea(rectangle));
    }
  });

  it("keeps both sides of a narrow notch and the winding of a small hole", () => {
    const outer = ring([[0,0],[3,0],[3,.06],[3.08,.06],[3.08,0],[9,0],[9,5],[0,5]]);
    const hole = ring([[1,1],[1,1.1],[1.1,1.1],[1.1,1]]);
    const outline = [{ outer, holes: [hole] }];
    expect(thinEditingOutline(outline, 4, .1)).toBe(outline);
  });

  it("bounds the whole original run when thinning gently curved, densely sampled edges", () => {
    const source = Array.from({ length: 400 }, (_, i) => {
      const angle = i * 2 * Math.PI / 400;
      return { x: 20 * Math.cos(angle), y: 20 * Math.sin(angle) };
    });
    const result = thinEditingRing(source, 2, .1);
    expect(result.length).toBeLessThan(100);
    expect(result.length).toBeGreaterThan(12);
    for (const p of source) expect(Math.min(...result.map((a, i) => distanceToSegment(p, a, result[(i+1)%result.length])))).toBeLessThanOrEqual(.1);
    expect(thinEditingRing(source, .1, .1)).toBe(source);
  });
});

describe("straight runs on a point outline", () => {
  const asOutline = (outer: Ring) => [{ outer, holes: [] }];

  it("bridges the whole run across the ring seam at the allowed deviation, independent of spacing", () => {
    const edge = ring([[0,0],[8,.2],[16,-.2],[24,.2],[32,0],[32,12],[0,12]]);
    for (const ordered of [edge, [...edge].reverse()]) for (let start = 0; start < edge.length; start++) {
      const source = asOutline(ordered.slice(start).concat(ordered.slice(0, start)));
      const spaced = thinEditingOutline(source, 4, .1);
      expect(spaced).toBe(source);
      const result = collapseStraightRuns(source, spaced, .2)[0].outer;
      expect(result).toHaveLength(4);
      expect(result).toEqual(source[0].outer.filter(p => p.y === 0 || p.y === 12));
      expect(collapseStraightRuns(source, spaced, .199)[0].outer.length).toBeGreaterThan(4);
    }
  });

  it("checks pre-spacing samples against their own final edge, including points already removed", () => {
    const outer = ring([[0,0],[6,.18],[7,.27],[8,.18],[18,0],[18,10],[0,10]]);
    const source = asOutline(outer);
    // A legal spacing pass can omit the peak, which is 0.09 from its local edge.
    const spaced = asOutline(outer.filter(p => p !== outer[2]));
    expect(distanceToSegment(outer[2], outer[1], outer[3])).toBeLessThan(.1);
    const result = collapseStraightRuns(source, spaced, .2)[0].outer;
    expect(result.length).toBeGreaterThan(4);
    expect(result.every(p => spaced[0].outer.includes(p))).toBe(true);
    for (let i = 0; i < result.length; i++) {
      const a = result[i], b = result[(i + 1) % result.length];
      for (let j = outer.indexOf(a); outer[j] !== b; j = (j + 1) % outer.length)
        expect(distanceToSegment(outer[j], a, b)).toBeLessThanOrEqual(.2);
    }
  });

  it("preserves a short notch and a reversing tip, and simplifies holes in their own winding", () => {
    const outer = ring([[0,0],[10,0],[10,.08],[10.06,.08],[10.06,0],[20,0],[26,-.05],[20,1],[20,10],[0,10]]);
    const hole = ring([[2,2],[2,8],[14,8],[14,2],[8,2.1]]);
    const source = [{ outer, holes: [hole] }];
    const [result] = collapseStraightRuns(source, thinEditingOutline(source, 4, .1), .2);
    for (const vertex of outer.slice(1,5).concat(outer[6])) expect(result.outer).toContain(vertex);
    expect(result.holes[0]).toEqual(hole.slice(0,-1));
    expect(signedArea(result.holes[0])).toBeLessThan(0);
    expect(collapseStraightRuns(source, source, 0)).toBe(source);
  });
});
