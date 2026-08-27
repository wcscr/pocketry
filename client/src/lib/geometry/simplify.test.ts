import { ringArea, ringPerimeter, signedArea } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import {
  C_SHAPE_BAY_CENTRE,
  C_SHAPE_SOLID_POINT,
  circleRing,
  convexHullForTest,
  cShapeRing,
  polygonArea,
  rectRing,
} from "./fixtures";
import { buildOutline, pointInOutline } from "./outline";
import {
  resampleOutline,
  resampleRing,
  simplifyOutline,
  simplifyRing,
  smoothOutline,
  smoothRingTaubin,
} from "./simplify";

/** Wraps a bare ring as an outline so `pointInOutline` can be used on it. */
const asOutline = (ring: Ring): Outline => [{ outer: ring, holes: [] }];

/** Edge lengths of a closed ring, including the implicit closing edge. */
function edgeLengths(ring: Ring): number[] {
  const out: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    out.push(Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y));
  }
  return out;
}

/** Worst deviation of a ring's vertices from a circle of `radius` about the origin. */
function maxRadialDeviation(ring: Ring, radius: number): number {
  return Math.max(...ring.map((p) => Math.abs(Math.hypot(p.x, p.y) - radius)));
}

/** Same cyclic order, different start index — what a tracer's start point varies. */
const rotate = (ring: Ring, k: number): Ring => [...ring.slice(k), ...ring.slice(0, k)];

/**
 * A closed ring with three lobes. Concave, densely sampled and free of any
 * exact symmetry in its vertex spacing, so the "farthest-apart pair" split used
 * by `simplifyRing` has something non-trivial to find.
 */
