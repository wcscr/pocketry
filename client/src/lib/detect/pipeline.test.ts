import { ringArea, signedArea } from "@shared/geometry/rings";
import { describe, expect, it } from "vitest";

import { convexHullForTest, polygonArea } from "../geometry/fixtures";
import { outlineArea, outlineBounds, pointInOutline } from "../geometry/outline";
import { detectOutline, refineOutline } from "./pipeline";
import { buildScoreFieldJS } from "./segment-js";
import type { ImageLike } from "./types";

/**
 * Synthetic "photographs" for the detection pipeline.
 *
 * The whole pipeline is exercised through its pure-JS backend (`engine: "js"`),
 * which needs no DOM and no wasm, so these run as ordinary Node tests.
 */

interface PaintOptions {
  /** Background colour. */
  background?: [number, number, number];
  /** Subject colour. */
  subject?: [number, number, number];
  /** Adds a left-to-right lightness ramp to the background. */
  illuminationGradient?: number;
  /** Adds a soft dark region that is a shadow, not an object. */
  shadow?: { x: number; y: number; width: number; height: number; strength: number };
  alpha?: boolean;
}

function paint(
  width: number,
  height: number,
  isSubject: (x: number, y: number) => boolean,
  options: PaintOptions = {},
): ImageLike {
  const {
    background = [225, 222, 218],
    subject = [45, 48, 52],
    illuminationGradient = 0,
    shadow,
    alpha = false,
  } = options;

  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = isSubject(x, y);
      const base = inside ? subject : background;

      let ramp = 0;
      if (!inside && illuminationGradient !== 0) {
        ramp = (x / width - 0.5) * illuminationGradient;
      }

      let shade = 1;
      if (
        !inside &&
        shadow &&
        x >= shadow.x &&
        x < shadow.x + shadow.width &&
        y >= shadow.y &&
        y < shadow.y + shadow.height
      ) {
        // A real cast shadow scales luminance while leaving hue alone.
        shade = 1 - shadow.strength;
      }

      data[i] = (base[0] + ramp) * shade;
      data[i + 1] = (base[1] + ramp) * shade;
      data[i + 2] = (base[2] + ramp) * shade;
      data[i + 3] = alpha ? (inside ? 255 : 0) : 255;
    }
  }

  return { width, height, data };
}

/** Solid rectangle. */
const rect =
  (x0: number, y0: number, x1: number, y1: number) =>
  (x: number, y: number): boolean =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

/** A "C": a block with a deep bay cut into its right side. */
const cShape = (x: number, y: number): boolean => {
  if (!rect(20, 20, 120, 120)(x, y)) return false;
  // The bay, open to the right.
  return !rect(60, 50, 121, 90)(x, y);
};

/** A block with a circular hole through it, like a tool's pivot. */
const blockWithHole = (x: number, y: number): boolean => {
  if (!rect(20, 20, 120, 120)(x, y)) return false;
  return Math.hypot(x - 70, y - 70) > 22;
};

const JS = { engine: "js" } as const;

describe("detectOutline: basic shapes", () => {
  it("finds a rectangle with the right bounds and area", async () => {
    const image = paint(160, 160, rect(30, 40, 110, 130));
    const result = await detectOutline(image, JS);

    expect(result.engine).toBe("js");
    expect(result.outline).toHaveLength(1);

    const bounds = outlineBounds(result.outline)!;
    expect(bounds.minX).toBeCloseTo(30, 0);
    expect(bounds.maxX).toBeCloseTo(110, 0);
    expect(bounds.minY).toBeCloseTo(40, 0);
    expect(bounds.maxY).toBeCloseTo(130, 0);

    // 80 x 90 = 7200.
    expect(Math.abs(outlineArea(result.outline))).toBeGreaterThan(7200 * 0.9);
    expect(Math.abs(outlineArea(result.outline))).toBeLessThan(7200 * 1.1);
  });

  it("keeps two disjoint objects as two shapes", async () => {
    const image = paint(200, 120, (x, y) => rect(20, 30, 70, 90)(x, y) || rect(130, 30, 180, 90)(x, y));
    const result = await detectOutline(image, JS);

    expect(result.outline).toHaveLength(2);
    expect(result.outline.every((shape) => shape.holes.length === 0)).toBe(true);
  });

  it("orients shells positive and holes negative", async () => {
    const result = await detectOutline(paint(160, 160, blockWithHole), JS);
    expect(signedArea(result.outline[0].outer)).toBeGreaterThan(0);
    expect(signedArea(result.outline[0].holes[0])).toBeLessThan(0);
  });
});

