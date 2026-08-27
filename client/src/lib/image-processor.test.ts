import { ringArea } from "@shared/geometry/rings";
import { describe, expect, it } from "vitest";

import type { ImageLike } from "./detect/types";
import { convexHullForTest, polygonArea } from "./geometry/fixtures";
import { outlineArea, outlineBounds, pointInOutline } from "./geometry/outline";
import {
  MARGIN_MM_OPTIONS,
  marginToPixels,
  processImage,
} from "./image-processor";

/**
 * End-to-end coverage of the app-facing entry point.
 *
 * `processImage` is exactly what the UI calls, so these are the tests that
 * actually pin the reported bug: before this rewrite the outline was pushed
 * through a convex hull (or, on the OpenCV path, reduced to a single
 * `RETR_EXTERNAL` contour), so a concave bay and an interior hole were both
 * impossible to represent.
 */

/** Paints a dark subject on a light background. */
function photo(
  width: number,
  height: number,
  isSubject: (x: number, y: number) => boolean,
): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = isSubject(x, y);
      data[i] = inside ? 45 : 226;
      data[i + 1] = inside ? 48 : 223;
      data[i + 2] = inside ? 52 : 219;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const box =
  (x0: number, y0: number, x1: number, y1: number) =>
  (x: number, y: number): boolean =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

/**
 * A stand-in for a pair of pliers: a body with a deep V between the jaws and a
 * pivot hole through the middle.
 */
function pliers(x: number, y: number): boolean {
  if (!box(30, 30, 170, 150)(x, y)) return false;
  // The jaw gap, open to the right.
  if (box(110, 75, 171, 105)(x, y)) return false;
  // The pivot hole.
  if (Math.hypot(x - 75, y - 90) < 18) return false;
  return true;
}

/** Deep inside the jaw gap: outside the material. */
const JAW_GAP = { x: 150, y: 90 };
/** The pivot hole's centre: also outside the material. */
const PIVOT = { x: 75, y: 90 };
/** Solid metal. */
const BODY = { x: 50, y: 45 };

const JS = { engine: "js" } as const;

describe("processImage", () => {
  it("keeps the jaw gap open", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });

    expect(result.outline.length).toBeGreaterThanOrEqual(1);
    expect(pointInOutline(result.outline, JAW_GAP)).toBe(false);
    expect(pointInOutline(result.outline, BODY)).toBe(true);
  });

  it("finds the pivot hole", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });

    expect(result.outline[0].holes).toHaveLength(1);
    expect(pointInOutline(result.outline, PIVOT)).toBe(false);

    const holeArea = ringArea(result.outline[0].holes[0]);
    expect(holeArea).toBeGreaterThan(Math.PI * 18 * 18 * 0.75);
    expect(holeArea).toBeLessThan(Math.PI * 18 * 18 * 1.3);
  });

  it("returns an outline that is not a convex hull", async () => {
    // The regression that matters: point counts prove nothing, so compare the
    // traced area against the hull of the same points.
    const result = await processImage(photo(200, 180, pliers), { detect: JS });
    const outer = result.outline[0].outer;

    expect(polygonArea(outer)).toBeLessThan(polygonArea(convexHullForTest(outer)) * 0.92);
  });

  it("nets the hole and the gap out of the area", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });
    // 140x120 body, minus a 60x30 gap, minus a radius-18 hole.
    const expected = 140 * 120 - 60 * 30 - Math.PI * 18 * 18;
    expect(Math.abs(outlineArea(result.outline))).toBeGreaterThan(expected * 0.9);
    expect(Math.abs(outlineArea(result.outline))).toBeLessThan(expected * 1.1);
  });

  it("still exposes a flat point list for unmigrated callers", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });
    expect(result.points.length).toBeGreaterThan(3);
    expect(result.points).toEqual(result.outline[0].outer);
  });

  it("produces an SVG with an even-odd fill rule so holes render as holes", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });
    expect(result.svg).toContain('fill-rule="evenodd"');
    expect(result.svg).toContain('viewBox="0 0 200 180"');
    // One subpath per ring: the shell plus its hole.
    expect(result.svg.match(/M /g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("caches the dense outline for the detail controls", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });
    const dense = result.rawOutline[0].outer.length;
    const simplified = result.outline[0].outer.length;
    expect(dense).toBeGreaterThan(simplified);
  });

  it("reports which backend ran", async () => {
    const result = await processImage(photo(120, 120, box(30, 30, 90, 90)), {
      detect: JS,
    });
    expect(result.engine).toBe("js");
  });
});

describe("processImage: margins", () => {
  it("grows the shell and shrinks the hole together", async () => {
    // The case the old per-vertex offset got backwards: a positive margin must
    // push holes INWARD, or a pocket ends up too small for its tool.
    const plain = await processImage(photo(200, 180, pliers), { detect: JS });
    const margined = await processImage(photo(200, 180, pliers), {
      detect: JS,
      margin: 1.5,
      calibration: {
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 0,
        lengthMm: 50,
      },
    });

    const plainBounds = outlineBounds(plain.outline)!;
    const margedBounds = outlineBounds(margined.outline)!;
    expect(margedBounds.maxX - margedBounds.minX).toBeGreaterThan(
      plainBounds.maxX - plainBounds.minX,
    );

    expect(ringArea(margined.outline[0].holes[0])).toBeLessThan(
      ringArea(plain.outline[0].holes[0]),
    );
  });

  it("leaves geometry untouched until a margin is selected", async () => {
    const none = await processImage(photo(200, 180, pliers), {
      detect: JS,
      margin: null,
    });
    expect(Math.abs(outlineArea(none.outline))).toBeGreaterThan(0);
  });
});

describe("marginToPixels", () => {
  it("offers 0.5-5.0 mm in 0.5 mm steps", () => {
    expect(MARGIN_MM_OPTIONS).toEqual([
      0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
    ]);
  });

  it("ignores a millimetre margin without a scale", () => {
    // A physical clearance is meaningless with no scale; silently treating it
    // as pixels would export a wrong-sized part.
    expect(marginToPixels(3, null)).toBe(0);
  });

  it("uses no margin until the user selects one", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 200,
      endY: 0,
      lengthMm: 100,
    };
    expect(marginToPixels(null, calibration)).toBe(0);
  });

  it("converts a millimetre margin when calibrated", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 200,
      endY: 0,
      lengthMm: 100,
    };
    expect(marginToPixels(3, calibration)).toBeCloseTo(6, 6);
  });

  it("converts both allowed endpoints", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 200,
      endY: 0,
      lengthMm: 100,
    };
    expect(marginToPixels(0.5, calibration)).toBeCloseTo(1, 6);
    expect(marginToPixels(5, calibration)).toBeCloseTo(10, 6);
  });
});
