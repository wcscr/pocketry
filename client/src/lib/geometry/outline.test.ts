import { ringArea, signedArea } from "@shared/geometry/rings";
import { OUTER_RING, type Outline, type Ring } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { circleRing, cShapeRing, rectRing } from "./fixtures";
import {
  buildOutline,
  flattenOutline,
  flipOutlineY,
  getRing,
  normalizeOutline,
  outlineArea,
  outlineBounds,
  outlineFromPoints,
  outlinePointCount,
  pointInOutline,
  removeRing,
  representativePoint,
  setRing,
} from "./outline";

describe("buildOutline", () => {
  it("returns a single shape for one ring", () => {
    const outline = buildOutline([rectRing(0, 0, 10, 10)]);
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(0);
  });

  it("nests a hole inside its shell", () => {
    const outline = buildOutline([rectRing(0, 0, 20, 20), rectRing(5, 5, 10, 10)]);
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(1);
    expect(ringArea(outline[0].outer)).toBe(400);
    expect(ringArea(outline[0].holes[0])).toBe(100);
  });

  it("orients shells positive and holes negative", () => {
    const outline = buildOutline([rectRing(0, 0, 20, 20), rectRing(5, 5, 10, 10)]);
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
    expect(signedArea(outline[0].holes[0])).toBeLessThan(0);
  });

  it("is insensitive to input ring order and winding", () => {
    const shell = rectRing(0, 0, 20, 20);
    const hole = rectRing(5, 5, 10, 10);
    const a = buildOutline([shell, hole]);
    const b = buildOutline([hole.slice().reverse(), shell.slice().reverse()]);

    expect(b).toHaveLength(a.length);
    expect(b[0].holes).toHaveLength(1);
    expect(signedArea(b[0].outer)).toBeGreaterThan(0);
    expect(signedArea(b[0].holes[0])).toBeLessThan(0);
  });

  it("keeps two disjoint parts as separate shapes", () => {
    const outline = buildOutline([rectRing(0, 0, 10, 10), rectRing(50, 0, 10, 10)]);
    expect(outline).toHaveLength(2);
    expect(outline.every((shape) => shape.holes.length === 0)).toBe(true);
  });

  it("promotes an island inside a hole to its own shape", () => {
    // depth 0 shell, depth 1 hole, depth 2 island.
    const outline = buildOutline([
      rectRing(0, 0, 100, 100),
      rectRing(20, 20, 60, 60),
      rectRing(40, 40, 20, 20),
    ]);
    expect(outline).toHaveLength(2);
    expect(ringArea(outline[0].outer)).toBe(10000);
    expect(outline[0].holes).toHaveLength(1);
    expect(ringArea(outline[1].outer)).toBe(400);
    expect(outline[1].holes).toHaveLength(0);
  });

  it("assigns a hole to its nearest enclosing shell", () => {
    // Two nested shells (depths 0 and 2) and a hole at depth 3; the hole
    // belongs to the inner shell, not the outer one.
    const outline = buildOutline([
      rectRing(0, 0, 100, 100),
      rectRing(10, 10, 80, 80),
      rectRing(20, 20, 60, 60),
      rectRing(30, 30, 40, 40),
    ]);
    const inner = outline.find((shape) => ringArea(shape.outer) === 3600);
    expect(inner?.holes).toHaveLength(1);
    expect(ringArea(inner!.holes[0])).toBe(1600);
  });

  it("sorts shapes largest first", () => {
    const outline = buildOutline([rectRing(0, 0, 5, 5), rectRing(50, 0, 30, 30)]);
    expect(ringArea(outline[0].outer)).toBe(900);
    expect(ringArea(outline[1].outer)).toBe(25);
  });

  it("drops rings with fewer than three points", () => {
    const stub: Ring = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(buildOutline([stub])).toHaveLength(0);
  });

  it("returns an empty outline for no rings", () => {
    expect(buildOutline([])).toEqual([]);
  });

  it("nests a hole in a concave shell", () => {
    // The hole sits in the solid part of a C, not in its bay.
    const outline = buildOutline([cShapeRing(), rectRing(10, 40, 10, 10)]);
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(1);
  });
});

describe("representativePoint", () => {
  it("lands inside a convex ring", () => {
    const ring = rectRing(0, 0, 10, 10);
    const point = representativePoint(ring);
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(10);
  });

  it("lands inside a concave ring, not in its bay", () => {
    // The centroid of a C can fall in the bay; this must not.
    const ring = cShapeRing();
    const point = representativePoint(ring);
    expect(pointInOutline([{ outer: ring, holes: [] }], point)).toBe(true);
  });

  it("lands inside a circle", () => {
    const ring = circleRing(50, 50, 20);
    const point = representativePoint(ring);
    expect(pointInOutline([{ outer: ring, holes: [] }], point)).toBe(true);
  });
});

