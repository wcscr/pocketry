import { createRequire } from "node:module";

import { mmPerPixel } from "@shared/geometry/scale";
import { beforeAll, describe, expect, it } from "vitest";

import { runAutoCalibration } from "./auto-calibrate";
import { detectArucoMarkers, detectCalibrationSheet, hasArucoSupport } from "./detect";
import { solveScaleFromMarkers } from "./solve";
import {
  TEMPLATE_MARKER_SIZE_MM,
  templateMarkerCentersMm,
} from "./template";

/**
 * Closed-loop test against the shipped opencv.js: OpenCV renders the
 * template's markers into a synthetic photo at a known scale, the detector
 * finds them, and the solver must recover that scale. No fixtures, no
 * hand-drawn expectations — cv is its own oracle.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */
let cv: any;

beforeAll(async () => {
  const required = createRequire(import.meta.url)(
    "../../../public/opencv/opencv.js",
  ) as unknown;
  cv = await Promise.resolve(required);
}, 60000);

const PX_PER_MM = 2;

/** White A4 "photo" with the template's markers rendered at PX_PER_MM. */
function composeSheet(dictionaryId: () => number): ImageData {
  const width = Math.round(210 * PX_PER_MM);
  const height = Math.round(297 * PX_PER_MM);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);

  const sizePx = TEMPLATE_MARKER_SIZE_MM * PX_PER_MM; // 60
  const dictionary = cv.getPredefinedDictionary(dictionaryId());
  try {
    for (const { id, x, y } of templateMarkerCentersMm("a4")) {
      const marker = new cv.Mat();
      try {
        cv.generateImageMarker(dictionary, id, sizePx, marker, 1);
        const originX = Math.round(x * PX_PER_MM - sizePx / 2);
        const originY = Math.round(y * PX_PER_MM - sizePx / 2);
        for (let row = 0; row < sizePx; row++) {
          for (let col = 0; col < sizePx; col++) {
            const value = marker.data[row * sizePx + col];
            const at = ((originY + row) * width + originX + col) * 4;
            data[at] = value;
            data[at + 1] = value;
            data[at + 2] = value;
            data[at + 3] = 255;
          }
        }
      } finally {
        marker.delete();
      }
    }
  } finally {
    dictionary.delete?.();
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("aruco detection (closed loop with the shipped bundle)", () => {
  it("exposes the aruco API", () => {
    expect(hasArucoSupport(cv)).toBe(true);
  });

  it("finds all four template markers where they were drawn", () => {
    const scene = composeSheet(() => cv.DICT_4X4_50);
    const markers = detectArucoMarkers(cv, scene, cv.DICT_4X4_50);

    expect(markers.map((m) => m.id).sort()).toEqual([0, 1, 2, 3]);
    const sizePx = TEMPLATE_MARKER_SIZE_MM * PX_PER_MM;
    for (const marker of markers) {
      const expected = templateMarkerCentersMm("a4").find((t) => t.id === marker.id)!;
      // The blit rounds the origin, and cv corner coordinates are
      // pixel-centre based: a marker spanning columns c..c+59 has its centre
      // at c + 29.5, half a pixel left of the continuous-space value.
      const originX = Math.round(expected.x * PX_PER_MM - sizePx / 2);
      const originY = Math.round(expected.y * PX_PER_MM - sizePx / 2);
      expect(marker.centerPx.x).toBeCloseTo(originX + sizePx / 2 - 0.5, 0);
      expect(marker.centerPx.y).toBeCloseTo(originY + sizePx / 2 - 0.5, 0);
    }
  });

  it("recovers the scale end to end within 0.5%", () => {
    const scene = composeSheet(() => cv.DICT_4X4_50);
    const detection = detectCalibrationSheet(cv, scene)!;
    expect(detection.isTemplate).toBe(true);

    const solution = solveScaleFromMarkers(detection.markers, "a4")!;
    expect(solution).not.toBeNull();
    const expectedMmPerPx = 1 / PX_PER_MM;
    expect(
      Math.abs(solution.mmPerPx - expectedMmPerPx) / expectedMmPerPx,
    ).toBeLessThan(0.005);
    expect(solution.maxDeviation).toBeLessThan(0.01);
  });

  it.each(["DICT_6X6_250", "DICT_ARUCO_ORIGINAL", "DICT_5X5_250"])(
    "recognises a foreign %s sheet for the hint path",
    (family) => {
      const scene = composeSheet(() => cv[family]);
      const detection = detectCalibrationSheet(cv, scene)!;
      expect(detection).not.toBeNull();
      expect(detection.isTemplate).toBe(false);
      expect(detection.family).toBe(family);
      expect(detection.markers.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("finds nothing on a blank image", () => {
    const width = 200;
    const height = 200;
    const blank = {
      data: new Uint8ClampedArray(width * height * 4).fill(255),
      width,
      height,
      colorSpace: "srgb",
    } as ImageData;
    expect(detectCalibrationSheet(cv, blank)).toBeNull();
  });
});

describe("runAutoCalibration", () => {
  it("produces a usable Calibration from the template sheet", () => {
    const result = runAutoCalibration(cv, composeSheet(() => cv.DICT_4X4_50));
    expect(result.kind).toBe("calibrated");
    if (result.kind !== "calibrated") return;

    // The synthesised ruler spans the longest pair — a 250 mm diagonal — and
    // the app's own scale derivation must land on the composed scale.
    expect(result.calibration.lengthMm).toBeCloseTo(250, 9);
    const derived = mmPerPixel(result.calibration)!;
    expect(Math.abs(derived - 1 / PX_PER_MM) / (1 / PX_PER_MM)).toBeLessThan(0.005);
    expect(result.solution.maxDeviation).toBeLessThan(0.01);
  });

  it("classifies a 6x6 sheet as foreign", () => {
    const result = runAutoCalibration(cv, composeSheet(() => cv.DICT_6X6_250));
    expect(result.kind).toBe("foreign-sheet");
    if (result.kind === "foreign-sheet") expect(result.family).toBe("DICT_6X6_250");
  });

  it("reports no markers on a blank image", () => {
    const blank = {
      data: new Uint8ClampedArray(160 * 160 * 4).fill(255),
      width: 160,
      height: 160,
      colorSpace: "srgb",
    } as ImageData;
    expect(runAutoCalibration(cv, blank).kind).toBe("no-markers");
  });
});
