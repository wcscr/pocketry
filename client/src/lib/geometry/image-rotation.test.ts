import { describe, expect, it } from "vitest";

import {
  combineImageRotations,
  fitImageWithin,
  nextImageRotation,
  rotateImageOutline,
  rotateImagePoint,
  rotateImageRect,
  rotatedImageDimensions,
} from "./image-rotation";

describe("image quarter-turn geometry", () => {
  it("tracks clockwise and counterclockwise orientations", () => {
    expect(nextImageRotation(0, "clockwise")).toBe(1);
    expect(nextImageRotation(0, "counterclockwise")).toBe(3);
    expect(nextImageRotation(3, "clockwise")).toBe(0);
    expect(nextImageRotation(1, "counterclockwise")).toBe(0);
    expect(combineImageRotations(3, 2)).toBe(1);
    expect(rotatedImageDimensions({ width: 800, height: 600 }, 1)).toEqual({
      width: 600,
      height: 800,
    });
  });

  it("rotates points and regions in both directions", () => {
    const source = { width: 200, height: 100 };
    const target = { width: 100, height: 200 };
    expect(rotateImagePoint({ x: 20, y: 30 }, source, target, "clockwise")).toEqual({
      x: 70,
      y: 20,
    });
    expect(
      rotateImagePoint({ x: 20, y: 30 }, source, target, "counterclockwise"),
    ).toEqual({ x: 30, y: 180 });
    expect(
      rotateImageRect(
        { x: 10, y: 20, width: 40, height: 30 },
        source,
        target,
        "clockwise",
      ),
    ).toEqual({ x: 50, y: 10, width: 30, height: 40 });
  });

  it("includes a changed fit-to-cap scale in the geometry transform", () => {
    const source = fitImageWithin(
      { width: 4000, height: 3000 },
      { width: 800, height: 600 },
    );
    const target = fitImageWithin(
      { width: 3000, height: 4000 },
      { width: 800, height: 600 },
    );
    expect(source).toEqual({ width: 800, height: 600 });
    expect(target).toEqual({ width: 450, height: 600 });
    expect(
      rotateImageOutline(
        [{ outer: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }], holes: [] }],
        source,
        target,
        "clockwise",
      )[0].outer,
    ).toEqual([
      { x: 450, y: 0 },
      { x: 450, y: 600 },
      { x: 0, y: 600 },
    ]);
  });
});
