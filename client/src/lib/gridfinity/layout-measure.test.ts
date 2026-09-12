import { describe, expect, it } from "vitest";

import type { Outline } from "@shared/geometry/types";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";

import { measurementDistanceMm, placedPocketSplitBoundaries, snapToToolContour } from "./layout-measure";

const OUTLINE: Outline = [
  {
    outer: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ],
    holes: [
      [
        { x: 8, y: 4 },
        { x: 8, y: 6 },
        { x: 12, y: 6 },
        { x: 12, y: 4 },
      ],
    ],
  },
];

describe("2D layout measurement", () => {
  it("snaps to the nearest point along an outer contour segment", () => {
    expect(snapToToolContour({ x: 7, y: -0.4 }, [OUTLINE], 1)).toEqual({
      point: { x: 7, y: 0 },
      distanceMm: 0.4,
    });
  });

  it("includes hole contours and rejects clicks beyond the screen tolerance", () => {
    expect(snapToToolContour({ x: 10, y: 4.25 }, [OUTLINE], 1)?.point).toEqual({
      x: 10,
      y: 4,
    });
    expect(snapToToolContour({ x: 10, y: 8 }, [OUTLINE], 1)).toBeNull();
  });

  it("reports planar millimetre distance between snapped endpoints", () => {
    expect(measurementDistanceMm({ x: 1, y: 2 }, { x: 4, y: 6 })).toBe(5);
  });

  it("snaps along split segments and chooses the nearest target within tolerance", () => {
    const splits = [[{ x: 4, y: 0 }, { x: 4, y: 10 }]];
    expect(snapToToolContour({ x: 4.2, y: 3 }, [OUTLINE], 1, splits)?.point).toEqual({ x: 4, y: 3 });
    expect(snapToToolContour({ x: 0.2, y: 3 }, [OUTLINE], 1, splits)?.point).toEqual({ x: 0, y: 3 });
    expect(snapToToolContour({ x: 6, y: 2 }, [OUTLINE], 1, splits)).toBeNull();
    // A finite boundary snaps to its endpoint, never to an infinite extension.
    expect(snapToToolContour({ x: 4, y: 10.4 }, [], 1, splits)?.point).toEqual({ x: 4, y: 10 });
    expect(snapToToolContour({ x: 4, y: 12 }, [], 1, splits)).toBeNull();
  });

  it("supports every segment of an open path without inventing a closing edge", () => {
    const paths = [[{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]];
    expect(snapToToolContour({ x: 0.2, y: 4 }, [], 1, paths)?.point).toEqual({ x: 0, y: 4 });
    expect(snapToToolContour({ x: 4, y: 9.8 }, [], 1, paths)?.point).toEqual({ x: 4, y: 10 });
    expect(snapToToolContour({ x: 5, y: 5 }, [], 1, paths)).toBeNull();
  });

  it("places split targets correctly after translation, rotation, mirroring and unequal scaling", () => {
    const cutout = parseCutoutPlacement({ id: "split", shapeId: "tool", position: { x: 3, y: -2 },
      rotationDeg: 90, mirrored: true, scaleX: 1.5, scaleY: 0.8,
      split: { boundary: [{ x: 2, y: -10 }, { x: 2, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    const paths = placedPocketSplitBoundaries([cutout, { ...cutout, split: undefined }]);
    expect(paths).toHaveLength(1);
    expect(paths[0][0].x).toBeCloseTo(11);
    expect(paths[0][0].y).toBeCloseTo(-5);
    expect(paths[0][1].x).toBeCloseTo(-5);
    expect(paths[0][1].y).toBeCloseTo(-5);
    const snapped = snapToToolContour({ x: 1, y: -4.8 }, [], 1, paths)!.point;
    expect(snapped.x).toBeCloseTo(1);
    expect(snapped.y).toBeCloseTo(-5);
    expect(measurementDistanceMm(snapped, { x: 1, y: -17 })).toBeCloseTo(12);
  });
});
