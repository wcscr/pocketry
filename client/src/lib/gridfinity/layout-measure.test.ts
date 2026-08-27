import { describe, expect, it } from "vitest";

import type { Outline } from "@shared/geometry/types";

import { measurementDistanceMm, snapToToolContour } from "./layout-measure";

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
});
