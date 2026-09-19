import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { mmPerPixel } from "@shared/geometry/scale";
import type { Point } from "@shared/geometry/types";
import { runAutoCalibration } from "./auto-calibrate";
import { POCKETRY_ARUCO_BITS } from "./aruco-4x4";
import { createPocketryTemplateDictionary } from "./detect";
import { REFERENCE_STRIP, referenceStripMarkers } from "./reference-strip";
import { solveReferenceStrip } from "./solve-reference-strip";
import { referenceStripPdf } from "./reference-strip-pdf";
import { PDF_POINTS_PER_MM } from "./template-pdf";
import { TEMPLATE_PAPER_MM, templateMarkerCentersMm, templateMarkerSizeMm, type TemplateVariant } from "./template";

// OpenCV.js has no typings for the shipped ArUco API.
let cv: any;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);

/** Independent renderer: OpenCV produces the marker pixels, not our print code. */
function photograph(options: { pxPerMm?: number; ids?: number[]; spacing?: number; markerSize?: number; sheet?: TemplateVariant; squash?: number } = {}): ImageData {
  const width = 1400, height = 1000;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const dictionary = createPocketryTemplateDictionary(cv, POCKETRY_ARUCO_BITS.length);
  const put = (id: number, x: number, y: number, size: number) => {
    const mat = new cv.Mat();
    try {
      dictionary.generateImageMarker(id, size, mat, 1);
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
        const at = ((y + row) * width + x + col) * 4;
        data[at] = data[at + 1] = data[at + 2] = mat.data[row * size + col];
      }
    } finally { mat.delete(); }
  };
  try {
    const scale = options.pxPerMm ?? 4;
    (options.ids ?? [20, 21]).forEach((id, index) => put(id, 150 + index * (options.spacing ?? 80) * scale, 350, (options.markerSize ?? 15) * scale));
    if (options.sheet) {
      for (const { id, x, y } of templateMarkerCentersMm(options.sheet)) {
        const size = templateMarkerSizeMm(options.sheet) * 3;
        put(id, Math.round(x * 3 - size / 2), Math.round(y * 3 - size / 2), size);
      }
    }
  } finally { dictionary.delete(); }
  if (options.squash) {
    const source = cv.matFromImageData({ data, width, height });
    const dest = new cv.Mat();
    try {
      cv.resize(source, dest, new cv.Size(width, Math.round(height * options.squash)), 0, 0, cv.INTER_AREA);
      return { data: new Uint8ClampedArray(dest.data), width: dest.cols, height: dest.rows, colorSpace: "srgb" } as ImageData;
    } finally { source.delete(); dest.delete(); }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

/** Rasterize only the actual PDF's filled black vector rectangles, in physical units. */
function rasterizePdf(paper: "a4" | "letter"): ImageData {
  const pdf = new TextDecoder().decode(referenceStripPdf(paper));
  const scale = 4;
  const page = TEMPLATE_PAPER_MM[paper];
  const width = Math.ceil(page.width * scale), height = Math.ceil(page.height * scale);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const m of pdf.matchAll(/0 g ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)) {
    const [x, y, w, h] = m.slice(1).map((n) => Number(n) / PDF_POINTS_PER_MM);
    for (let row = Math.round((page.height - y - h) * scale); row < Math.round((page.height - y) * scale); row++) {
      for (let col = Math.round(x * scale); col < Math.round((x + w) * scale); col++) {
        const at = (row * width + col) * 4;
        data[at] = data[at + 1] = data[at + 2] = 0;
      }
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("object reference strip", () => {
  it.each([2, 4, 6])("detects a %s px/mm photograph with an 80 mm ruler, not 100 mm", (pxPerMm) => {
    const result = runAutoCalibration(cv, photograph({ pxPerMm }));
    expect(result.kind).toBe("calibrated-strip");
    if (result.kind !== "calibrated-strip") return;
    expect(result.calibration.lengthMm).toBe(80);
    expect(mmPerPixel(result.calibration)).toBeCloseTo(1 / pxPerMm, 3);
    expect("perspectiveProposal" in result).toBe(false);
  });

  it.each(["a4", "letter", "a4-experimental", "letter-experimental"] as const)("uses the raised strip's scale instead of the %s sheet underneath", (sheet) => {
    const result = runAutoCalibration(cv, photograph({ sheet }));
    expect(result.kind).toBe("calibrated-strip");
    if (result.kind === "calibrated-strip") expect(result.solution.mmPerPx).toBeCloseTo(0.25, 3);
  });

  it.each([90, 180, 270])("recognizes a photo rotated %s degrees", (degrees) => {
    const source = cv.matFromImageData(photograph()); const dest = new cv.Mat();
    try {
      cv.rotate(source, dest, degrees === 90 ? cv.ROTATE_90_CLOCKWISE : degrees === 180 ? cv.ROTATE_180 : cv.ROTATE_90_COUNTERCLOCKWISE);
      const result = runAutoCalibration(cv, { data: new Uint8ClampedArray(dest.data), width: dest.cols, height: dest.rows, colorSpace: "srgb" } as ImageData);
      expect(result.kind).toBe("calibrated-strip");
      if (result.kind === "calibrated-strip") expect(result.solution.mmPerPx).toBeCloseTo(0.25, 3);
    } finally { source.delete(); dest.delete(); }
  });

  it.each([
    { ids: [22, 23], spacing: 35 },
    { ids: [24, 25], spacing: 85 },
    { ids: [26, 27], spacing: 185 },
  ])("selects the correct ruler length from independent OpenCV markers over a paper sheet: %j", (options) => {
    const result = runAutoCalibration(cv, photograph({ ...options, markerSize: 9, sheet: "letter-experimental" }));
    expect(result.kind).toBe("calibrated-strip");
    if (result.kind !== "calibrated-strip") return;
    expect(result.calibration.lengthMm).toBe(options.spacing);
    expect(mmPerPixel(result.calibration)).toBeCloseTo(.25, 3);
  });

  it.each([[22], [22, 25], [24, 25, 22], [26, 26]])("rejects incomplete, mixed-size or duplicate new markers without falling back to paper: %j", (...ids) => {
    expect(runAutoCalibration(cv, photograph({ ids, markerSize: 9, sheet: "letter-experimental" })).kind).toBe("invalid-strip");
  });

  it.each([
    { ids: [20], sheet: "letter" as const },
    { ids: [20, 20] }, { ids: [20, 21, 20] }, { ids: [21, 20] },
    { spacing: 100 }, { squash: 0.8 },
  ])("rejects incomplete, repeated, swapped, stretched or oblique strips: %j", (options) => {
    expect(runAutoCalibration(cv, photograph(options)).kind).toBe("invalid-strip");
  });

  it.each(["a4", "letter"] as const)("detects the actual %s PDF vector ink at its physical scale", (paper) => {
    const result = runAutoCalibration(cv, rasterizePdf(paper));
    expect(result.kind).toBe("calibrated-strip");
    if (result.kind === "calibrated-strip") expect(result.solution.mmPerPx).toBeCloseTo(0.25, 3);
    const pdf = new TextDecoder().decode(referenceStripPdf(paper));
    expect(pdf).toContain("/PrintScaling /None");
    const bar = [...pdf.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) \2 l S/g)][0];
    expect((Number(bar[3]) - Number(bar[1])) / PDF_POINTS_PER_MM).toBeCloseTo(100, 4);
    const cut = pdf.match(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S/)!;
    expect(Number(cut[3]) / PDF_POINTS_PER_MM).toBeCloseTo(100, 4);
    expect(Number(cut[4]) / PDF_POINTS_PER_MM).toBeCloseTo(20, 4);
  });

  it("rejects reflected, independently rotated and non-finite corner coordinates", () => {
    const markers = referenceStripMarkers().map(({ id, center, corners }) => ({ id, centerPx: center, cornersPx: corners }));
    expect(solveReferenceStrip(markers)?.mmPerPx).toBe(1);
    const mapPoints = (fn: (p: Point) => Point) => markers.map((m) => ({ id: m.id, centerPx: fn(m.centerPx), cornersPx: m.cornersPx.map(fn) as [Point, Point, Point, Point] }));
    expect(solveReferenceStrip(mapPoints(({ x, y }) => ({ x: -x, y })))).toBeNull();
    expect(solveReferenceStrip(mapPoints(({ x, y }) => ({ x, y: y === 2.5 ? NaN : y })))).toBeNull();
    const turned = structuredClone(markers);
    turned[1].cornersPx.push(turned[1].cornersPx.shift()!);
    expect(solveReferenceStrip(turned)).toBeNull();
    expect(REFERENCE_STRIP.centerSpacingMm).toBe(80);
  });
});
