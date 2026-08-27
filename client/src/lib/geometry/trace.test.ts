import { pointInRing, ringArea, ringBounds, signedArea } from "@shared/geometry/rings";
import type { Bounds, Ring } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { annulusPredicate, anyOf, rectPredicate } from "./fixtures";
import { buildOutline, outlineArea } from "./outline";
import { fieldFromPredicate, traceIsoRings } from "./trace";

/**
 * Longest edge of a closed ring, including the implicit closing edge.
 *
 * Marching squares never steps further than one cell, so every edge of a
 * genuinely closed ring is at most the cell diagonal (√2). An *open* contour
 * that got returned as a ring anyway betrays itself here: its closing edge
 * jumps straight across the shape.
 */
function longestEdge(ring: Ring): number {
  let longest = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    longest = Math.max(longest, Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y));
  }
  return longest;
}

/** Asserts a ring is a closed, non-degenerate marching-squares contour. */
function expectClosedContour(ring: Ring): void {
  expect(ring.length).toBeGreaterThanOrEqual(3);
  expect(longestEdge(ring)).toBeLessThanOrEqual(1.5);
}

const boundsOf = (ring: Ring): Bounds => ringBounds(ring) as Bounds;

/** Every coordinate of every ring, flattened — for sub-pixel assertions. */
const allCoordinates = (rings: Ring[]): number[] =>
  rings.flatMap((ring) => ring.flatMap((p) => [p.x, p.y]));

const ISO = 128;

/**
 * A field whose value ramps linearly from 0 at x = 3 to 255 at x = 6, saturating
 * outside that band. A hard step gives interpolation nothing to bite on, so a
 * graded edge is the only way to tell sub-pixel placement from snapping.
 */
function gradedField(width: number, height: number): Float32Array {
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = x <= 3 ? 0 : x >= 6 ? 255 : ((x - 3) / 3) * 255;
      field[y * width + x] = value;
    }
  }
  return field;
}

/** Leftmost traced x inside the graded band, i.e. where the iso level lands. */
function gradedEdgeX(rings: Ring[]): number {
  const xs = rings.flat().map((p) => p.x).filter((x) => x > 3 && x < 6);
  expect(xs.length).toBeGreaterThan(0);
  return Math.min(...xs);
}

describe("traceIsoRings", () => {
  it("traces a solid rectangle as one ring", () => {
    // Pixels 10..29 inclusive on both axes: 20 x 20 of material. The contour
    // runs half a pixel outside the last inside sample on every side.
    const field = fieldFromPredicate(40, 40, rectPredicate(10, 10, 29, 29));
    const rings = traceIsoRings(field, 40, 40, { iso: ISO });

    expect(rings).toHaveLength(1);
    expectClosedContour(rings[0]);
    expect(ringArea(rings[0])).toBeGreaterThan(400 * 0.98);
    expect(ringArea(rings[0])).toBeLessThan(400 * 1.02);

    const bounds = boundsOf(rings[0]);
    expect(bounds.minX).toBeCloseTo(9.5, 1);
    expect(bounds.minY).toBeCloseTo(9.5, 1);
    expect(bounds.maxX).toBeCloseTo(29.5, 1);
    expect(bounds.maxY).toBeCloseTo(29.5, 1);
  });

  it("traces an annulus as a shell and a hole", () => {
    const outerR = 30;
    const innerR = 10;
    const field = fieldFromPredicate(80, 80, annulusPredicate(40, 40, innerR, outerR));
    const rings = traceIsoRings(field, 80, 80, { iso: ISO });

    expect(rings).toHaveLength(2);
    for (const ring of rings) expectClosedContour(ring);

    const outline = buildOutline(rings);
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(1);

    const analytic = Math.PI * (outerR * outerR - innerR * innerR);
    expect(outlineArea(outline)).toBeGreaterThan(analytic * 0.95);
    expect(outlineArea(outline)).toBeLessThan(analytic * 1.05);
  });

  it("traces two disjoint rectangles as two shapes with no holes", () => {
    const field = fieldFromPredicate(
      60,
      30,
      anyOf(rectPredicate(5, 5, 15, 24), rectPredicate(40, 5, 54, 24)),
    );
    const rings = traceIsoRings(field, 60, 30, { iso: ISO });

    expect(rings).toHaveLength(2);
    const outline = buildOutline(rings);
    expect(outline).toHaveLength(2);
    expect(outline.every((shape) => shape.holes.length === 0)).toBe(true);

    // 15 x 20 and 11 x 20 of material, largest shape first.
    expect(ringArea(outline[0].outer)).toBeGreaterThan(300 * 0.98);
    expect(ringArea(outline[0].outer)).toBeLessThan(300 * 1.02);
    expect(ringArea(outline[1].outer)).toBeGreaterThan(220 * 0.98);
    expect(ringArea(outline[1].outer)).toBeLessThan(220 * 1.02);
  });

  it("orients shells positive and holes negative", () => {
    // The tracer, not `buildOutline`, is responsible for the winding; assert it
    // on the raw output as well as after grouping.
    const field = fieldFromPredicate(80, 80, annulusPredicate(40, 40, 10, 30));
    const rings = traceIsoRings(field, 80, 80, { iso: ISO });
    const [shell, hole] = [...rings].sort((a, b) => ringArea(b) - ringArea(a));

    expect(signedArea(shell)).toBeGreaterThan(0);
    expect(signedArea(hole)).toBeLessThan(0);

    const outline = buildOutline(rings);
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
    expect(signedArea(outline[0].holes[0])).toBeLessThan(0);
  });
});

