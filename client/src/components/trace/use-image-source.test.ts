// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DETECTION_CANVAS_MAX,
  detectionGeometry,
  fitWithin,
  IMAGE_CANVAS_MAX,
} from "./use-image-source";

describe("fitWithin", () => {
  it("leaves an image smaller than the cap alone", () => {
    expect(fitWithin({ width: 400, height: 300 }, IMAGE_CANVAS_MAX)).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("constrains a wide image by width and keeps the aspect ratio", () => {
    const result = fitWithin({ width: 4000, height: 2000 }, IMAGE_CANVAS_MAX);
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
  });

  it("constrains a tall image by height and keeps the aspect ratio", () => {
    const result = fitWithin({ width: 2000, height: 4000 }, IMAGE_CANVAS_MAX);
    expect(result.height).toBe(600);
    expect(result.width).toBe(300);
  });

  it("fits an image that exceeds both limits inside the box", () => {
    const result = fitWithin({ width: 4000, height: 4000 }, IMAGE_CANVAS_MAX);
    expect(result.width).toBeLessThanOrEqual(IMAGE_CANVAS_MAX.width);
    expect(result.height).toBeLessThanOrEqual(IMAGE_CANVAS_MAX.height);
    // Square in, square out.
    expect(result.width).toBe(result.height);
  });

  it("never returns a zero dimension", () => {
    // An extreme panorama would otherwise round its short side to 0 and make
    // every downstream division produce NaN.
    const result = fitWithin({ width: 100_000, height: 3 }, IMAGE_CANVAS_MAX);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("preserves the aspect ratio within rounding", () => {
    const natural = { width: 3024, height: 4032 };
    const result = fitWithin(natural, IMAGE_CANVAS_MAX);
    expect(result.width / result.height).toBeCloseTo(natural.width / natural.height, 2);
  });
});

describe("detectionGeometry", () => {
  it("reads a large photo at the detection cap, mapping back to working space", () => {
    const { detect, toWorking } = detectionGeometry({ width: 4000, height: 3000 });
    expect(detect.width).toBeLessThanOrEqual(DETECTION_CANVAS_MAX.width);
    expect(detect.width).toBeGreaterThan(IMAGE_CANVAS_MAX.width);
    // 4000×3000 → working 800×600, detect 1600×1200: factor 0.5. A marker
    // centre found at detect (1600, 1200) must land at working (800, 600).
    expect(toWorking).toBeCloseTo(0.5, 9);
  });

  it("uses the identity factor when the photo needs no downscale", () => {
    const { detect, toWorking } = detectionGeometry({ width: 420, height: 594 });
    expect(detect).toEqual({ width: 420, height: 594 });
    expect(toWorking).toBe(1);
  });

  it("keeps working and detection frames aspect-consistent", () => {
    const natural = { width: 3024, height: 4032 };
    const { detect, toWorking } = detectionGeometry(natural);
    const working = fitWithin(natural, IMAGE_CANVAS_MAX);
    // The same factor must map both axes within a rounding pixel.
    expect(detect.width * toWorking).toBeCloseTo(working.width, 6);
    expect(Math.abs(detect.height * toWorking - working.height)).toBeLessThan(1);
  });
});

describe("IMAGE_CANVAS_MAX", () => {
  it("is a fixed constant, not derived from the viewport", () => {
    // This is the coordinate space of every exported outline and of the ruler
    // calibration. If it ever tracked the display size, exports would silently
    // change dimensions with no visible symptom.
    expect(IMAGE_CANVAS_MAX).toEqual({ width: 800, height: 600 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