describe("normalizeOutline", () => {
  it("fixes winding on both shells and holes", () => {
    const outline: Outline = [
      { outer: rectRing(0, 0, 20, 20).reverse(), holes: [rectRing(5, 5, 10, 10)] },
    ];
    const normalized = normalizeOutline(outline);
    expect(signedArea(normalized[0].outer)).toBeGreaterThan(0);
    expect(signedArea(normalized[0].holes[0])).toBeLessThan(0);
  });

  it("drops shells below the area fraction", () => {
    const outline: Outline = [
      { outer: rectRing(0, 0, 100, 100), holes: [] },
      { outer: rectRing(200, 0, 5, 5), holes: [] },
    ];
    const normalized = normalizeOutline(outline, { minShellAreaFrac: 0.01 });
    expect(normalized).toHaveLength(1);
    expect(ringArea(normalized[0].outer)).toBe(10000);
  });

  it("drops holes below the area fraction of their parent", () => {
    const outline: Outline = [
      {
        outer: rectRing(0, 0, 100, 100),
        holes: [rectRing(10, 10, 50, 50), rectRing(80, 80, 2, 2)],
      },
    ];
    const normalized = normalizeOutline(outline, { minHoleAreaFrac: 0.001 });
    expect(normalized[0].holes).toHaveLength(1);
    expect(ringArea(normalized[0].holes[0])).toBe(2500);
  });

  it("removes degenerate rings", () => {
    const outline: Outline = [
      { outer: rectRing(0, 0, 10, 10), holes: [[{ x: 1, y: 1 }, { x: 2, y: 2 }]] },
      { outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [] },
    ];
    const normalized = normalizeOutline(outline);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].holes).toHaveLength(0);
  });

  it("keeps everything when no thresholds are given", () => {
    const outline: Outline = [
      { outer: rectRing(0, 0, 100, 100), holes: [rectRing(80, 80, 2, 2)] },
      { outer: rectRing(200, 0, 5, 5), holes: [] },
    ];
    const normalized = normalizeOutline(outline);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].holes).toHaveLength(1);
  });
});

describe("outline measurements", () => {
  const outline: Outline = buildOutline([
    rectRing(0, 0, 20, 20),
    rectRing(5, 5, 10, 10),
  ]);

  it("nets holes out of the area", () => {
    expect(outlineArea(outline)).toBe(400 - 100);
  });

  it("bounds only the shells", () => {
    expect(outlineBounds(outline)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 20,
    });
    expect(outlineBounds([])).toBeNull();
  });

  it("counts points across every ring", () => {
    expect(outlinePointCount(outline)).toBe(8);
  });
});

describe("flipOutlineY", () => {
  it("mirrors coordinates about the height", () => {
    const outline = outlineFromPoints(rectRing(0, 10, 20, 30));
    const flipped = flipOutlineY(outline, 100);
    const bounds = outlineBounds(flipped)!;
    expect(bounds.minY).toBe(100 - 40);
    expect(bounds.maxY).toBe(100 - 10);
  });

  it("preserves the orientation invariant by reversing rings", () => {
    // Negating y alone would flip every signed area and turn shells into
    // holes. This is the guard for the mirrored-STL class of bug.
    const outline = buildOutline([rectRing(0, 0, 20, 20), rectRing(5, 5, 10, 10)]);
    const flipped = flipOutlineY(outline, 100);

    expect(signedArea(flipped[0].outer)).toBeGreaterThan(0);
    expect(signedArea(flipped[0].holes[0])).toBeLessThan(0);
    expect(outlineArea(flipped)).toBeCloseTo(outlineArea(outline), 10);
  });

  it("round-trips", () => {
    const outline = buildOutline([cShapeRing()]);
    const twice = flipOutlineY(flipOutlineY(outline, 100), 100);
    expect(outlineArea(twice)).toBeCloseTo(outlineArea(outline), 10);
    expect(new Set(twice[0].outer.map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(outline[0].outer.map((p) => `${p.x},${p.y}`)),
    );
  });
});

describe("ring accessors", () => {
  const outline = buildOutline([rectRing(0, 0, 20, 20), rectRing(5, 5, 10, 10)]);

  it("resolves refs", () => {
    expect(getRing(outline, { shapeIndex: 0, ringIndex: OUTER_RING })).toBe(
      outline[0].outer,
    );
    expect(getRing(outline, { shapeIndex: 0, ringIndex: 0 })).toBe(
      outline[0].holes[0],
    );
    expect(getRing(outline, { shapeIndex: 9, ringIndex: OUTER_RING })).toBeNull();
    expect(getRing(outline, { shapeIndex: 0, ringIndex: 5 })).toBeNull();
  });

  it("replaces a ring without mutating the original", () => {
    const replacement = rectRing(1, 1, 2, 2);
    const updated = setRing(outline, { shapeIndex: 0, ringIndex: 0 }, replacement);
    expect(updated[0].holes[0]).toBe(replacement);
    expect(outline[0].holes[0]).not.toBe(replacement);
  });

  it("removes a hole", () => {
    const updated = removeRing(outline, { shapeIndex: 0, ringIndex: 0 });
    expect(updated[0].holes).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });

  it("removes a shell along with its holes", () => {
    const updated = removeRing(outline, { shapeIndex: 0, ringIndex: OUTER_RING });
    expect(updated).toHaveLength(0);
  });
});

describe("pointInOutline", () => {
  const outline = buildOutline([rectRing(0, 0, 20, 20), rectRing(5, 5, 10, 10)]);

  it("excludes points inside a hole", () => {
    expect(pointInOutline(outline, { x: 2, y: 2 })).toBe(true);
    expect(pointInOutline(outline, { x: 10, y: 10 })).toBe(false);
    expect(pointInOutline(outline, { x: 50, y: 50 })).toBe(false);
  });
});

describe("flattenOutline", () => {
  it("returns the outer ring of the largest shape", () => {
    const outline = buildOutline([rectRing(0, 0, 5, 5), rectRing(50, 0, 30, 30)]);
    expect(ringArea(flattenOutline(outline))).toBe(900);
  });

  it("returns an empty list for an empty outline", () => {
    expect(flattenOutline([])).toEqual([]);
  });
});

describe("outlineFromPoints", () => {
  it("wraps points as a single shape with correct winding", () => {
    const outline = outlineFromPoints(rectRing(0, 0, 10, 10).reverse());
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
  });

  it("rejects fewer than three points", () => {
    expect(outlineFromPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });
});