describe("traceIsoRings border padding", () => {
  it("closes the contour of an object flush with the image edge", () => {
    // The virtual one-cell background pad exists for exactly this: without it
    // the left edge has no cell to cross and the contour comes back open. Every
    // cropped region hits this case.
    const field = fieldFromPredicate(40, 40, rectPredicate(0, 10, 19, 29));
    const rings = traceIsoRings(field, 40, 40, { iso: ISO });

    expect(rings).toHaveLength(1);
    expectClosedContour(rings[0]);

    const bounds = boundsOf(rings[0]);
    expect(bounds.minX).toBeLessThan(0); // Ran out past the image edge.
    expect(bounds.maxX).toBeCloseTo(19.5, 1);
    expect(bounds.minY).toBeCloseTo(9.5, 1);
    expect(bounds.maxY).toBeCloseTo(29.5, 1);

    // 20 x 20 of material. The pad sits one cell out, so the flush side carries
    // a little more slack than an interior edge.
    expect(ringArea(rings[0])).toBeGreaterThan(400 * 0.95);
    expect(ringArea(rings[0])).toBeLessThan(400 * 1.05);
  });

  it("closes the contour of a field that is entirely foreground", () => {
    const field = fieldFromPredicate(24, 16, () => true);
    const rings = traceIsoRings(field, 24, 16, { iso: ISO });

    expect(rings).toHaveLength(1);
    expectClosedContour(rings[0]);
    expect(signedArea(rings[0])).toBeGreaterThan(0);

    // The ring wraps the whole field: every corner pixel centre is inside it,
    // and it extends past the image on all four sides.
    for (const corner of [
      { x: 0, y: 0 },
      { x: 23, y: 0 },
      { x: 23, y: 15 },
      { x: 0, y: 15 },
    ]) {
      expect(pointInRing(rings[0], corner)).toBe(true);
    }

    const bounds = boundsOf(rings[0]);
    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.minY).toBeLessThan(0);
    expect(bounds.maxX).toBeGreaterThan(23);
    expect(bounds.maxY).toBeGreaterThan(15);
  });
});

