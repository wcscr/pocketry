import { describe, expect, it } from "vitest";

import {
  boundsContain,
  dedupeRing,
  distanceToSegment,
  ensureOrientation,
  isValidRing,
  perpendicularDistance,
  pointInRing,
  reverseRing,
  ringArea,
  ringBounds,
  ringCentroid,
  ringPerimeter,
  signedArea,
} from "./rings";
import { HOLE_ORIENTATION, OUTER_ORIENTATION, type Ring } from "./types";

/** Unit square wound clockwise on screen in the y-down image frame. */
const square: Ring = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("signedArea", () => {
  it("is positive for the outer winding convention", () => {
    // In y-down image space this ring reads clockwise on screen; the model
    // defines that as the positive/outer orientation.
    expect(signedArea(square)).toBe(100);
  });

  it("flips sign when the ring is reversed", () => {
    expect(signedArea(reverseRing(square))).toBe(-100);
  });

  it("is zero for degenerate rings", () => {
    expect(signedArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe(0);
  });

  it("includes the implicit closing edge", () => {
    // Repeating the first point must not change the area.
    expect(signedArea([...square, { x: 0, y: 0 }])).toBe(100);
  });
});

describe("ringArea / ringPerimeter / ringBounds", () => {
  it("computes area and perimeter of a square", () => {
    expect(ringArea(square)).toBe(100);
    expect(ringPerimeter(square)).toBe(40);
  });

  it("computes bounds", () => {
    expect(ringBounds(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(ringBounds([])).toBeNull();
  });

  it("detects bounds containment", () => {
    const outer = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boundsContain(outer, { minX: 2, minY: 2, maxX: 8, maxY: 8 })).toBe(true);
    expect(boundsContain(outer, { minX: 2, minY: 2, maxX: 12, maxY: 8 })).toBe(false);
  });
});

describe("ringCentroid", () => {
  it("returns the area centroid", () => {
    const centroid = ringCentroid(square);
    expect(centroid?.x).toBeCloseTo(5, 10);
    expect(centroid?.y).toBeCloseTo(5, 10);
  });

  it("falls back to the vertex mean for zero-area rings", () => {
    const centroid = ringCentroid([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 4 },
    ]);
    expect(centroid?.x).toBeCloseTo(2, 10);
    expect(centroid?.y).toBeCloseTo(2, 10);
  });

  it("returns null for an empty ring", () => {
    expect(ringCentroid([])).toBeNull();
  });
});

describe("ensureOrientation", () => {
  it("leaves a correctly wound ring untouched", () => {
    expect(ensureOrientation(square, OUTER_ORIENTATION)).toBe(square);
  });

  it("reverses a ring wound the wrong way", () => {
    const fixed = ensureOrientation(square, HOLE_ORIENTATION);
    expect(signedArea(fixed)).toBe(-100);
  });

  it("leaves degenerate rings alone", () => {
    const line: Ring = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(ensureOrientation(line, HOLE_ORIENTATION)).toBe(line);
  });
});

describe("dedupeRing", () => {
  it("removes consecutive duplicates", () => {
    const ring: Ring = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(dedupeRing(ring)).toHaveLength(3);
  });

  it("removes duplicates across the closing edge", () => {
    const ring: Ring = [...square, { x: 0, y: 0 }];
    expect(dedupeRing(ring)).toHaveLength(4);
  });

  it("honours an epsilon", () => {
    const ring: Ring = [
      { x: 0, y: 0 },
      { x: 0.001, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(dedupeRing(ring, 0.01)).toHaveLength(3);
    expect(dedupeRing(ring, 1e-9)).toHaveLength(4);
  });

  it("does not collapse a ring to nothing", () => {
    const ring: Ring = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(dedupeRing(ring)).toHaveLength(1);
  });
});

describe("pointInRing", () => {
  it("classifies interior and exterior points", () => {
    expect(pointInRing(square, { x: 5, y: 5 })).toBe(true);
    expect(pointInRing(square, { x: 15, y: 5 })).toBe(false);
    expect(pointInRing(square, { x: -1, y: 5 })).toBe(false);
  });

  it("reports points on the boundary as inside", () => {
    expect(pointInRing(square, { x: 0, y: 5 })).toBe(true);
    expect(pointInRing(square, { x: 10, y: 10 })).toBe(true);
  });

  it("does not double-count a ray passing through a vertex", () => {
    // A horizontal ray at y = 0 grazes two vertices of the square. A naive
    // crossing test counts them twice and reports "outside".
    const diamond: Ring = [
      { x: 0, y: -10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
    ];
    expect(pointInRing(diamond, { x: 0, y: 0 })).toBe(true);
    expect(pointInRing(diamond, { x: -20, y: 0 })).toBe(false);
    expect(pointInRing(diamond, { x: 20, y: 0 })).toBe(false);
  });

  it("handles a concave ring correctly", () => {
    const cShape: Ring = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 40, y: 30 },
      { x: 40, y: 70 },
      { x: 100, y: 70 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInRing(cShape, { x: 20, y: 50 })).toBe(true);
    // The bay is outside the material even though it is inside the bbox.
    expect(pointInRing(cShape, { x: 80, y: 50 })).toBe(false);
  });

  it("returns false for degenerate rings", () => {
    expect(pointInRing([{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0.5, y: 0.5 })).toBe(
      false,
    );
  });

  it("gives the same answer regardless of winding", () => {
    const reversed = reverseRing(square);
    expect(pointInRing(reversed, { x: 5, y: 5 })).toBe(true);
    expect(pointInRing(reversed, { x: 50, y: 5 })).toBe(false);
  });
});

describe("distance helpers", () => {
  it("clamps distanceToSegment to the segment", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 10);
    // Beyond the end: measured to the endpoint, not the infinite line.
    expect(distanceToSegment({ x: 20, y: 0 }, a, b)).toBeCloseTo(10, 10);
    expect(distanceToSegment({ x: 0, y: 0 }, a, a)).toBe(0);
  });

  it("perpendicularDistance measures against the infinite line", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(perpendicularDistance({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 10);
    // Unlike distanceToSegment, this stays 0 past the endpoint.
    expect(perpendicularDistance({ x: 20, y: 0 }, a, b)).toBeCloseTo(0, 10);
  });
});

describe("isValidRing", () => {
  it("requires at least three points", () => {
    expect(isValidRing([])).toBe(false);
    expect(isValidRing([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false);
    expect(isValidRing(square)).toBe(true);
  });
});
