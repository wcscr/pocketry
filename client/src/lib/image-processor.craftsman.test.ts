import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { reconstructDetectedForEditing } from "@shared/geometry/detected-cleanup";
import { compareContours } from "@shared/geometry/contour-metrics";
import { templateInkRegionsInPixels } from "./calibrate/template";
import { detectOutline } from "./detect/pipeline";
import { createTeedDetector } from "./detect/teed";
import { SHEET_STROKE_MM } from "./detect/sheet-ink";
import { detectInWorker, reconstructInWorker } from "./detect/worker-client";
import metadata from "./detect/fixtures/craftsman-sheet.json";
import { processImage, reprocessOutline } from "./image-processor";

// Replace transport only: the detector, OpenCV, TEED, smoothing and app cleanup
// all run their real implementations, with the same input pixels in every run.
vi.mock("./detect/worker-client", () => ({ detectInWorker: vi.fn(), reconstructInWorker: vi.fn() }));
const detector = createTeedDetector(async () => new Uint8Array(readFileSync(
  new URL("../../public/models/teed/teed-512-f1a4f305.onnx", import.meta.url))));
const image = { width: metadata.width, height: metadata.height, data: new Uint8ClampedArray(gunzipSync(
  readFileSync(new URL("./detect/fixtures/craftsman-sheet.rgba.gz", import.meta.url)))) };
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 25 };

beforeAll(async () => {
  const cv = await createRequire(import.meta.url)("../../public/opencv/opencv.js");
  vi.stubGlobal("Worker", class {});
  vi.mocked(detectInWorker).mockImplementation((pixels, options) => detectOutline(pixels, options, { loadCV: async () => cv, teed: detector }));
  vi.mocked(reconstructInWorker).mockImplementation(async request =>
    reconstructDetectedForEditing(request.source, request.dense, request.tolerance, request.editableCurves));
});
afterAll(() => { detector.dispose(); vi.unstubAllGlobals(); });

it.each(["color", "teed"] as const)("cleans the Craftsman on-sheet photo with %s detection at +56", async boundary => {
  const result = await processImage(image, {
    calibration, smoothBoundary: true, autoCleanup: true,
    detect: { boundary, sensitivity: 72, tolerancePx: 1.2, smoothing: 1,
      sheetInk: { strokePx: SHEET_STROKE_MM / metadata.mmPerPx,
        regions: templateInkRegionsInPixels("letter-experimental", metadata.paperBounds)
          .map(area => ({ ...area, x: area.x - metadata.region.x, y: area.y - metadata.region.y })) } },
  });
  expect(result.cleanup?.applied).toBe(true);
  expect(result.rawOutline[0].outer.length).toBeGreaterThan(1000);
  expect(result.outline).toHaveLength(1);
  expect(result.outline[0].outer.length).toBeLessThan(400);
  // Fewer points alone could hide a lost part. Check the whole accepted
  // silhouette at fine spacing, independently of the production guard.
  const distance = compareContours(result.outline, result.rawOutline, { spacing: .1 });
  expect(Math.max(distance.missingMax!, distance.cutInMax!)).toBeLessThan(1.2);
  expect(distance.excessMax).toBeLessThan(4);
  const source = result.refinementBase ?? result.rawOutline;
  const fine = await reprocessOutline(source, { calibration, detect: { tolerancePx: .1, smoothing: 0 } });
  const coarse = await reprocessOutline(source, { calibration, detect: { tolerancePx: 3, smoothing: 0 } });
  expect(coarse[0].outer.length).toBeLessThan(fine[0].outer.length / 2);
}, 15000);