describe("detectOutline: concavity", () => {
  it("preserves a deep concave bay", async () => {
    const image = paint(160, 160, cShape);
    const result = await detectOutline(image, JS);

    expect(result.outline).toHaveLength(1);

    // The bay centre must be OUTSIDE the traced material. This is the exact
    // failure the old convex-hull path produced, and the reason this pipeline
    // was rewritten.
    expect(pointInOutline(result.outline, { x: 100, y: 70 })).toBe(false);
    // ...while the solid part is inside.
    expect(pointInOutline(result.outline, { x: 40, y: 70 })).toBe(true);
  });

  it("returns a genuinely non-convex outline", async () => {
    const result = await detectOutline(paint(160, 160, cShape), JS);
    const outer = result.outline[0].outer;

    // Point counts prove nothing; compare against the hull of the result.
    const area = polygonArea(outer);
    const hullArea = polygonArea(convexHullForTest(outer));
    expect(area).toBeLessThan(hullArea * 0.9);
  });
});

describe("detectOutline: holes", () => {
  it("finds an interior hole", async () => {
    const result = await detectOutline(paint(160, 160, blockWithHole), JS);

    expect(result.outline).toHaveLength(1);
    expect(result.outline[0].holes).toHaveLength(1);

    // Radius 22 circle => ~1520.
    const holeArea = ringArea(result.outline[0].holes[0]);
    expect(holeArea).toBeGreaterThan(Math.PI * 22 * 22 * 0.8);
    expect(holeArea).toBeLessThan(Math.PI * 22 * 22 * 1.25);
  });

  it("nets the hole out of the total area", async () => {
    const result = await detectOutline(paint(160, 160, blockWithHole), JS);
    const expected = 100 * 100 - Math.PI * 22 * 22;
    expect(Math.abs(outlineArea(result.outline))).toBeGreaterThan(expected * 0.9);
    expect(Math.abs(outlineArea(result.outline))).toBeLessThan(expected * 1.1);
  });

  it("reports a point inside the hole as outside the material", async () => {
    const result = await detectOutline(paint(160, 160, blockWithHole), JS);
    expect(pointInOutline(result.outline, { x: 70, y: 70 })).toBe(false);
    expect(pointInOutline(result.outline, { x: 30, y: 30 })).toBe(true);
  });
});

describe("detectOutline: photographic conditions", () => {
  it("survives an illumination gradient across the background", async () => {
    // Flat-fielding exists for exactly this: without it the bright side of the
    // frame reads as foreground.
    const image = paint(160, 160, rect(40, 40, 120, 120), { illuminationGradient: 60 });
    const result = await detectOutline(image, JS);

    expect(result.outline).toHaveLength(1);
    const bounds = outlineBounds(result.outline)!;
    expect(bounds.minX).toBeCloseTo(40, -1);
    expect(bounds.maxX).toBeCloseTo(120, -1);
  });

  it("does not trace a cast shadow as part of the object", async () => {
    // A shadow drops lightness but keeps hue, which is why the score field
    // down-weights L relative to a/b.
    const image = paint(200, 160, rect(40, 40, 110, 120), {
      shadow: { x: 110, y: 50, width: 45, height: 90, strength: 0.28 },
    });
    const result = await detectOutline(image, JS);

    const bounds = outlineBounds(result.outline)!;
    // The shadow extends to x=155; the object ends at x=110.
    expect(bounds.maxX).toBeLessThan(125);
  });

  it("uses the alpha channel when the source is already cut out", async () => {
    const image = paint(160, 160, cShape, { alpha: true });
    const result = await detectOutline(image, { engine: "js", useAlpha: "always" });

    expect(result.outline).toHaveLength(1);
    expect(pointInOutline(result.outline, { x: 100, y: 70 })).toBe(false);
    expect(pointInOutline(result.outline, { x: 40, y: 70 })).toBe(true);
  });

  it("handles an object running off the edge of the frame", async () => {
    // Two things have to hold here. The tracer must close a contour that meets
    // the image edge (it pads the field with a virtual cell of background, or
    // this yields an open contour and no ring at all), and the background
    // estimate must survive the subject occupying part of the border band —
    // which is why it is a median rather than a mean.
    const image = paint(160, 160, rect(0, 40, 60, 130));
    const result = await detectOutline(image, JS);

    expect(result.outline.length).toBeGreaterThanOrEqual(1);
    const bounds = outlineBounds(result.outline)!;
    expect(bounds.minX).toBeLessThanOrEqual(1);
    expect(bounds.maxX).toBeCloseTo(60, 0);
  });
});

