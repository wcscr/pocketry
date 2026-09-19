import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { mmPerPixel } from "@shared/geometry/scale";
import { runAutoCalibration } from "./auto-calibrate";
import { createPocketryTemplateDictionary, detectReferenceStripMarkers } from "./detect";
import { referenceStripMarkers, MEASUREMENT_AIDS } from "./reference-strip";
import { solveReferenceStrip } from "./solve-reference-strip";

// The shipped OpenCV ArUco API is untyped.
let cv: any;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);

/** Unscaled photographic pixels; only the tool/aid crop is retained as a fixture. */
function photograph(withPaper = false): ImageData {
  const width = 880, height = 1174;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const crop = gunzipSync(readFileSync(new URL("./fixtures/100mm-ruler-photo.rgba.gz", import.meta.url)));
  for (let y = 0; y < 188; y++) {
    data.set(crop.subarray(y * 70 * 4, (y + 1) * 70 * 4), ((y + 486) * width + 382) * 4);
  }
  if (withPaper) {
    const dictionary = createPocketryTemplateDictionary(cv);
    const marker = new cv.Mat();
    try {
      // A second, lower plane deliberately has a different scale.
      for (const [id, x, y] of [[12, 150, 250], [13, 650, 250], [14, 650, 850], [15, 150, 850]]) {
        dictionary.generateImageMarker(id, 48, marker, 1);
        for (let row = 0; row < 48; row++) for (let col = 0; col < 48; col++) {
          const offset = ((y + row) * width + x + col) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = marker.data[row * 48 + col];
        }
      }
    } finally { dictionary.delete(); marker.delete(); }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("small markers in the photographed 100 mm aid", () => {
  it.each([0, 90, 180, 270])("recognizes and calibrates the actual photo at %s degrees", (degrees) => {
    const photo = photograph(true);
    const src = cv.matFromImageData(photo), rotated = new cv.Mat();
    try {
      if (degrees) cv.rotate(src, rotated, degrees === 90 ? cv.ROTATE_90_CLOCKWISE : degrees === 180 ? cv.ROTATE_180 : cv.ROTATE_90_COUNTERCLOCKWISE);
      const image = degrees ? { data: new Uint8ClampedArray(rotated.data), width: rotated.cols, height: rotated.rows, colorSpace: "srgb" } as ImageData : photo;
      const markers = detectReferenceStripMarkers(cv, image);
      expect(markers.map(({ id }) => id).sort()).toEqual([24, 25]);
      const result = runAutoCalibration(cv, image);
      expect(result.kind).toBe("calibrated-strip");
      if (result.kind !== "calibrated-strip") return;
      expect(result.calibration.lengthMm).toBe(85);
      expect(mmPerPixel(result.calibration)).toBeCloseTo(0.632, 2);
      // Preserve the measured deviation so acceptance still asks for review.
      expect(result.solution.maxDeviation).toBeGreaterThan(.06);
      expect(result.solution.maxDeviation).toBeLessThan(.10);
    } finally { src.delete(); rotated.delete(); }
  });

  it("does not let the pixel allowance accept the same distortion at high resolution", () => {
    const markers = detectReferenceStripMarkers(cv, photograph());
    const enlarged = markers.map((marker) => ({
      ...marker,
      centerPx: { x: marker.centerPx.x * 4, y: marker.centerPx.y * 4 },
      cornersPx: marker.cornersPx!.map((p) => ({ x: p.x * 4, y: p.y * 4 })) as typeof marker.cornersPx,
    }));
    expect(solveReferenceStrip(enlarged)).toBeNull();
  });

  it("still rejects low-resolution foreshortening, changed baselines and wrong marker pairs", () => {
    const ideal = referenceStripMarkers(MEASUREMENT_AIDS[100]).map(({ id, center, corners }) => ({
      id, centerPx: { x: center.x * 1.6, y: center.y * 1.6 },
      cornersPx: corners.map(({ x, y }) => ({ x: x * 1.6, y: y * 1.6 })) as [typeof center, typeof center, typeof center, typeof center],
    }));
    expect(solveReferenceStrip(ideal)?.mmPerPx).toBeCloseTo(.625);
    const oblique = ideal.map((m) => ({ ...m, centerPx: { ...m.centerPx, y: m.centerPx.y * .85 }, cornersPx: m.cornersPx.map((p) => ({ ...p, y: p.y * .85 })) as typeof m.cornersPx }));
    expect(solveReferenceStrip(oblique)).toBeNull();
    const stretched = structuredClone(ideal);
    stretched[1].centerPx.x += 15 * 1.6;
    stretched[1].cornersPx.forEach((p) => { p.x += 15 * 1.6; });
    expect(solveReferenceStrip(stretched)).toBeNull();
    expect(solveReferenceStrip([{ ...ideal[0], id: 22 }, ideal[1]])).toBeNull();
  });
});
