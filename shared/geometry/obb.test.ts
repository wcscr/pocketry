import { describe, expect, it } from "vitest";

import { convexHull, minAreaObb } from "./obb";
import type { Point } from "./types";

function rotate(points: Point[], deg: number): Point[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return points.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

function rect(w: number, h: number): Point[] {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
}

describe("convexHull", () => {
  it("hulls a square with an interior point", () => {
    const hull = convexHull([...rect(2, 2), { x: 0, y: 0 }]);
    expect(hull).toHaveLength(4);
    // CCW: positive shoelace.
    let area2 = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    expect(area2).toBeCloseTo(8, 9);
  });

  it("handles duplicates and collinear runs", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(hull).toHaveLength(4);
  });
});

describe("minAreaObb", () => {
  it("recovers a rotated rectangle's dimensions", () => {
    const obb = minAreaObb(rotate(rect(40, 10), 30));
    expect(obb.widthMm).toBeCloseTo(40, 9);
    expect(obb.heightMm).toBeCloseTo(10, 9);
    // Applying the angle axis-aligns the points into exactly that box.
    const aligned = rotate(rotate(rect(40, 10), 30), obb.angleDeg);
    const xs = aligned.map((p) => p.x);
    const ys = aligned.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 9);
  });

  it("stands a portrait shape up into landscape", () => {
    const obb = minAreaObb(rect(10, 40));
    expect(obb.widthMm).toBeCloseTo(40, 9);
    expect(obb.heightMm).toBeCloseTo(10, 9);
    const aligned = rotate(rect(10, 40), obb.angleDeg);
    const xs = aligned.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 9);
  });

  it("beats the axis-aligned bbox on a diagonal shape", () => {
    const diagonal = rotate(rect(50, 8), 45);
    const xs = diagonal.map((p) => p.x);
    const ys = diagonal.map((p) => p.y);
    const aabbArea =
      (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    const obb = minAreaObb(diagonal);
    expect(obb.widthMm * obb.heightMm).toBeCloseTo(400, 6);
    expect(obb.widthMm * obb.heightMm).toBeLessThan(aabbArea * 0.5);
  });

  it("keeps the angle in (−90, 90]", () => {
    for (const deg of [0, 15, 89, 91, 137, -45, -170]) {
      const obb = minAreaObb(rotate(rect(30, 12), deg));
      expect(obb.angleDeg).toBeGreaterThan(-90);
      expect(obb.angleDeg).toBeLessThanOrEqual(90);
    }
  });

  it("reports the box centre in the input frame", () => {
    const shifted = rotate(rect(20, 8), 25).map((p) => ({ x: p.x + 7, y: p.y - 3 }));
    const obb = minAreaObb(shifted);
    expect(obb.center.x).toBeCloseTo(7, 9);
    expect(obb.center.y).toBeCloseTo(-3, 9);
  });

  it("falls back to the AABB for degenerate input", () => {
    const segment = minAreaObb([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(segment.widthMm).toBeCloseTo(10, 9);
    expect(segment.heightMm).toBeCloseTo(0, 9);
    expect(segment.angleDeg).toBe(90);
  });
});
