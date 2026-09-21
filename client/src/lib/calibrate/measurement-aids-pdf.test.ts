import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { mmPerPixel } from "@shared/geometry/scale";
import { runAutoCalibration } from "./auto-calibrate";
import { measurementAidsPdf } from "./measurement-aids-pdf";
import { PDF_POINTS_PER_MM } from "./template-pdf";

// The shipped OpenCV ArUco API is untyped.
let cv: any;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);

describe.each(["a4", "letter"] as const)("%s paper measurement aids", (paper) => {
  it("prints all three true-size cut-outs on one page, each with a recognized marker pair", () => {
    const pdf = new TextDecoder().decode(measurementAidsPdf(paper));
    const box = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
    const pageWidth = Number(box[1]) / PDF_POINTS_PER_MM;
    const pageHeight = Number(box[2]) / PDF_POINTS_PER_MM;
    expect(pageWidth).toBeCloseTo(paper === "a4" ? 297 : 279.4, 3);
    expect(pageHeight).toBeCloseTo(paper === "a4" ? 210 : 215.9, 3);
    expect(pdf).toContain("/PrintScaling /None");
    expect(pdf).toContain("/Count 1");
    expect(pdf).toContain("Print at 100% / Actual size. Turn off Fit to page.");
    expect(pdf).toContain("Cut out one aid to use in each photo");
    const cuts = [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S/g)];
    expect(cuts).toHaveLength(3);

    // Rasterize the emitted PDF ink in physical units, including its labels/ticks.
    // Detection catches wrong identities, reflection, spacing and accidental scaling.
    const pxPerMm = 4;
    const width = Math.ceil(pageWidth * pxPerMm), height = Math.ceil(pageHeight * pxPerMm);
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const rectangles = [...pdf.matchAll(/0 g ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)];
    expect(rectangles.length).toBeGreaterThan(100);
    for (const rect of rectangles) {
      const [x, y, w, h] = rect.slice(1).map((value) => Number(value) / PDF_POINTS_PER_MM);
      for (let row = Math.round((pageHeight - y - h) * pxPerMm); row < Math.round((pageHeight - y) * pxPerMm); row++) {
        for (let col = Math.round(x * pxPerMm); col < Math.round((x + w) * pxPerMm); col++) {
          const at = (row * width + col) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
    }
    // The complete page is intentionally not a calibration reference: cut one out.
    expect(runAutoCalibration(cv, { data, width, height, colorSpace: "srgb" } as ImageData).kind).not.toBe("calibrated-strip");
    for (const [index, length] of [50, 100, 200].entries()) {
      const [x, y, cutWidth, cutHeight] = cuts[index].slice(1).map((value) => Number(value) / PDF_POINTS_PER_MM);
      expect(x).toBeGreaterThan(20);
      expect(x + cutWidth).toBeLessThan(pageWidth - 20);
      expect(cutWidth).toBeCloseTo(length + 4, 3);
      expect(cutHeight).toBeCloseTo(19, 3);
      // All artwork stays inside the additional 2 mm white cut margin.
      const aidInk = rectangles.map((rect) => rect.slice(1).map((value) => Number(value) / PDF_POINTS_PER_MM))
        .filter(([, inkY]) => inkY >= y && inkY <= y + cutHeight);
      expect(aidInk.length).toBeGreaterThan(100);
      for (const [inkX, inkY, inkWidth, inkHeight] of aidInk) {
        expect(inkX - x).toBeGreaterThanOrEqual(1.999);
        expect(inkY - y).toBeGreaterThanOrEqual(1.999);
        expect(x + cutWidth - inkX - inkWidth).toBeGreaterThanOrEqual(1.999);
        expect(y + cutHeight - inkY - inkHeight).toBeGreaterThanOrEqual(1.999);
      }
      // Crop the full-page raster around one cut-out with a 2 mm outer margin.
      const left = Math.round((x - 2) * pxPerMm);
      const top = Math.round((pageHeight - y - cutHeight - 2) * pxPerMm);
      const cropWidth = (length + 8) * pxPerMm, cropHeight = 23 * pxPerMm;
      const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
      for (let row = 0; row < cropHeight; row++) {
        const start = ((top + row) * width + left) * 4;
        crop.set(data.subarray(start, start + cropWidth * 4), row * cropWidth * 4);
      }
      const result = runAutoCalibration(cv, { data: crop, width: cropWidth, height: cropHeight, colorSpace: "srgb" } as ImageData);
      expect(result.kind).toBe("calibrated-strip");
      if (result.kind !== "calibrated-strip") continue;
      expect(result.calibration.lengthMm).toBe(length - 15);
      expect(mmPerPixel(result.calibration)).toBeCloseTo(1 / pxPerMm, 3);
    }
  });
});
