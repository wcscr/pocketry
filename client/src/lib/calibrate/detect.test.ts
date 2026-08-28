import { createRequire } from "node:module";

import { mmPerPixel } from "@shared/geometry/scale";
import { beforeAll, describe, expect, it } from "vitest";

import { runAutoCalibration } from "./auto-calibrate";
import {
  createPocketryTemplateDictionary,
  detectArucoMarkers,
  detectCalibrationSheet,
  detectPocketryTemplateMarkers,
  hasArucoSupport,
  TEMPLATE_DICTIONARY,
} from "./detect";
import { solveScaleFromMarkers } from "./solve";
import {
  TEMPLATE_MARKER_SIZE_MM,
  TEMPLATE_PAPER_MM,
  templateMarkerCentersMm,
  type TemplatePaper,
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

/** White template "photo" with its markers rendered at PX_PER_MM. */
function composeSheet(
  createDictionary: () => any,
  paper: TemplatePaper = "a4",
  options: {
    markerSizeMm?: number;
    centers?: ReturnType<typeof templateMarkerCentersMm>;
  } = {},
): ImageData {
  const width = Math.round(TEMPLATE_PAPER_MM[paper].width * PX_PER_MM);
  const height = Math.round(TEMPLATE_PAPER_MM[paper].height * PX_PER_MM);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);

  const sizePx = (options.markerSizeMm ?? TEMPLATE_MARKER_SIZE_MM) * PX_PER_MM;
  const dictionary = createDictionary();
  try {
    for (const { id, x, y } of options.centers ?? templateMarkerCentersMm(paper)) {
      const marker = new cv.Mat();
      try {
        dictionary.generateImageMarker(id, sizePx, marker, 1);
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

/** Places the synthetic sheet into a skewed photo using one planar homography. */
function photographSheet(scene: ImageData): ImageData {
  const width = 720;
  const height = 760;
  const source = cv.matFromImageData(scene);
  const photographed = new cv.Mat();
  const sourceCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    scene.width - 1,
    0,
    scene.width - 1,
    scene.height - 1,
    0,
    scene.height - 1,
  ]);
  const photoCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
    105,
    80,
    605,
    45,
    655,
    690,
    55,
    730,
  ]);
  const transform = cv.getPerspectiveTransform(sourceCorners, photoCorners);
  try {
    cv.warpPerspective(
      source,
      photographed,
      transform,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(96, 96, 96, 255),
    );
    return {
      data: new Uint8ClampedArray(photographed.data),
      width,
      height,
      colorSpace: "srgb",
    } as ImageData;
  } finally {
    transform.delete();
    photoCorners.delete();
    sourceCorners.delete();
    photographed.delete();
    source.delete();
  }
}

const pocketryDictionary = () => createPocketryTemplateDictionary(cv);
const predefinedDictionary = (id: number) => () => cv.getPredefinedDictionary(id);

