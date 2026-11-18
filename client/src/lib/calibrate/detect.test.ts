import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

import { mmPerPixel } from "@shared/geometry/scale";
import { beforeAll, describe, expect, it } from "vitest";

import { runAutoCalibration } from "./auto-calibrate";
import {
  createPocketryTemplateDictionary,
  detectArucoMarkers,
  detectCalibrationSheet,
  detectPocketryTemplateMarkers,
  detectStreakedTemplateMarkers,
  hasArucoSupport,
  streakFillSizePx,
  TEMPLATE_DICTIONARY,
} from "./detect";
import { solveScaleFromMarkers } from "./solve";
import {
  TEMPLATE_PAPER_MM,
  templateMarkerCentersMm,
  templateMarkerSizeMm,
  templateMarkerSpacingMm,
  templatePaper,
  type TemplateVariant,
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
  template: TemplateVariant = "a4",
  options: {
    markerSizeMm?: number;
    centers?: ReturnType<typeof templateMarkerCentersMm>;
  } = {},
): ImageData {
  const paper = templatePaper(template);
  const width = Math.round(TEMPLATE_PAPER_MM[paper].width * PX_PER_MM);
  const height = Math.round(TEMPLATE_PAPER_MM[paper].height * PX_PER_MM);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);

  const sizePx =
    (options.markerSizeMm ?? templateMarkerSizeMm(template)) * PX_PER_MM;
  const dictionary = createDictionary();
  try {
    for (const { id, x, y } of
      options.centers ?? templateMarkerCentersMm(template)) {
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

/**
 * Draws light horizontal print streaks across markers of a composed sheet,
 * `offsetsPx` rows below each marker's top edge. Returns the same image.
 */
function addPrintStreaks(
  image: ImageData,
  template: TemplateVariant,
  offsetsPx: readonly number[],
  options: { thicknessPx?: number; gray?: number; onlyIds?: readonly number[] } = {},
): ImageData {
  const { thicknessPx = 1, gray = 255, onlyIds } = options;
  const sizePx = templateMarkerSizeMm(template) * PX_PER_MM;
  for (const { id, x, y } of templateMarkerCentersMm(template)) {
    if (onlyIds && !onlyIds.includes(id)) continue;
    const originX = Math.round(x * PX_PER_MM - sizePx / 2);
    const originY = Math.round(y * PX_PER_MM - sizePx / 2);
    for (const offset of offsetsPx) {
      for (let row = offset; row < offset + thicknessPx; row++) {
        for (let col = 0; col < sizePx; col++) {
          const at = ((originY + row) * image.width + originX + col) * 4;
          image.data.fill(gray, at, at + 3);
        }
      }
    }
  }
  return image;
}

/**
 * The shipped cv, counting detector passes (one `aruco_ArucoDetector` each)
 * and streak fills (`morphologyEx`). A proxy rather than a spy: embind
 * resolves a function's overloads through its own name on the module, so
 * replacing the property breaks it.
 */
function countingDetectorWork(): {
  cv: any;
  fills: () => number;
  passes: () => number;
} {
  let fills = 0;
  let passes = 0;
  const counting = new Proxy(cv, {
    get(target, key) {
      if (key === "morphologyEx") fills++;
      if (key === "aruco_ArucoDetector") passes++;
      return Reflect.get(target, key);
    },
  });
  return { cv: counting, fills: () => fills, passes: () => passes };
}

const sortedIds = (markers: readonly { id: number }[]) =>
  markers.map(({ id }) => id).sort((a, b) => a - b);

/** Shortest marker side over its longest: 1 for a square seen straight on. */
function quadSquareness(marker: { cornersPx?: readonly { x: number; y: number }[] }): number {
  const corners = marker.cornersPx!;
  const sides = corners.map((a, index) => {
    const b = corners[(index + 1) % 4];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  return Math.min(...sides) / Math.max(...sides);
}

/** Largest distance between matching corners of two calibrated sheets. */
function largestCornerShiftPx(
  a: Extract<ReturnType<typeof runAutoCalibration>, { kind: "calibrated" }>,
  b: Extract<ReturnType<typeof runAutoCalibration>, { kind: "calibrated" }>,
): number {
  const from = a.perspectiveProposal.correspondences!.source;
  const to = b.perspectiveProposal.correspondences!.source;
  expect(from).toHaveLength(16);
  expect(to).toHaveLength(16);
  return Math.max(
    ...from.map((point, index) =>
      Math.hypot(point.x - to[index].x, point.y - to[index].y),
    ),
  );
}

describe("aruco detection (closed loop with the shipped bundle)", () => {
  it("exposes the aruco API", () => {
    expect(hasArucoSupport(cv)).toBe(true);
  });

  it("finds all four template markers where they were drawn", () => {
    const scene = composeSheet(pocketryDictionary);
    const markers = detectPocketryTemplateMarkers(cv, scene);

    expect(markers.map((m) => m.id).sort()).toEqual([0, 1, 2, 3]);
    const sizePx = templateMarkerSizeMm("a4") * PX_PER_MM;
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

  it.each([
    ["a4-experimental", [8, 9, 10, 11]],
    ["letter-experimental", [12, 13, 14, 15]],
  ] as const)("finds all four markers on the %s sheet", (template, expectedIds) => {
    const scene = composeSheet(pocketryDictionary, template);
    const markers = detectPocketryTemplateMarkers(cv, scene);
    expect(markers.map(({ id }) => id).sort((a, b) => a - b)).toEqual(
      [...expectedIds],
    );
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
  it.each([
    "a4",
    "letter",
    "a4-experimental",
    "letter-experimental",
  ] as const)(
    "produces a usable Calibration and identifies a %s sheet",
    (template) => {
      const result = runAutoCalibration(
        cv,
        composeSheet(pocketryDictionary, template),
      );
      expect(result.kind).toBe("calibrated");
      if (result.kind !== "calibrated") return;

      // The synthesised ruler spans the longest marker-centre pair, and
      // the app's own scale derivation must land on the composed scale.
      const spacing = templateMarkerSpacingMm(template);
      expect(result.calibration.lengthMm).toBeCloseTo(
        Math.hypot(spacing.width, spacing.height),
        9,
      );
      const derived = mmPerPixel(result.calibration)!;
      expect(
        Math.abs(derived - 1 / PX_PER_MM) / (1 / PX_PER_MM),
      ).toBeLessThan(0.005);
      expect(result.solution.maxDeviation).toBeLessThan(0.01);
      expect(result.paper).toBe(templatePaper(template));
      expect(result.template).toBe(template);
      expect(result.perspectiveProposal?.source).toBe("template");
      expect(result.perspectiveProposal?.template).toBe(template);
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

describe("sheets printed with light streaks across the markers", () => {
  /** A calibrated result, or a failed expectation that names what came back. */
  function calibrated(result: ReturnType<typeof runAutoCalibration>) {
    expect(result).toMatchObject({ kind: "calibrated" });
    return result as Extract<typeof result, { kind: "calibrated" }>;
  }

  it.each(["a4", "letter-experimental"] as const)(
    "calibrates a %s sheet whose marker edges were found on streaks",
    (template) => {
      const cleanWork = countingDetectorWork();
      const clean = calibrated(
        runAutoCalibration(
          cleanWork.cv,
          composeSheet(pocketryDictionary, template),
        ),
      );
      // One streak inside each marker's top border: every marker still
      // decodes, but with its top edge placed on the streak.
      const streaked = addPrintStreaks(
        composeSheet(pocketryDictionary, template),
        template,
        [3],
      );
      const firstPass = detectPocketryTemplateMarkers(cv, streaked);
      expect(firstPass).toHaveLength(4);
      for (const marker of firstPass) {
        expect(quadSquareness(marker)).toBeLessThan(0.96);
      }

      const counted = countingDetectorWork();
      const result = calibrated(runAutoCalibration(counted.cv, streaked));
      // The second look is one streak fill and exactly one more detector pass.
      expect(counted.fills()).toBe(1);
      expect(counted.passes()).toBe(cleanWork.passes() + 1);
      expect(result.template).toBe(template);
      // Filling the streaks must not move a corner: the recovered sheet is
      // the clean sheet, to a small fraction of a pixel.
      expect(largestCornerShiftPx(result, clean)).toBeLessThan(0.05);
      expect(result.templateReprojectionErrorMm).toBeCloseTo(
        clean.templateReprojectionErrorMm,
        3,
      );
      const derived = mmPerPixel(result.calibration)!;
      expect(
        Math.abs(derived - 1 / PX_PER_MM) / (1 / PX_PER_MM),
      ).toBeLessThan(0.005);
    },
  );

  it("completes a sheet when streaks hide one marker", () => {
    const template = "letter-experimental";
    const streaked = addPrintStreaks(
      composeSheet(pocketryDictionary, template),
      template,
      [3],
      { thicknessPx: 2 },
    );
    expect(
      detectPocketryTemplateMarkers(cv, streaked)
        .map(({ id }) => id)
        .sort((a, b) => a - b),
    ).toEqual([13, 14, 15]);

    const result = calibrated(runAutoCalibration(cv, streaked));
    expect(result.solution.markerIds.slice().sort((a, b) => a - b)).toEqual([
      12, 13, 14, 15,
    ]);
    expect(
      result.perspectiveProposal.correspondences?.destinationMm,
    ).toHaveLength(16);
  });

  it("recovers when only one marker of the sheet is streaked", () => {
    const template = "a4";
    const clean = calibrated(
      runAutoCalibration(cv, composeSheet(pocketryDictionary, template)),
    );
    const sizePx = templateMarkerSizeMm(template) * PX_PER_MM;
    const streaked = addPrintStreaks(
      composeSheet(pocketryDictionary, template),
      template,
      [3, sizePx - 5],
      { thicknessPx: 2, onlyIds: [3] },
    );
    const result = calibrated(runAutoCalibration(cv, streaked));
    expect(largestCornerShiftPx(result, clean)).toBeLessThan(0.05);
  });

  it("recovers a streaked sheet photographed at an angle", () => {
    const template = "a4";
    const clean = calibrated(
      runAutoCalibration(
        cv,
        photographSheet(composeSheet(pocketryDictionary, template)),
      ),
    );
    // Streaks drawn before the warp end up tilted and softened, as in a photo.
    const streaked = photographSheet(
      addPrintStreaks(composeSheet(pocketryDictionary, template), template, [3]),
    );
    const firstPass = detectPocketryTemplateMarkers(cv, streaked);
    expect(Math.min(...firstPass.map(quadSquareness))).toBeLessThan(0.8);

    const result = calibrated(runAutoCalibration(cv, streaked));
    expect(result.templateReprojectionErrorMm).toBeLessThan(0.75);
    expect(largestCornerShiftPx(result, clean)).toBeLessThan(0.5);
  });

  it("does not look again when the first pass already calibrates", () => {
    const counted = countingDetectorWork();
    calibrated(runAutoCalibration(counted.cv, composeSheet(pocketryDictionary)));
    expect(counted.fills()).toBe(0);
  });

  it("does not look again when no Pocketry marker was found", () => {
    const counted = countingDetectorWork();
    const blank = {
      data: new Uint8ClampedArray(160 * 160 * 4).fill(255),
      width: 160,
      height: 160,
      colorSpace: "srgb",
    } as ImageData;
    expect(runAutoCalibration(counted.cv, blank).kind).toBe("no-markers");
    expect(
      runAutoCalibration(
        counted.cv,
        composeSheet(predefinedDictionary(cv.DICT_6X6_250)),
      ),
    ).toMatchObject({ kind: "foreign-sheet", reason: "different-dictionary" });
    expect(counted.fills()).toBe(0);
  });

  it("keeps the first verdict when the second look cannot complete the sheet", () => {
    const counted = countingDetectorWork();
    const result = runAutoCalibration(
      counted.cv,
      composeSheet(pocketryDictionary, "a4", {
        centers: templateMarkerCentersMm("a4").slice(0, 3),
      }),
    );
    expect(counted.fills()).toBe(1);
    expect(result).toMatchObject({
      kind: "foreign-sheet",
      family: TEMPLATE_DICTIONARY,
      reason: "incomplete-signature",
      markerIds: [0, 1, 2],
    });
  });

  it("reports the first pass's verdict, not the second's, when neither validates", () => {
    // Three markers of a sheet, the third hidden from the first pass by a
    // streak through its pattern. The second look finds it, but three
    // markers are still no sheet, so the first verdict must come back.
    const template = "a4";
    const sizePx = templateMarkerSizeMm(template) * PX_PER_MM;
    const streaked = addPrintStreaks(
      composeSheet(pocketryDictionary, template, {
        centers: templateMarkerCentersMm(template).slice(0, 3),
      }),
      template,
      [Math.round(sizePx * 0.45)],
      { onlyIds: [2] },
    );
    const firstPass = detectPocketryTemplateMarkers(cv, streaked);
    expect(sortedIds(firstPass)).toEqual([0, 1]);
    expect(
      sortedIds(detectStreakedTemplateMarkers(cv, streaked, firstPass)),
    ).toEqual([0, 1, 2]);

    const counted = countingDetectorWork();
    const result = runAutoCalibration(counted.cv, streaked);
    expect(counted.fills()).toBe(1);
    expect(result).toMatchObject({
      kind: "foreign-sheet",
      reason: "incomplete-signature",
      markerIds: [0, 1],
    });
  });

  it("gives a measurement aid the recovered sheet alongside its own scale", () => {
    // The photographed 100 mm aid (ids 24/25) laid on a composed sheet.
    const template = "letter-experimental";
    const aid = gunzipSync(
      readFileSync(
        new URL("./fixtures/100mm-ruler-photo.rgba.gz", import.meta.url),
      ),
    );
    const withAid = (sheet: ImageData): ImageData => {
      for (let row = 0; row < 188; row++) {
        sheet.data.set(
          aid.subarray(row * 70 * 4, (row + 1) * 70 * 4),
          ((row + 180) * sheet.width + 181) * 4,
        );
      }
      return sheet;
    };
    const clean = runAutoCalibration(
      cv,
      withAid(composeSheet(pocketryDictionary, template)),
    );
    const streaked = runAutoCalibration(
      cv,
      withAid(
        addPrintStreaks(composeSheet(pocketryDictionary, template), template, [3]),
      ),
    );
    expect(clean).toMatchObject({ kind: "calibrated-strip" });
    expect(streaked).toMatchObject({ kind: "calibrated-strip" });
    if (clean.kind !== "calibrated-strip" || streaked.kind !== "calibrated-strip") return;

    // The aid's own scale is untouched by what happens to the paper markers.
    expect(streaked.calibration).toEqual(clean.calibration);
    expect(streaked.requiresPerspectiveCorrection).toBe(
      clean.requiresPerspectiveCorrection,
    );
    expect(largestCornerShiftPx(calibrated(streaked.sheet!), calibrated(clean.sheet!))).toBeLessThan(0.05);
  });

  it("keeps rejecting a sheet whose geometry is wrong without streaks", () => {
    const counted = countingDetectorWork();
    const result = runAutoCalibration(
      counted.cv,
      composeSheet(pocketryDictionary, "a4", { markerSizeMm: 20 }),
    );
    expect(counted.fills()).toBe(1);
    expect(result).toMatchObject({
      kind: "foreign-sheet",
      reason: "invalid-geometry",
    });
  });

  /**
   * A complete a4 sheet with a second copy of `copyId` at the page center and
   * a dark block two pixels beside the copy. Filling light lines closes that
   * gap, so the copy joins the block and the second look no longer sees it.
   */
  function sheetWithHideableCopy(copyId: number): ImageData {
    const template = "a4";
    const sizePx = templateMarkerSizeMm(template) * PX_PER_MM;
    const page = TEMPLATE_PAPER_MM[templatePaper(template)];
    const copy = { id: copyId, x: page.width / 2, y: page.height / 2 };
    const sheet = composeSheet(pocketryDictionary, template, {
      centers: [...templateMarkerCentersMm(template), copy],
    });
    const left = Math.round(copy.x * PX_PER_MM + sizePx / 2) + 2;
    const top = Math.round(copy.y * PX_PER_MM - sizePx / 2);
    for (let row = top; row < top + sizePx; row++) {
      for (let col = left; col < left + 12; col++) {
        const at = (row * sheet.width + col) * 4;
        sheet.data.fill(0, at, at + 3);
      }
    }
    return sheet;
  }

  it("keeps rejecting a repeated id that the second look would no longer see", () => {
    const sheet = sheetWithHideableCopy(0);
    const firstPass = detectPocketryTemplateMarkers(cv, sheet);
    expect(sortedIds(firstPass)).toEqual([0, 0, 1, 2, 3]);
    // The hazard: with the gap filled, the copy is gone and the sheet looks clean.
    expect(
      sortedIds(detectStreakedTemplateMarkers(cv, sheet, firstPass)),
    ).toEqual([0, 1, 2, 3]);

    const counted = countingDetectorWork();
    expect(runAutoCalibration(counted.cv, sheet)).toMatchObject({
      kind: "foreign-sheet",
      reason: "invalid-geometry",
      markerIds: [0, 0, 1, 2, 3],
    });
    // A repeated id is not streak damage, so there is no second look at all.
    expect(counted.fills()).toBe(0);
  });

  it("keeps the first verdict when the second look drops a marker the first pass saw", () => {
    // The sheet's own id 2 is hidden from the first pass by a streak, so the
    // copy of id 2 is the only one it sees: four distinct ids in the wrong
    // geometry. The second look finds the real one and loses the copy. Two
    // markers with one id were in the photo, and that must not calibrate.
    const template = "a4";
    const sizePx = templateMarkerSizeMm(template) * PX_PER_MM;
    const sheet = addPrintStreaks(
      sheetWithHideableCopy(2),
      template,
      [Math.round(sizePx * 0.45)],
      { onlyIds: [2] },
    );
    const firstPass = detectPocketryTemplateMarkers(cv, sheet);
    expect(sortedIds(firstPass)).toEqual([0, 1, 2, 3]);
    expect(
      sortedIds(detectStreakedTemplateMarkers(cv, sheet, firstPass)),
    ).toEqual([0, 1, 2, 3]);

    expect(runAutoCalibration(cv, sheet)).toMatchObject({
      kind: "foreign-sheet",
      reason: "invalid-geometry",
      markerIds: [0, 1, 2, 3],
    });
  });
});

describe("streakFillSizePx", () => {
  type Corner = { x: number; y: number };
  const quad = (widthPx: number, heightPx = widthPx) => ({
    id: 0,
    centerPx: { x: widthPx / 2, y: heightPx / 2 },
    cornersPx: [
      { x: 0, y: 0 },
      { x: widthPx, y: 0 },
      { x: widthPx, y: heightPx },
      { x: 0, y: heightPx },
    ] as [Corner, Corner, Corner, Corner],
  });

  it.each([
    [48, 3],
    [100, 5],
    [140, 7],
    [180, 9],
    [400, 9],
  ])("fills streaks for %i px markers with a %i px square", (sidePx, expected) => {
    expect(streakFillSizePx([quad(sidePx)])).toBe(expected);
  });

  it("is always odd and stays well inside one marker cell", () => {
    for (let sidePx = 40; sidePx <= 400; sidePx += 7) {
      const size = streakFillSizePx([quad(sidePx)]);
      expect(size % 2).toBe(1);
      expect(size).toBeGreaterThanOrEqual(3);
      expect(size).toBeLessThan(sidePx / 6 / 2);
    }
  });

  it("sizes from the longest side, which a streak cannot shorten", () => {
    expect(streakFillSizePx([quad(100, 60), quad(40)])).toBe(5);
  });

  it("falls back to the smallest square without usable corners", () => {
    expect(streakFillSizePx([])).toBe(3);
    expect(streakFillSizePx([{ id: 1, centerPx: { x: 0, y: 0 } }])).toBe(3);
  });
});
