import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { POCKETRY_ARUCO_BITS, markerBits } from "./aruco-4x4";
import { createPocketryTemplateDictionary } from "./detect";

/**
 * Oracle tests for the ported DICT_4X4 patterns, against the aruco-enabled
 * opencv.js the app actually ships (`client/public/opencv/opencv.js`, built
 * by scripts/build-opencv-js.sh): OpenCV's own `generateImageMarker` renders
 * each marker and must agree cell-for-cell with `markerBits`.
 *
 * Loading the real bundle keeps this suite honest — it also pins the fact
 * that the shipped build exposes the detector API the auto-calibration
 * feature depends on.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */
let cv: any;

beforeAll(async () => {
  const required = createRequire(import.meta.url)(
    "../../../public/opencv/opencv.js",
  ) as unknown;
  // Node gets the module-ready promise; older wrappers hand the object back.
  cv = await Promise.resolve(required);
}, 60000);

describe("shipped opencv.js", () => {
  it("exposes the aruco detection API", () => {
    expect(typeof cv.aruco_ArucoDetector).toBe("function");
    expect(typeof cv.aruco_DetectorParameters).toBe("function");
    expect(typeof cv.aruco_RefineParameters).toBe("function");
    expect(typeof cv.getPredefinedDictionary).toBe("function");
    expect(typeof cv.extendDictionary).toBe("function");
    expect(typeof cv.findHomography).toBe("function");
    expect(typeof cv.perspectiveTransform).toBe("function");
    expect(typeof cv.generateImageMarker).toBe("function");
    expect(cv.DICT_4X4_50).toBe(0);
    // 6x6 support for pre-existing sheets (like tool_images/test_part.jpg).
    expect(typeof cv.DICT_6X6_250).toBe("number");
  });

  it("still provides everything the detect pipeline calls", () => {
    for (const name of [
      "Mat",
      "cvtColor",
      "GaussianBlur",
      "threshold",
      "morphologyEx",
      "findContours",
    ]) {
      expect(typeof cv[name], name).toBe("function");
    }
  });
});

describe("markerBits vs cv.generateImageMarker (oracle)", () => {
  it.each(POCKETRY_ARUCO_BITS.map((_, id) => id))(
    "Pocketry v2 marker id %i matches OpenCV's rendering",
    (id) => {
    const dictionary = createPocketryTemplateDictionary(cv);
    const image = new cv.Mat();
    try {
      // 6 px side at 1 border bit → exactly one pixel per module.
      cv.generateImageMarker(dictionary, id, 6, image, 1);
      expect(image.rows).toBe(6);
      expect(image.cols).toBe(6);

      const expected = markerBits(id);
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 6; col++) {
          const pixel = image.data[row * 6 + col];
          const border = row === 0 || row === 5 || col === 0 || col === 5;
          const want = border ? 0 : expected[row - 1][col - 1] * 255;
          expect(pixel, `id ${id} cell ${row},${col}`).toBe(want);
        }
      }
    } finally {
      image.delete();
      dictionary.delete?.();
    }
    },
  );
});
