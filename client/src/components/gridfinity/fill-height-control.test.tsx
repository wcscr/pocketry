import { describe, expect, it } from "vitest";

import { snapFillHeightPercent } from "./fill-height-control";

describe("fill-height pointer snapping", () => {
  it.each([25, 50, 75, 100])("snaps within three points of %s percent", (point) => {
    for (const value of [point - 3, point - 1, point, Math.min(100, point + 3)]) {
      expect(snapFillHeightPercent(value)).toBe(point);
    }
  });

  it.each([1, 21, 29, 37, 54, 79, 96])("preserves custom %s percent away from the snap points", (value) => {
    expect(snapFillHeightPercent(value)).toBe(value);
  });
});
