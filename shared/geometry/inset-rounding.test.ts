import { describe, expect, it } from "vitest";

import { distanceToChain, type ArcChain } from "./arc-chain";
import { insideCorners, roundingInset, roundingWitnesses } from "./inset-rounding";
import type { Point } from "./types";

const point = (x: number, y: number): Point => ({ x, y });

/** Lines through the given corners in order. */
function polygonChain(corners: Point[]): ArcChain {
  return corners.map((a, index) => ({
    kind: "line",
    a,
    b: corners[(index + 1) % corners.length],
  }));
}

describe("roundingInset", () => {
  it("is the full radius at the floor and nothing from the radius up", () => {
    expect(roundingInset(2.8, 0)).toBeCloseTo(2.8, 12);
    expect(roundingInset(2.8, 2.8)).toBe(0);
    expect(roundingInset(2.8, 9)).toBe(0);
  });

  it("follows a quarter circle tangent to the floor and the wall", () => {
    const radius = 2;
    for (const height of [0.1, 0.5, 1, 1.7]) {
      const inset = roundingInset(radius, height);
      // The surface point is one radius from the circle's center at (radius, radius).
      expect(Math.hypot(inset - radius, height - radius)).toBeCloseTo(radius, 12);
    }
  });

  it("shrinks monotonically with height", () => {
    const samples = Array.from({ length: 20 }, (_, index) => roundingInset(1.5, (1.5 * index) / 19));
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index]).toBeLessThan(samples[index - 1]);
    }
  });
});

describe("roundingWitnesses", () => {
  const square = polygonChain([point(0, 0), point(30, 0), point(30, 30), point(0, 30)]);

  it("places points one inset in from the wall, nearest to their own element", () => {
    const radius = 2.8;
    const witnesses = roundingWitnesses([square], radius);
    expect(witnesses.length).toBeGreaterThanOrEqual(4 * 2);
    for (const witness of witnesses) {
      const inset = roundingInset(radius, witness.height);
      expect(distanceToChain(witness.point, square)).toBeCloseTo(inset, 9);
      expect(distanceToChain(witness.point, [square[witness.element]])).toBeCloseTo(inset, 9);
    }
    // Every side is covered.
    expect(new Set(witnesses.map((witness) => witness.element)).size).toBe(4);
  });

  it("leaves out points that another wall's band has already removed", () => {
    // A 4 mm slot is narrower than twice the inset near the floor.
    const slot = polygonChain([point(0, 0), point(40, 0), point(40, 4), point(0, 4)]);
    const radius = 2.8;
    const low = roundingWitnesses([slot], radius, { heightFractions: [0.05] });
    // At 5% of the radius the inset is about 1.93 mm; the long walls still own those points
    // (the far wall is 2.07 mm away) but the short end walls lose the ones near the corners.
    for (const witness of low) {
      expect(distanceToChain(witness.point, slot)).toBeCloseTo(roundingInset(radius, witness.height), 9);
    }
    const lower = roundingWitnesses([slot], radius, { heightFractions: [0.01] });
    // At 1% the inset (2.41 mm) exceeds half the slot width, so no long-wall point survives.
    expect(lower.filter((witness) => witness.element === 0 || witness.element === 2)).toHaveLength(0);
  });

  it("counts holes as part of the boundary", () => {
    const hole = polygonChain([point(10, 10), point(10, 20), point(20, 20), point(20, 10)]);
    const witnesses = roundingWitnesses([square, hole], 2);
    const onHole = witnesses.filter((witness) => witness.ring === 1);
    expect(onHole.length).toBeGreaterThan(0);
    for (const witness of onHole) {
      // The region lies outside the hole, so its witnesses do too.
      expect(witness.point.x < 10 || witness.point.x > 20 || witness.point.y < 10 || witness.point.y > 20).toBe(true);
    }
  });

  it("adds a witness in the fan around a sharp inside corner", () => {
    const outline = polygonChain([point(0, 0), point(60, 0), point(60, 20), point(20, 20), point(20, 40), point(0, 40)]);
    expect(insideCorners(outline)).toHaveLength(1);
    const radius = 2;
    const cornerWitnesses = roundingWitnesses([outline], radius).filter((witness) => witness.corner);
    expect(cornerWitnesses).toHaveLength(2);
    for (const witness of cornerWitnesses) {
      const inset = roundingInset(radius, witness.height);
      expect(Math.hypot(witness.point.x - 20, witness.point.y - 20)).toBeCloseTo(inset, 9);
      // Along the bisector, toward the inside of the L.
      expect(witness.point.x).toBeLessThan(20);
      expect(witness.point.y).toBeLessThan(20);
    }
  });
});
