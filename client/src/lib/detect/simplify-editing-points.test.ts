import { describe, expect, it } from "vitest";
import { distanceToSegment } from "@shared/geometry/rings";
import type { Outline, Ring } from "@shared/geometry/types";
import { simplifyEditingPoints } from "./simplify-editing-points";

const ring: Ring = [[0, 0], [10, -.08], [20, 0], [20.18, 10], [20, 20], [10, 20.27], [0, 20], [-.29, 10]]
  .map(([x, y]) => ({ x, y }));

describe("progressive straight-run tolerance", () => {
  it("keeps earlier deletions and simplifies the closing edge when another edge violates a guard", () => {
    const source: Outline = [{ outer: ring, holes: [] }];
    const protectsBottom = ([shape]: Outline) => shape.outer.includes(ring[5]);
    const results = [1, 2, 3].map(levels => simplifyEditingPoints(source, .01, .1, 1, levels, protectsBottom)[0].outer);
    expect(results.map(r => r.length)).toEqual([7, 6, 5]);
    expect(results[2]).toEqual([ring[0], ring[2], ring[4], ring[5], ring[6]]);
    results.forEach((result, i) => {
      const previous = results[i - 1] ?? ring;
      expect(result.every(p => previous.includes(p))).toBe(true);
      result.forEach((a, j) => {
        const b = result[(j + 1) % result.length];
        for (let k = ring.indexOf(a); ring[k] !== b; k = (k + 1) % ring.length)
          expect(distanceToSegment(ring[k], a, b)).toBeLessThanOrEqual((i + 1) * .1);
      });
    });
    expect(simplifyEditingPoints(source, .01, .1, .2, 3, protectsBottom)[0].outer).toEqual(results[1]);
  });

  it("uses a complete passing proposal to recover after the spacing pass is rejected", () => {
    const outer = [ring[0], { x: 5, y: -.04 }, ...ring.slice(1)];
    const source = [{ outer, holes: [] }];
    const acceptsSix = ([shape]: Outline) => shape.outer.length === 6;
    expect(simplifyEditingPoints(source, .01, .1, 1, 1, acceptsSix)).toBe(source);
    const second = simplifyEditingPoints(source, .01, .1, 1, 2, acceptsSix);
    expect(second[0].outer).toEqual([ring[0], ring[2], ...ring.slice(4)]);
    expect(simplifyEditingPoints(source, .01, .1, 1, 3, acceptsSix)).toEqual(second);
  });

  it("retains a protected hole and still takes safe changes on a different ring", () => {
    const hole = ring.slice().reverse().map(({ x, y }) => ({ x: x / 2 + 4, y: y / 2 + 4 }));
    const source: Outline = [{ outer: ring, holes: [hole] }];
    const [result] = simplifyEditingPoints(source, .01, .1, 1, 3, ([shape]) => shape.holes[0].length === hole.length);
    expect(result.holes[0]).toEqual(hole);
    expect(result.outer).toEqual([ring[0], ring[2], ring[4], ring[6]]);
    expect(simplifyEditingPoints(source, .01, .1, 1, 3, () => false)).toBe(source);
  });
});