describe("aruco detection (closed loop with the shipped bundle)", () => {
  it("exposes the aruco API", () => {
    expect(hasArucoSupport(cv)).toBe(true);
  });

  it("finds all four template markers where they were drawn", () => {
    const scene = composeSheet(pocketryDictionary);
    const markers = detectPocketryTemplateMarkers(cv, scene);

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
      expect(marker.cornersPx).toHaveLength(4);
    }
  });

  it("keeps the Pocketry namespace distinct from the stock 4x4 dictionary", () => {
    const scene = composeSheet(pocketryDictionary);
    expect(detectArucoMarkers(cv, scene, cv.DICT_4X4_50)).toEqual([]);
  });

  it("keeps decoded corner identity when the sheet is rotated", () => {
    const scene = composeSheet(pocketryDictionary);
    const original = detectPocketryTemplateMarkers(cv, scene);
    const source = cv.matFromImageData(scene);
    const rotated = new cv.Mat();
    try {
      cv.rotate(source, rotated, cv.ROTATE_180);
      const rotatedImage = {
        data: new Uint8ClampedArray(rotated.data),
        width: rotated.cols,
        height: rotated.rows,
        colorSpace: "srgb",
      } as ImageData;
      const detected = detectPocketryTemplateMarkers(cv, rotatedImage);
      for (const marker of detected) {
        const before = original.find(({ id }) => id === marker.id)!;
        for (let index = 0; index < 4; index++) {
          expect(marker.cornersPx![index].x).toBeCloseTo(
            scene.width - 1 - before.cornersPx![index].x,
            0,
          );
          expect(marker.cornersPx![index].y).toBeCloseTo(
            scene.height - 1 - before.cornersPx![index].y,
            0,
          );
        }
      }
    } finally {
      rotated.delete();
      source.delete();
    }
  });

  it("recovers the scale end to end within 0.5%", () => {
    const scene = composeSheet(pocketryDictionary);
    const detection = detectCalibrationSheet(cv, scene)!;
    expect(detection.isTemplate).toBe(true);
    expect(detection.family).toBe(TEMPLATE_DICTIONARY);

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
      const scene = composeSheet(predefinedDictionary(cv[family]));
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
  it.each(["a4", "letter"] as const)(
    "produces a usable Calibration and identifies a %s sheet",
    (paper) => {
      const result = runAutoCalibration(
        cv,
        composeSheet(pocketryDictionary, paper),
      );
      expect(result.kind).toBe("calibrated");
      if (result.kind !== "calibrated") return;

      // The synthesised ruler spans the longest pair — a 250 mm diagonal — and
      // the app's own scale derivation must land on the composed scale.
      expect(result.calibration.lengthMm).toBeCloseTo(250, 9);
      const derived = mmPerPixel(result.calibration)!;
      expect(
        Math.abs(derived - 1 / PX_PER_MM) / (1 / PX_PER_MM),
      ).toBeLessThan(0.005);
      expect(result.solution.maxDeviation).toBeLessThan(0.01);
      expect(result.paper).toBe(paper);
      expect(result.perspectiveProposal?.source).toBe("template");
      expect(result.perspectiveProposal?.points).toHaveLength(4);
      expect(result.perspectiveProposal?.correspondences?.source).toHaveLength(16);
      expect(
        result.perspectiveProposal?.correspondences?.destinationMm,
      ).toHaveLength(16);
    },
  );

  it("classifies a 6x6 sheet as foreign", () => {
    const result = runAutoCalibration(
      cv,
      composeSheet(predefinedDictionary(cv.DICT_6X6_250)),
    );
    expect(result.kind).toBe("foreign-sheet");
    if (result.kind === "foreign-sheet") {
      expect(result.family).toBe("DICT_6X6_250");
      expect(result.reason).toBe("different-dictionary");
    }
  });

  it("rejects the stock 4x4 ids 0-3 that caused the false Pocketry match", () => {
    const result = runAutoCalibration(
      cv,
      composeSheet(predefinedDictionary(cv.DICT_4X4_50)),
    );
    expect(result).toMatchObject({
      kind: "foreign-sheet",
      family: "DICT_4X4_50",
      reason: "different-dictionary",
      markerIds: [0, 1, 2, 3],
    });
  });

  it("requires all four Pocketry signature markers", () => {
    const result = runAutoCalibration(
      cv,
      composeSheet(pocketryDictionary, "a4", {
        centers: templateMarkerCentersMm("a4").slice(0, 3),
      }),
    );
    expect(result).toMatchObject({
      kind: "foreign-sheet",
      family: TEMPLATE_DICTIONARY,
      reason: "incomplete-signature",
      markerIds: [0, 1, 2],
    });
  });

  it("rejects matching ids whose marker size does not fit the signed geometry", () => {
    const result = runAutoCalibration(
      cv,
      composeSheet(pocketryDictionary, "a4", { markerSizeMm: 20 }),
    );
    expect(result).toMatchObject({
      kind: "foreign-sheet",
      family: TEMPLATE_DICTIONARY,
      reason: "invalid-geometry",
    });
  });

  it("accepts the complete signed geometry in a perspective-skewed photo", () => {
    const result = runAutoCalibration(
      cv,
      photographSheet(composeSheet(pocketryDictionary)),
    );
    expect(result.kind).toBe("calibrated");
    if (result.kind !== "calibrated") return;

    expect(result.solution.markerIds).toEqual([0, 1, 2, 3]);
    expect(result.perspectiveProposal.correspondences?.source).toHaveLength(16);
    expect(result.templateReprojectionErrorMm).toBeLessThan(0.75);
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