function trefoilRing(points = 120): Ring {
  const ring: Point[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const radius = 50 + 8 * Math.cos(3 * angle);
    ring.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return ring;
}

/**
 * A square resampled to an even spacing, then given a small perpendicular
 * zigzag along its edges. The four true corners are left exactly on the corner
 * so the corner-pinning assertions have a fixed target.
 */
function noisySquare(amplitude: number, spacing = 5): Ring {
  return resampleRing(rectRing(0, 0, 100, 100), spacing).map((p, i) => {
    const onVerticalEdge = p.x === 0 || p.x === 100;
    const onHorizontalEdge = p.y === 0 || p.y === 100;
    if (onVerticalEdge && onHorizontalEdge) return p; // A corner: leave it be.
    const offset = i % 2 === 0 ? amplitude : -amplitude;
    return onHorizontalEdge
      ? { x: p.x, y: p.y + offset }
      : { x: p.x + offset, y: p.y };
  });
}

const SQUARE_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const indexOfPoint = (ring: Ring, target: Point): number =>
  ring.findIndex((p) => Math.hypot(p.x - target.x, p.y - target.y) < 1e-9);

describe("simplifyRing", () => {
  it("drops collinear points and keeps the corners", () => {
    const withMidpoints: Ring = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 50 },
    ];
    expect(simplifyRing(withMidpoints, 0.01)).toEqual(rectRing(0, 0, 100, 100));
  });

  it("removes a near-collinear point only once it is within tolerance", () => {
    // A 0.1px bump on an otherwise straight edge: pixel noise, not a feature.
    const bumped: Ring = [
      { x: 0, y: 0 },
      { x: 50, y: 0.1 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(simplifyRing(bumped, 0.5)).toHaveLength(4);
    expect(simplifyRing(bumped, 0.05)).toHaveLength(5);
  });

  it("leaves the bay of a C-shape empty", () => {
    // The regression this module exists for: the previous `simplifyPoints` took
    // a convex hull first, which filled in every bay by construction. Point
    // counts prove nothing here — only the geometry does.
    const dense = resampleRing(cShapeRing(), 1);
    const simplified = simplifyRing(dense, 1);

    expect(pointInOutline(asOutline(simplified), C_SHAPE_BAY_CENTRE)).toBe(false);
    expect(pointInOutline(asOutline(simplified), C_SHAPE_SOLID_POINT)).toBe(true);
    // Genuinely non-convex: a hull of the result would be much larger.
    expect(polygonArea(simplified)).toBeLessThan(
      polygonArea(convexHullForTest(simplified)) * 0.9,
    );
  });

  it("leaves the bay empty even when the ring is already minimal", () => {
    const simplified = simplifyRing(cShapeRing(), 2);
    expect(pointInOutline(asOutline(simplified), C_SHAPE_BAY_CENTRE)).toBe(false);
    expect(pointInOutline(asOutline(simplified), C_SHAPE_SOLID_POINT)).toBe(true);
    expect(polygonArea(simplified)).toBeLessThan(
      polygonArea(convexHullForTest(simplified)) * 0.9,
    );
  });

  it("preserves area within 2% at a reasonable tolerance", () => {
    const circle = circleRing(0, 0, 50, 256);
    const simplifiedCircle = simplifyRing(circle, 0.5);
    expect(simplifiedCircle.length).toBeLessThan(circle.length);
    expect(polygonArea(simplifiedCircle)).toBeGreaterThan(polygonArea(circle) * 0.98);
    expect(polygonArea(simplifiedCircle)).toBeLessThan(polygonArea(circle) * 1.02);

    const dense = resampleRing(cShapeRing(), 1);
    const simplifiedC = simplifyRing(dense, 1);
    expect(simplifiedC.length).toBeLessThan(dense.length);
    expect(polygonArea(simplifiedC)).toBeGreaterThan(polygonArea(dense) * 0.98);
    expect(polygonArea(simplifiedC)).toBeLessThan(polygonArea(dense) * 1.02);
  });

  it("never returns fewer than three points", () => {
    // A collapsed ring is not a ring; downstream offsetting and triangulation
    // both assume at least a triangle.
    expect(simplifyRing(cShapeRing(), 1e6).length).toBeGreaterThanOrEqual(3);
    expect(simplifyRing(circleRing(0, 0, 50, 256), 1e6).length).toBeGreaterThanOrEqual(3);
  });

  it("returns a copy and never mutates its input", () => {
    const ring = cShapeRing();
    const before = JSON.stringify(ring);
    const result = simplifyRing(ring, 2);

    expect(result).not.toBe(ring);
    expect(JSON.stringify(ring)).toBe(before);
  });

  it("returns the ring unchanged for a non-positive tolerance", () => {
    const ring = cShapeRing();
    for (const tolerance of [0, -1]) {
      const result = simplifyRing(ring, tolerance);
      expect(result).toEqual(ring);
      expect(result).not.toBe(ring);
    }
  });

  it("returns rings of three or fewer points unchanged", () => {
    const triangle: Ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(simplifyRing(triangle, 100)).toEqual(triangle);
    expect(simplifyRing([{ x: 0, y: 0 }, { x: 1, y: 1 }], 100)).toHaveLength(2);
  });

  it("is independent of where the ring starts", () => {
    // This is what splitting at the two farthest-apart vertices buys: plain RDP
    // would pin whichever vertex the tracer happened to emit first, so the same
    // outline traced from a different start point would simplify differently.
    const circle = circleRing(0, 0, 50, 200);
    const circleBaseline = polygonArea(simplifyRing(circle, 0.5));
    for (let k = 0; k < circle.length; k += 13) {
      const area = polygonArea(simplifyRing(rotate(circle, k), 0.5));
      expect(area).toBeCloseTo(circleBaseline, 6);
    }

    const dense = resampleRing(cShapeRing(), 1);
    const cBaseline = polygonArea(simplifyRing(dense, 1));
    for (let k = 0; k < dense.length; k += 37) {
      expect(polygonArea(simplifyRing(rotate(dense, k), 1))).toBeCloseTo(cBaseline, 6);
    }

    // A lobed concave ring is the hard case: the diameter heuristic can land on
    // a slightly different vertex pair, so the areas agree to a fraction of a
    // percent rather than exactly.
    const trefoil = trefoilRing();
    const trefoilBaseline = polygonArea(simplifyRing(trefoil, 1));
    for (let k = 0; k < trefoil.length; k++) {
      const area = polygonArea(simplifyRing(rotate(trefoil, k), 1));
      expect(Math.abs(area - trefoilBaseline) / trefoilBaseline).toBeLessThan(0.01);
    }
  });
});

describe("resampleRing", () => {
  it("produces roughly uniform spacing", () => {
    // Taubin weights neighbours equally, so it over-smooths densely sampled
    // stretches unless the ring is evenly spaced first.
    const resampled = resampleRing(circleRing(0, 0, 50, 256), 5);
    for (const length of edgeLengths(resampled)) {
      expect(length).toBeGreaterThan(5 * 0.95);
      expect(length).toBeLessThan(5 * 1.05);
    }
  });

  it("hits the requested spacing exactly on straight edges", () => {
    const resampled = resampleRing(rectRing(0, 0, 100, 100), 10);
    expect(resampled).toHaveLength(40);
    for (const length of edgeLengths(resampled)) expect(length).toBeCloseTo(10, 9);
    expect(polygonArea(resampled)).toBeCloseTo(10000, 9);
  });

  it("preserves perimeter and area on a circle", () => {
    const circle = circleRing(0, 0, 50, 256);
    const resampled = resampleRing(circle, 5);
    expect(ringPerimeter(resampled)).toBeCloseTo(ringPerimeter(circle), 0);
    expect(polygonArea(resampled)).toBeGreaterThan(polygonArea(circle) * 0.99);
    expect(polygonArea(resampled)).toBeLessThan(polygonArea(circle) * 1.01);
  });

  it("produces about perimeter / spacing points", () => {
    const circle = circleRing(0, 0, 50, 256);
    const expected = ringPerimeter(circle) / 5;
    expect(Math.abs(resampleRing(circle, 5).length - expected)).toBeLessThanOrEqual(1);
  });

  it("returns the ring unchanged for a non-positive spacing", () => {
    const ring = cShapeRing();
    for (const spacing of [0, -3]) {
      const result = resampleRing(ring, spacing);
      expect(result).toEqual(ring);
      expect(result).not.toBe(ring);
    }
  });

  it("returns rings with fewer than three points unchanged", () => {
    const stub: Ring = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(resampleRing(stub, 1)).toEqual(stub);
  });

  it("returns a zero-perimeter ring unchanged rather than looping", () => {
    // Every vertex coincident: dividing the perimeter into steps would divide
    // by zero and walk the segment cursor forever.
    const degenerate: Ring = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    const result = resampleRing(degenerate, 1);
    expect(result).toEqual(degenerate);
    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe("smoothRingTaubin", () => {
  it("does not shrink the ring", () => {
    // The entire reason for Taubin over Laplacian/Chaikin: a shrunken outline
    // means an undersized exported pocket. The λ pass pulls in, the μ pass
    // pushes back out, so the net area change stays near zero.
    const circle = circleRing(0, 0, 50, 128);
    const smoothed = smoothRingTaubin(circle, { iterations: 40 });
    expect(polygonArea(smoothed)).toBeGreaterThan(polygonArea(circle) * 0.98);
    expect(polygonArea(smoothed)).toBeLessThan(polygonArea(circle) * 1.02);
  });

  it("shrinks visibly once the expanding pass is disabled", () => {
    // `mu: 0` reduces Taubin to a plain Laplacian, which is the behaviour this
    // module is chosen to avoid — kept as a live contrast rather than a comment.
    const circle = circleRing(0, 0, 50, 128);
    const laplacian = smoothRingTaubin(circle, { iterations: 40, mu: 0 });
    expect(polygonArea(laplacian)).toBeLessThan(polygonArea(circle) * 0.98);
  });

  it("removes high-frequency noise", () => {
    const circle = circleRing(0, 0, 50, 128);
    // Alternating radial jitter: the highest frequency the sampling can carry.
    const noisy = circle.map((p, i) => {
      const scale = (50 + (i % 2 === 0 ? 0.3 : -0.3)) / 50;
      return { x: p.x * scale, y: p.y * scale };
    });

    expect(maxRadialDeviation(noisy, 50)).toBeCloseTo(0.3, 6);
    const smoothed = smoothRingTaubin(noisy, { iterations: 10 });
    expect(maxRadialDeviation(smoothed, 50)).toBeLessThan(
      maxRadialDeviation(noisy, 50) / 10,
    );
  });

  it("pins corners at the default angle threshold", () => {
    // A tool outline's corners are signal, not noise; smoothing them rounds off
    // exactly the features the user is tracing.
    const noisy = noisySquare(0.5);
    const smoothed = smoothRingTaubin(noisy, { iterations: 10 });

    const cornerIndices = SQUARE_CORNERS.map((corner) => indexOfPoint(noisy, corner));
    expect(cornerIndices.every((index) => index >= 0)).toBe(true);
    for (const [i, corner] of SQUARE_CORNERS.entries()) {
      const moved = smoothed[cornerIndices[i]];
      expect(Math.hypot(moved.x - corner.x, moved.y - corner.y)).toBeLessThan(1e-9);
    }

    // Meanwhile the noisy stretches between the corners really do move.
    const cornerSet = new Set(cornerIndices);
    const freeMovement = noisy
      .map((p, i) => Math.hypot(smoothed[i].x - p.x, smoothed[i].y - p.y))
      .filter((_, i) => !cornerSet.has(i));
    expect(Math.min(...freeMovement)).toBeGreaterThan(0.1);
  });

  it("smooths everything at cornerAngleDeg 180", () => {
    const noisy = noisySquare(0.5);
    const smoothed = smoothRingTaubin(noisy, { iterations: 10, cornerAngleDeg: 180 });

    for (const corner of SQUARE_CORNERS) {
      const moved = smoothed[indexOfPoint(noisy, corner)];
      expect(Math.hypot(moved.x - corner.x, moved.y - corner.y)).toBeGreaterThan(0.5);
    }
  });

  it("returns the ring unchanged for zero iterations", () => {
    const ring = cShapeRing();
    const result = smoothRingTaubin(ring, { iterations: 0 });
    expect(result).toEqual(ring);
    expect(result).not.toBe(ring);
  });

  it("returns rings with fewer than five points unchanged", () => {
    // Below five vertices every point is its own neighbour's neighbour, so a
    // relaxation pass would collapse the ring rather than smooth it.
    const square = rectRing(0, 0, 10, 10);
    expect(smoothRingTaubin(square, { iterations: 5 })).toEqual(square);
  });
});

describe("outline-level wrappers", () => {
  /** A ring-model annulus: a dense circular shell with a dense circular hole. */
  const annulus: Outline = buildOutline([
    resampleRing(circleRing(0, 0, 60, 200), 1),
    resampleRing(circleRing(0, 0, 20, 120), 1),
  ]);

  /** Shells positive, holes negative — the invariant every stage must keep. */
  const expectStructurePreserved = (outline: Outline): void => {
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(1);
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
    expect(signedArea(outline[0].holes[0])).toBeLessThan(0);
  };

  it("starts from a well-formed fixture", () => {
    expectStructurePreserved(annulus);
  });

  it("simplifyOutline decimates shells and holes alike", () => {
    const simplified = simplifyOutline(annulus, 0.5);
    expectStructurePreserved(simplified);
    expect(simplified[0].outer.length).toBeLessThan(annulus[0].outer.length);
    expect(simplified[0].holes[0].length).toBeLessThan(annulus[0].holes[0].length);
    expect(ringArea(simplified[0].outer)).toBeGreaterThan(
      ringArea(annulus[0].outer) * 0.98,
    );
    expect(ringArea(simplified[0].holes[0])).toBeGreaterThan(
      ringArea(annulus[0].holes[0]) * 0.95,
    );
  });

  it("smoothOutline smooths shells and holes alike", () => {
    const smoothed = smoothOutline(annulus, { iterations: 5 });
    expectStructurePreserved(smoothed);
    expect(smoothed[0].outer).toHaveLength(annulus[0].outer.length);
    expect(smoothed[0].holes[0]).toHaveLength(annulus[0].holes[0].length);
    expect(ringArea(smoothed[0].outer)).toBeCloseTo(ringArea(annulus[0].outer), 0);
    expect(ringArea(smoothed[0].holes[0])).toBeCloseTo(ringArea(annulus[0].holes[0]), 0);
  });

  it("resampleOutline resamples shells and holes alike", () => {
    const resampled = resampleOutline(annulus, 5);
    expectStructurePreserved(resampled);
    expect(
      Math.abs(resampled[0].outer.length - ringPerimeter(annulus[0].outer) / 5),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(resampled[0].holes[0].length - ringPerimeter(annulus[0].holes[0]) / 5),
    ).toBeLessThanOrEqual(1);
  });

  it("leaves an empty outline empty", () => {
    expect(simplifyOutline([], 1)).toEqual([]);
    expect(smoothOutline([], { iterations: 3 })).toEqual([]);
    expect(resampleOutline([], 5)).toEqual([]);
  });
});