describe("traceIsoRings sub-pixel interpolation", () => {
  const width = 10;
  const height = 5;

  it("places the boundary between pixel centres when interpolating", () => {
    const field = gradedField(width, height);
    const rings = traceIsoRings(field, width, height, { iso: ISO, interpolate: true });

    expect(rings).toHaveLength(1);
    // Samples are 85 at x = 4 and 170 at x = 5, so iso 128 falls 43/85 of the
    // way across — a position no snapping scheme could produce.
    expect(gradedEdgeX(rings)).toBeCloseTo(4 + 43 / 85, 3);
    expect(allCoordinates(rings).some((v) => !Number.isInteger(v * 2))).toBe(true);
  });

  it("snaps to cell midpoints when not interpolating", () => {
    const field = gradedField(width, height);
    const rings = traceIsoRings(field, width, height, { iso: ISO, interpolate: false });

    expect(rings).toHaveLength(1);
    expect(gradedEdgeX(rings)).toBeCloseTo(4.5, 9);
    // Crossings land either on a pixel centre or exactly halfway between two.
    for (const value of allCoordinates(rings)) {
      expect(Number.isInteger(value * 2)).toBe(true);
    }
  });

  it("moves the boundary up the ramp as the iso level rises", () => {
    const field = gradedField(width, height);
    const edgeAt = (iso: number) =>
      gradedEdgeX(traceIsoRings(field, width, height, { iso, interpolate: true }));

    // 0 at x = 3, 85 at x = 4, 170 at x = 5, 255 at x = 6.
    expect(edgeAt(64)).toBeCloseTo(3 + 64 / 85, 3);
    expect(edgeAt(128)).toBeCloseTo(4 + 43 / 85, 3);
    expect(edgeAt(200)).toBeCloseTo(5 + 30 / 85, 3);
    expect(edgeAt(64)).toBeLessThan(edgeAt(128));
    expect(edgeAt(128)).toBeLessThan(edgeAt(200));
  });
});

describe("traceIsoRings saddle handling", () => {
  /** Two 2x2 blocks meeting only at the corner between (2,2) and (3,3). */
  const saddleField = () =>
    fieldFromPredicate(
      8,
      8,
      anyOf(rectPredicate(1, 1, 2, 2), rectPredicate(3, 3, 4, 4)),
    );

  it("keeps diagonally touching blobs apart with ambiguity 'separate'", () => {
    const rings = traceIsoRings(saddleField(), 8, 8, { iso: ISO, ambiguity: "separate" });

    expect(rings).toHaveLength(2);
    for (const ring of rings) expectClosedContour(ring);
    expect(buildOutline(rings)).toHaveLength(2);
    // The two blocks are congruent, so the split must treat them alike.
    expect(ringArea(rings[0])).toBeCloseTo(ringArea(rings[1]), 6);
  });

  it("merges diagonally touching blobs with ambiguity 'connect'", () => {
    const rings = traceIsoRings(saddleField(), 8, 8, { iso: ISO, ambiguity: "connect" });

    expect(rings).toHaveLength(1);
    expectClosedContour(rings[0]);
    expect(buildOutline(rings)).toHaveLength(1);

    const separate = traceIsoRings(saddleField(), 8, 8, {
      iso: ISO,
      ambiguity: "separate",
    });
    const separateArea = separate.reduce((total, ring) => total + ringArea(ring), 0);
    expect(ringArea(rings[0])).toBeGreaterThan(separateArea);
  });

  it("defaults to keeping them apart", () => {
    expect(traceIsoRings(saddleField(), 8, 8, { iso: ISO })).toEqual(
      traceIsoRings(saddleField(), 8, 8, { iso: ISO, ambiguity: "separate" }),
    );
  });

  it("resolves the saddle deterministically across runs", () => {
    // An inconsistent choice produces self-touching rings that break offsetting
    // and triangulation downstream, and the failure would be intermittent.
    for (const ambiguity of ["separate", "connect"] as const) {
      const runs = [0, 1, 2].map(() =>
        JSON.stringify(traceIsoRings(saddleField(), 8, 8, { iso: ISO, ambiguity })),
      );
      expect(runs[1]).toBe(runs[0]);
      expect(runs[2]).toBe(runs[0]);
    }
  });
});

describe("traceIsoRings guards", () => {
  it("returns nothing for a zero-sized field", () => {
    expect(traceIsoRings(new Uint8Array(0), 0, 10, { iso: ISO })).toEqual([]);
    expect(traceIsoRings(new Uint8Array(0), 10, 0, { iso: ISO })).toEqual([]);
    expect(traceIsoRings(new Uint8Array(0), 0, 0, { iso: ISO })).toEqual([]);
  });

  it("returns nothing for an all-background field", () => {
    const field = fieldFromPredicate(16, 16, () => false);
    expect(traceIsoRings(field, 16, 16, { iso: ISO })).toEqual([]);
  });
});

describe("fieldFromPredicate", () => {
  it("marks inside samples 255 and outside samples 0", () => {
    const field = fieldFromPredicate(4, 3, rectPredicate(1, 1, 2, 1));
    expect(Array.from(field)).toEqual([
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ]);
  });
});