describe("detectOutline: options", () => {
  it("restricts detection to a region of interest", async () => {
    const image = paint(240, 140, (x, y) => rect(20, 30, 70, 110)(x, y) || rect(160, 30, 220, 110)(x, y));
    const result = await detectOutline(image, {
      engine: "js",
      roi: { x: 140, y: 10, width: 100, height: 120 },
    });

    // Only the right-hand object, and reported in full-image coordinates.
    expect(result.outline).toHaveLength(1);
    const bounds = outlineBounds(result.outline)!;
    expect(bounds.minX).toBeGreaterThan(140);
    expect(bounds.maxX).toBeCloseTo(220, 0);
  });

  it("respects the pixel budget and still reports source coordinates", async () => {
    const image = paint(320, 320, rect(80, 80, 240, 240));
    const result = await detectOutline(image, { engine: "js", maxPixels: 10_000 });

    const bounds = outlineBounds(result.outline)!;
    // Coordinates come back in source space despite segmenting a ~100x100 copy.
    expect(bounds.minX).toBeCloseTo(80, -1);
    expect(bounds.maxX).toBeCloseTo(240, -1);
  });

  it("does not systematically bias the outline when downscaling", async () => {
    // A half-pixel error in the sample-space mapping shows up as a uniform
    // inward or outward shift that grows with the downscale factor.
    const image = paint(400, 400, rect(100, 100, 300, 300));
    const full = await detectOutline(image, { engine: "js" });
    const reduced = await detectOutline(image, { engine: "js", maxPixels: 10_000 });

    const a = outlineBounds(full.outline)!;
    const b = outlineBounds(reduced.outline)!;
    expect(Math.abs(a.minX - b.minX)).toBeLessThan(4);
    expect(Math.abs(a.maxX - b.maxX)).toBeLessThan(4);
  });

  it("reports the Otsu level and the biased level separately", async () => {
    const image = paint(160, 160, rect(40, 40, 120, 120));
    const neutral = await detectOutline(image, JS);
    const biased = await detectOutline(image, { engine: "js", sensitivity: 200 });

    expect(neutral.threshold).toBe(neutral.otsuThreshold);
    expect(biased.otsuThreshold).toBe(neutral.otsuThreshold);
    expect(biased.threshold).toBeGreaterThan(neutral.threshold);
  });

  it("emits debug rasters only when asked", async () => {
    const image = paint(80, 80, rect(20, 20, 60, 60));
    expect((await detectOutline(image, JS)).debug).toBeUndefined();

    const debug = (await detectOutline(image, { engine: "js", debug: true })).debug;
    expect(debug?.score.width).toBeGreaterThan(0);
    expect(debug?.mask.data.length).toBe(debug!.mask.width * debug!.mask.height * 4);
  });

  it("records per-stage timings", async () => {
    const result = await detectOutline(paint(80, 80, rect(20, 20, 60, 60)), JS);
    expect(Object.keys(result.timings)).toEqual(
      expect.arrayContaining(["segment", "trace", "refine"]),
    );
  });

  it("honours an abort signal", async () => {
    const image = paint(160, 160, rect(40, 40, 120, 120));
    await expect(
      detectOutline(image, { engine: "js", signal: AbortSignal.abort() }),
    ).rejects.toThrow(/abort/i);
  });

  it("returns an empty outline for a blank image", async () => {
    const image = paint(80, 80, () => false);
    const result = await detectOutline(image, JS);
    expect(result.outline).toEqual([]);
  });
});

describe("refineOutline", () => {
  it("re-derives from the cached dense outline without re-segmenting", async () => {
    const image = paint(160, 160, cShape);
    const result = await detectOutline(image, JS);

    const coarse = refineOutline(result.rawOutline, { tolerancePx: 6, smoothing: 0 });
    const fine = refineOutline(result.rawOutline, { tolerancePx: 0.2, smoothing: 0 });

    // Coarser tolerance means fewer points but the same shape.
    expect(coarse[0].outer.length).toBeLessThan(fine[0].outer.length);
    expect(pointInOutline(coarse, { x: 100, y: 70 })).toBe(false);
    expect(pointInOutline(fine, { x: 100, y: 70 })).toBe(false);
  });

  it("keeps the bay open through smoothing", async () => {
    const result = await detectOutline(paint(160, 160, cShape), JS);
    const smoothed = refineOutline(result.rawOutline, { tolerancePx: 1, smoothing: 4 });
    expect(pointInOutline(smoothed, { x: 100, y: 70 })).toBe(false);
    expect(pointInOutline(smoothed, { x: 40, y: 70 })).toBe(true);
  });

  it("drops speckles below the shell area fraction", async () => {
    const image = paint(220, 160, (x, y) => rect(20, 20, 120, 140)(x, y) || rect(200, 150, 203, 153)(x, y));
    const result = await detectOutline(image, { engine: "js", minShellAreaFrac: 0.01 });
    expect(result.outline).toHaveLength(1);
  });
});

describe("buildScoreFieldJS", () => {
  it("reports the mapping back to source coordinates", () => {
    const image = paint(200, 200, rect(50, 50, 150, 150));
    const field = buildScoreFieldJS(image, {
      roi: { x: 20, y: 30, width: 120, height: 100 },
      maxPixels: 3000,
    });

    expect(field.offsetX).toBe(20);
    expect(field.offsetY).toBe(30);
    expect(field.scale).toBeCloseTo(field.width / 120, 5);
    expect(field.width * field.height).toBeLessThanOrEqual(3000 * 1.2);
  });

  it("scores the subject above the background", () => {
    const image = paint(120, 120, rect(30, 30, 90, 90));
    const field = buildScoreFieldJS(image, {});

    const at = (x: number, y: number) =>
      field.score[Math.round(y * field.scale) * field.width + Math.round(x * field.scale)];

    expect(at(60, 60)).toBeGreaterThan(field.iso);
    expect(at(5, 5)).toBeLessThan(field.iso);
  });
});
