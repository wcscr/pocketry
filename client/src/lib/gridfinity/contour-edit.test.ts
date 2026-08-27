import { describe, expect, it } from "vitest";

import { OUTER_RING } from "@shared/geometry/types";
import type { TracedShape } from "@shared/gridfinity/cutout";

import {
  insertContourPoint,
  moveContourPoint,
  removeContourPoint,
  reviseTracedShape,
} from "./contour-edit";

const SHAPE: TracedShape = {
  id: "shape-a",
  name: "Wrench",
  outlineMm: [
    {
      outer: [
        { x: -2, y: -1 },
        { x: 2, y: -1 },
        { x: 2, y: 1 },
        { x: -2, y: 1 },
      ],
      holes: [],
    },
  ],
  bboxMm: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
  pointCount: 4,
  sourceMmPerPx: 0.2,
};

const OUTER = { shapeIndex: 0, ringIndex: OUTER_RING };

describe("bin contour editing", () => {
  it("moves, inserts, and removes vertices without mutating the source", () => {
    const moved = moveContourPoint(SHAPE.outlineMm, OUTER, 1, { x: 3, y: -1 });
    const inserted = insertContourPoint(moved, OUTER, 1, { x: 3, y: 0 });
    const removed = removeContourPoint(inserted, OUTER, 2);

    expect(SHAPE.outlineMm[0].outer[1]).toEqual({ x: 2, y: -1 });
    expect(moved[0].outer[1]).toEqual({ x: 3, y: -1 });
    expect(inserted[0].outer).toHaveLength(5);
    expect(removed[0].outer).toHaveLength(4);
  });

  it("keeps a minimum three-point ring", () => {
    const triangle = { ...SHAPE, outlineMm: [{ outer: SHAPE.outlineMm[0].outer.slice(0, 3), holes: [] }] };
    expect(removeContourPoint(triangle.outlineMm, OUTER, 0)).toBe(triangle.outlineMm);
  });

  it("creates a new worker identity and recomputes shape metadata", () => {
    const outline = moveContourPoint(SHAPE.outlineMm, OUTER, 1, { x: 5, y: -1 });
    const revision = reviseTracedShape(SHAPE, outline, "shape-b");

    expect(revision.id).toBe("shape-b");
    expect(revision.name).toBe("Wrench");
    expect(revision.bboxMm.maxX).toBe(5);
    expect(revision.pointCount).toBe(4);
  });
});
