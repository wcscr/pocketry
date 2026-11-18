import { describe, expect, it } from "vitest";
import { distanceToSegment, signedArea } from "./rings";
import { thinEditingOutline, thinEditingRing } from "./edit-point-spacing";
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
