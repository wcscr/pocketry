import { ringArea } from "@shared/geometry/rings";
import { describe, expect, it } from "vitest";

import type { ImageLike } from "./detect/types";
import { convexHullForTest, polygonArea } from "./geometry/fixtures";
import { outlineArea, outlineBounds, pointInOutline } from "./geometry/outline";
import {
  adjustOutlineMargin,
  MARGIN_MM_OPTIONS,
  marginToPixels,
  processImage,
  reprocessOutline,
  outsideSilhouettes,
  withoutNewInteriorHoles,
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
  it.each([false, true])("automatically reconstructs a rounded outline while preserving dense evidence (curves=%s)", async editableCurves => {
    const image = photo(160, 160, (x, y) => Math.hypot(x - 80, y - 80) < 50);
    const detected = await processImage(image, { detect: JS });
    const result = await processImage(image, { detect: JS, autoCleanup: true, editableCurves });
    expect(result.cleanup?.applied).toBe(true);
    expect(result.rawOutline).toEqual(detected.rawOutline);
    expect(result.refinementBase).toEqual(result.outline);
    expect(!!result.curves).toBe(editableCurves);
    expect(result.outline[0].outer.length).toBeLessThan(result.rawOutline[0].outer.length);
    expect(pointInOutline(result.outline, { x: 80, y: 80 })).toBe(true);
    expect(result.timings.cleanup).toBeGreaterThanOrEqual(0);
    if (editableCurves) expect(result.curves![0].outer.some(a => a.in || a.out)).toBe(true);
  });

  it("cleans before adding calibrated clearance and keeps its unoffset baseline", async () => {
    const image = photo(160, 160, (x, y) => Math.hypot(x - 80, y - 80) < 50);
    const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 25 };
    const original = await processImage(image, { detect: JS, autoCleanup: true, calibration, margin: 0 });
    const offset = await processImage(image, { detect: JS, autoCleanup: true, editableCurves: true, calibration, margin: .5 });
    expect(offset.curves).toBeUndefined(); // Native editing still requires zero Trace margin.
    expect(offset.refinementBase).toEqual(original.outline);
    expect(offset.rawOutline).toEqual(original.rawOutline);
    expect(outlineArea(offset.outline)).toBeGreaterThan(outlineArea(original.outline));
  });

  it("smooths the boundary outward by a millimetre at the calibrated scale, before cleanup", async () => {
    // A diamond at 0.25 mm per pixel.
    const image = photo(200, 200, (x, y) => Math.abs(x - 100) + Math.abs(y - 100) < 70);
    const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 25 };
    const plain = await processImage(image, { detect: JS, autoCleanup: true, calibration });
    const smooth = await processImage(image, { detect: JS, autoCleanup: true, calibration, smoothBoundary: true });
    expect(plain.timings.outerSmoothing).toBeUndefined();
    expect(smooth.timings.outerSmoothing).toBeGreaterThanOrEqual(0);
    expect(smooth.cleanup?.applied).toBe(true);
    // The dense trace is resampled every quarter of the length: 1 mm is 4 px here, so 1 px.
    const [first, second] = smooth.rawOutline[0].outer;
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeCloseTo(1, 1);
    // It only grew, and the cleaned outline still covers the shape.
    expect(outlineArea(smooth.rawOutline)).toBeGreaterThan(outlineArea(plain.rawOutline));
    expect(outlineArea(smooth.rawOutline)).toBeLessThan(outlineArea(plain.rawOutline) * 1.03);
    for (const [x, y] of [[100, 35], [165, 100], [100, 165], [35, 100], [100, 100]]) expect(pointInOutline(smooth.outline, { x, y })).toBe(true);
  });

  it("scales the smoothing length with a cropped region, and falls back to segmentation pixels without a scale", async () => {
    const image = photo(200, 200, (x, y) => Math.abs(x - 100) + Math.abs(y - 100) < 70);
    const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 25 };
    // The detector's pixels are half a working pixel, so a millimetre is 8 of them and samples are 2 apart.
    const cropped = await processImage(image, { detect: JS, calibration, smoothBoundary: true, region: {
      isCropped: true, originalRegion: { x: 0, y: 0, width: 100, height: 100 }, toWorking: { x: 0.5, y: 0.5 },
    } });
    const [a, b] = cropped.rawOutline[0].outer;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(1, 1); // 2 detector pixels, mapped to working pixels
    const unscaled = await processImage(image, { detect: JS, smoothBoundary: true });
    expect(unscaled.timings.outerSmoothing).toBeGreaterThanOrEqual(0);
    const [c, d] = unscaled.rawOutline[0].outer;
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeCloseTo(1, 1); // four segmentation pixels, sampled every one
  });

  it("maps the sheet's printed areas from the working photo into the detection crop", async () => {
    // A block with a thin ruled line through it. The crop starts at (40, 20) in the working photo
    // and has two detection pixels per working pixel.
    const image = photo(240, 160, (x, y) => box(90, 30, 150, 130)(x, y) || (x >= 20 && x < 220 && y >= 100 && y < 102));
    const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
    const region = { isCropped: true as const, originalRegion: { x: 40, y: 20, width: 120, height: 80 }, toWorking: { x: 0.5, y: 0.5 } };
    const width = (result: Awaited<ReturnType<typeof processImage>>) => outlineBounds(result.outline)!.maxX - outlineBounds(result.outline)!.minX;
    const plain = await processImage(image, { detect: JS, calibration, region });
    expect(width(plain)).toBeGreaterThan(75);
    // The printed area in working pixels: detection (10..230, 88..112) halved and offset by the crop origin.
    const sheetInk = [{ x: 45, y: 64, width: 110, height: 12, kind: "rule" as const }];
    const clean = await processImage(image, { detect: JS, calibration, region, sheetInk });
    expect(clean.timings.sheetInk).toBeGreaterThanOrEqual(0);
    expect(width(clean)).toBeLessThan(34);
    // Without a scale a stroke cannot be sized, so the step is skipped.
    const unscaled = await processImage(image, { detect: JS, region, sheetInk });
    expect(unscaled.timings.sheetInk).toBeUndefined();
  });

  it("keeps detection intact if automatic reconstruction exceeds its complexity budget", async () => {
    const image = photo(400, 400, (x, y) => {
      const cx = 20 + Math.round((x - 20) / 28) * 28, cy = 20 + Math.round((y - 20) / 28) * 28;
      return cx >= 20 && cy >= 20 && cx <= 380 && cy <= 380 && Math.hypot(x - cx, y - cy) < 5;
    });
    const detected = await processImage(image, { detect: JS });
    expect(detected.outline.length).toBeGreaterThan(128);
    const cleaned = await processImage(image, { detect: JS, autoCleanup: true });
    expect(cleaned.cleanup?.applied).toBe(false);
    expect(cleaned.outline).toEqual(detected.outline);
    expect(cleaned.rawOutline).toEqual(detected.rawOutline);
  });

  it("maps a crop-first detection back per axis before applying physical margins", async () => {
    const image = photo(100, 120, (x, y) => x > 20 && x < 80 && y > 20 && y < 100);
    const detect = { ...JS, tolerancePx: 0, smoothing: 0 };
    const original = await processImage(image, { detect });
    const mapped = await processImage(image, { detect, region: {
      isCropped: true, originalRegion: { x: 15, y: 25, width: 20, height: 36 },
      toWorking: { x: 0.2, y: 0.3 },
    } });
    expect(mapped.rawOutline).toEqual(original.rawOutline.map(s => ({
      outer: s.outer.map(p => ({ x: p.x * 0.2 + 15, y: p.y * 0.3 + 25 })), holes: [],
    })));
    expect(mapped.outline).toEqual(mapped.rawOutline);
  });
  it("keeps manually overlapping shapes when suppressing newly created holes", () => {
    const first = {
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      holes: [],
    };
    const overlapping = {
      outer: [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }],
      holes: [],
    };
    expect(withoutNewInteriorHoles([first, overlapping], [first, overlapping]))
      .toEqual([first, overlapping]);
  });

  it("absorbs nested islands while keeping separate tools in outside-only mode", () => {
    const square = (x: number, y: number, side: number) => ({ outer: [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }], holes: [] });
    const shell = square(0, 0, 100);
    const separate = square(120, 0, 20);
    expect(outsideSilhouettes([shell, square(20, 20, 5), separate])).toEqual([shell, separate]);
  });
  it("defaults to outside silhouettes without closing concave bays", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS });
    expect(result.outline[0].holes).toEqual([]);
    expect(result.rawOutline[0].holes).toEqual([]);
    expect(pointInOutline(result.outline, PIVOT)).toBe(true);
    expect(pointInOutline(result.outline, JAW_GAP)).toBe(false);
  });
  it("keeps the jaw gap open", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });

    expect(result.outline.length).toBeGreaterThanOrEqual(1);
    expect(pointInOutline(result.outline, JAW_GAP)).toBe(false);
    expect(pointInOutline(result.outline, BODY)).toBe(true);
  });

  it("finds the pivot hole", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });

    expect(result.outline[0].holes).toHaveLength(1);
    expect(pointInOutline(result.outline, PIVOT)).toBe(false);

    const holeArea = ringArea(result.outline[0].holes[0]);
    expect(holeArea).toBeGreaterThan(Math.PI * 18 * 18 * 0.75);
    expect(holeArea).toBeLessThan(Math.PI * 18 * 18 * 1.3);
  });

  it("returns an outline that is not a convex hull", async () => {
    // The regression that matters: point counts prove nothing, so compare the
    // traced area against the hull of the same points.
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
    const outer = result.outline[0].outer;

    expect(polygonArea(outer)).toBeLessThan(polygonArea(convexHullForTest(outer)) * 0.92);
  });

  it("nets the hole and the gap out of the area", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
    // 140x120 body, minus a 60x30 gap, minus a radius-18 hole.
    const expected = 140 * 120 - 60 * 30 - Math.PI * 18 * 18;
    expect(Math.abs(outlineArea(result.outline))).toBeGreaterThan(expected * 0.9);
    expect(Math.abs(outlineArea(result.outline))).toBeLessThan(expected * 1.1);
  });

  it("still exposes a flat point list for unmigrated callers", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
    expect(result.points.length).toBeGreaterThan(3);
    expect(result.points).toEqual(result.outline[0].outer);
  });

  it("produces an SVG with an even-odd fill rule so holes render as holes", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
    expect(result.svg).toContain('fill-rule="evenodd"');
    expect(result.svg).toContain('viewBox="0 0 200 180"');
    // One subpath per ring: the shell plus its hole.
    expect(result.svg.match(/M /g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("caches the dense outline for the detail controls", async () => {
    const result = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
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
  it("fills holes created when margin closes a narrow reflective gap", async () => {
    const narrowBay = photo(200, 200, (x, y) =>
      box(20, 20, 180, 180)(x, y) &&
      !box(60, 60, 140, 140)(x, y) &&
      !box(140, 96, 181, 104)(x, y),
    );
    const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 100 };
    const options = { detect: JS, margin: 5 as const, calibration };
    const withHoles = await processImage(narrowBay, { ...options, includeInteriorHoles: true });
    expect(withHoles.outline.some((shape) => shape.holes.length > 0)).toBe(true);

    const silhouette = await processImage(narrowBay, options);
    expect(silhouette.outline.every((shape) => shape.holes.length === 0)).toBe(true);
    expect(pointInOutline(silhouette.outline, { x: 100, y: 100 })).toBe(true);

    const unoffset = await processImage(narrowBay, { detect: JS });
    const adjusted = await adjustOutlineMargin(unoffset.outline, 0, 5, calibration);
    expect(adjusted.every((shape) => shape.holes.length === 0)).toBe(true);
  });

  it("can refine detail after an initial margin collapses only the smallest detected hole", async () => {
    const image = photo(220, 150, (x, y) => box(20, 20, 200, 130)(x, y)
      && !box(46, 66, 54, 74)(x, y) && !box(100, 50, 140, 90)(x, y));
    const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 100 };
    const detect = { ...JS, smoothing: 0, tolerancePx: 0, minHoleAreaFrac: 0 };
    const unoffset = await processImage(image, { detect, includeInteriorHoles: true });
    expect(unoffset.rawOutline[0].holes).toHaveLength(2);
    const detected = await processImage(image, { detect, includeInteriorHoles: true, margin: 5, calibration });
    expect(detected.outline[0].holes).toHaveLength(1);
    expect(detected.rawOutline[0].holes).toHaveLength(1);
    const refined = await reprocessOutline(detected.rawOutline, { detect: { smoothing: 2, tolerancePx: 1 }, margin: 5, calibration });
    expect(refined).toHaveLength(1);
    expect(refined[0].holes).toHaveLength(1);
    expect(pointInOutline(refined, { x: 50, y: 70 })).toBe(true);
    expect(pointInOutline(refined, { x: 120, y: 70 })).toBe(false);
  });

  it("keeps separately detected tools when the chosen margin makes them overlap", async () => {
    const result = await processImage(photo(160, 130, (x, y) =>
      box(20, 20, 70, 100)(x, y) || box(76, 40, 116, 80)(x, y)), {
      detect: { ...JS, smoothing: 0, tolerancePx: 0 }, margin: 5,
      calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
    });
    expect(result.rawOutline).toHaveLength(2);
    expect(result.outline).toHaveLength(2);
    expect(result.outline.every(part => part.holes.length === 0)).toBe(true);
  });

  it("grows the shell and shrinks the hole together", async () => {
    // The case the old per-vertex offset got backwards: a positive margin must
    // push holes INWARD, or a pocket ends up too small for its tool.
    const plain = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
    const margined = await processImage(photo(200, 180, pliers), {
      includeInteriorHoles: true,
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

  it("adjusts the edited contour without resurrecting a deleted hole", async () => {
    const edited = [
      {
        outer: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 80 },
          { x: 45, y: 70 }, // a manually moved vertex
          { x: 10, y: 80 },
        ],
        holes: [], // an unwanted detected hole was manually removed
      },
    ];
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };

    const adjusted = await adjustOutlineMargin(edited, 1.5, 2, calibration);
    const before = outlineBounds(edited)!;
    const after = outlineBounds(adjusted)!;

    expect(adjusted).not.toBe(edited);
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0].holes).toEqual([]);
    expect(after.maxX - after.minX).toBeGreaterThan(before.maxX - before.minX);
  });

  it("can remove the full applied margin by selecting zero", async () => {
    const plain = await processImage(photo(200, 180, pliers), { detect: JS, includeInteriorHoles: true });
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
    const restored = await adjustOutlineMargin(
      margined.outline,
      1.5,
      0,
      {
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 0,
        lengthMm: 50,
      },
    );

    const plainBounds = outlineBounds(plain.outline)!;
    const restoredBounds = outlineBounds(restored)!;
    expect(restoredBounds.minX).toBeCloseTo(plainBounds.minX, 1);
    expect(restoredBounds.maxX).toBeCloseTo(plainBounds.maxX, 1);
    expect(restoredBounds.minY).toBeCloseTo(plainBounds.minY, 1);
    expect(restoredBounds.maxY).toBeCloseTo(plainBounds.maxY, 1);
  });
});

describe("marginToPixels", () => {
  it("offers 0.0-5.0 mm in 0.5 mm steps", () => {
    expect(MARGIN_MM_OPTIONS).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
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
    expect(marginToPixels(0, calibration)).toBe(0);
    expect(marginToPixels(5, calibration)).toBeCloseTo(10, 6);
  });
});
