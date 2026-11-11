/** Derive optional corrected views from prepared local photo selections.
 * Args: original-cases.json, output directory. No inference / photo discovery.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAutoCalibration, type AutoCalibrationResult } from "../client/src/lib/calibrate/auto-calibrate";
import { runPerspectiveCorrection, scalePerspectiveProposal, RECTIFIED_IMAGE_MAX } from "../client/src/lib/calibrate/perspective";
import { templateMarkerCentersMm } from "../client/src/lib/calibrate/template";
import { mmPerPixel } from "../shared/geometry/scale";
import { MatScope } from "../client/src/lib/detect/segment-opencv";
import type { Point, Ring } from "../shared/geometry/types";

interface Frame { path: string; width: number; height: number }
interface Probe { name: string; kind: "body" | "feature"; object?: number; point: Point }
interface Prepared extends Frame {
  index: number; name: string; sourceFile: string; sourceSha256: string; naturalSize: [number, number];
  sourceCrop: [number, number, number, number]; frames: Record<string, Frame>; probes: Probe[];
  tolerancePx: number; role: string; parent?: string; expectedTools: number;
}
const cases: Prepared[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
// OpenCV is injected into the application calibration/geometry functions.
const cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const pixels = (frame: Frame): ImageData => ({ width: frame.width, height: frame.height,
  data: new Uint8ClampedArray(readFileSync(frame.path)), colorSpace: "srgb" });
const results: unknown[] = [], calibrationRows: unknown[] = [];
function detect(image: ImageData): { reference: AutoCalibrationResult; size: { width: number; height: number } } {
  let reference: AutoCalibrationResult = { kind: "no-markers" }, size = { width: image.width, height: image.height };
  for (const limit of [1600, 2400]) {
    const scale = Math.min(1, limit / image.width, limit / image.height);
    const scope = new MatScope();
    try {
      const src = scope.track(cv.matFromImageData(image)), resized = scope.track(new cv.Mat());
      cv.resize(src, resized, new cv.Size(Math.round(image.width * scale), Math.round(image.height * scale)), 0, 0, cv.INTER_LINEAR);
      size = { width: resized.cols, height: resized.rows };
      reference = runAutoCalibration(cv, { ...size, data: new Uint8ClampedArray(resized.data), colorSpace: "srgb" });
    } finally { scope.dispose(); }
    if (!(reference.kind === "invalid-strip" || reference.kind === "calibrated" && reference.stripFallbackReason)) break;
  }
  return { reference, size };
}
for (const index of [...new Set(cases.map(c => c.index))]) {
  const selections = cases.filter(c => c.index === index), photo = selections[0];
  let frame = photo.frames[1600], reference = runAutoCalibration(cv, pixels(frame));
  if (reference.kind === "invalid-strip" || reference.kind === "calibrated" && reference.stripFallbackReason) {
    frame = photo.frames[2400]; reference = runAutoCalibration(cv, pixels(frame));
  }
  for (const c of selections) {
    const [left, top, right, bottom] = c.sourceCrop;
    const map = (p: Point): Point => ({ x: (p.x * c.naturalSize[0] / frame.width - left) * c.width / (right - left),
      y: (p.y * c.naturalSize[1] / frame.height - top) * c.height / (bottom - top) });
    const ruler = reference.kind === "calibrated" || reference.kind === "calibrated-strip" ? reference.calibration : undefined;
    const a = ruler && map({ x: ruler.startX, y: ruler.startY }), b = ruler && map({ x: ruler.endX, y: ruler.endY });
    const mmPerPx = a && b && ruler ? ruler.lengthMm / Math.hypot(b.x - a.x, b.y - a.y) : undefined;
    const { frames: _frames, ...metadata } = c;
    results.push({ ...metadata, photoIndex: index, view: "Original-pixel crop", mmPerPx, calibrationKind: reference.kind,
      occlusions: reference.kind === "calibrated-strip" && reference.aidOutline ? [reference.aidOutline.map(map)] : [],
      probes: c.probes.map(p => ({ ...p, point: { x: p.point.x * c.width, y: p.point.y * c.height }, radius: Math.max(1.5, Math.max(c.width, c.height) / 512 * 1.25) })) });
  }
  const sheet = reference.kind === "calibrated" ? reference : reference.kind === "calibrated-strip" ? reference.sheet : undefined;
  if (!sheet) { calibrationRows.push({ photoIndex: index, sourceFile: photo.sourceFile, calibration: reference.kind, correctedViews: 0 }); console.log(index, reference.kind, "no paper correction"); continue; }
  try {
    const full = photo.frames.full, image = pixels(full), sx = full.width / frame.width, sy = full.height / frame.height;
    const proposal = scalePerspectiveProposal(sheet.perspectiveProposal, sx, sy);
    const aid = reference.kind === "calibrated-strip" ? { ...reference.calibration,
      startX: reference.calibration.startX * sx, startY: reference.calibration.startY * sy,
      endX: reference.calibration.endX * sx, endY: reference.calibration.endY * sy } : undefined;
    const corrected = runPerspectiveCorrection(cv, image, proposal, sheet.template, RECTIFIED_IMAGE_MAX, aid);
    const first = templateMarkerCentersMm(sheet.template)[0];
    const origin = { x: corrected.destination[0].x - first.x * corrected.pxPerMm, y: corrected.destination[0].y - first.y * corrected.pxPerMm };
    const sourcePoints = proposal.correspondences?.source ?? proposal.points;
    const destination = proposal.correspondences ? proposal.correspondences.destinationMm.map(p => ({ x: origin.x + p.x * corrected.pxPerMm, y: origin.y + p.y * corrected.pxPerMm })) : corrected.destination;
    const scope = new MatScope();
    try {
      const src = scope.track(cv.matFromArray(sourcePoints.length, 1, cv.CV_32FC2, sourcePoints.flatMap(p => [p.x, p.y])));
      const dst = scope.track(cv.matFromArray(destination.length, 1, cv.CV_32FC2, destination.flatMap(p => [p.x, p.y])));
      const found = cv.findHomography(src, dst, 0);
      if (!found) throw new Error("Could not map correction selections");
      const matrix = scope.track(found);
      const h = Array.from(matrix.data64F) as number[];
      const project = (p: Point): Point => { const w = h[6] * p.x + h[7] * p.y + h[8]; return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }; };
      const recognized = detect(corrected.imageData);
      for (const c of selections) {
        const toFull = (p: Point): Point => ({ x: p.x * full.width / c.naturalSize[0], y: p.y * full.height / c.naturalSize[1] });
        const [left, top, right, bottom] = c.sourceCrop;
        const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }].map(p => project(toFull(p)));
        const x = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x)))), y = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))));
        const width = Math.min(corrected.width - x, Math.ceil(Math.max(...corners.map(p => p.x))) - x), height = Math.min(corrected.height - y, Math.ceil(Math.max(...corners.map(p => p.y))) - y);
        if (width <= 5 || height <= 5) throw new Error("Correction clipped the selected tool");
        const scale = Math.min(1, 1024 / Math.max(width, height)), target = { width: Math.round(width * scale), height: Math.round(height * scale) };
        const crop = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++) crop.set(corrected.imageData.data.subarray(((y + row) * corrected.width + x) * 4, ((y + row) * corrected.width + x + width) * 4), row * width * 4);
        const cropScope = new MatScope();
        const name = c.name.replace(/-original$/, "-corrected"), path = resolve(output, name + ".rgba");
        try { const input = cropScope.track(cv.matFromImageData({ width, height, data: crop })), resized = cropScope.track(new cv.Mat());
          cv.resize(input, resized, new cv.Size(target.width, target.height), 0, 0, cv.INTER_LINEAR); writeFileSync(path, new Uint8Array(resized.data)); }
        finally { cropScope.dispose(); }
        const local = (p: Point): Point => ({ x: (p.x - x) * target.width / width, y: (p.y - y) * target.height / height });
        const r = recognized.reference;
        const occlusions: Ring[] = r.kind === "calibrated-strip" && r.aidOutline ? [r.aidOutline.map(p => local({ x: p.x * corrected.width / recognized.size.width, y: p.y * corrected.height / recognized.size.height }))] : [];
        const { frames: _frames, ...metadata } = c;
        results.push({ ...metadata, name, path, ...target, photoIndex: index, view: "Paper-corrected crop", tolerancePx: 1.2 * target.width / width,
          mmPerPx: mmPerPixel(corrected.calibration)! * width / target.width, calibrationKind: reference.kind === "calibrated-strip" ? "paper + aid scale" : "paper scale",
          correctedAidRecognition: r.kind, correctedSourceSize: { width: corrected.width, height: corrected.height }, correctedCrop: { x, y, width, height }, sourceToCorrected: h,
          correctionInputSize: { width: full.width, height: full.height }, occlusions,
          probes: c.probes.map(p => ({ ...p, point: local(project(toFull({ x: left + p.point.x * (right - left), y: top + p.point.y * (bottom - top) }))), radius: Math.max(1.5, Math.max(target.width, target.height) / 512 * 1.25) })) });
      }
      calibrationRows.push({ photoIndex: index, sourceFile: photo.sourceFile, calibration: reference.kind, correctedAidRecognition: recognized.reference.kind, correctedViews: selections.length, correctionNotice: corrected.fullPhotoUnavailableReason });
    } finally { scope.dispose(); }
    console.log(index, reference.kind, "corrected", selections.length, "views");
  } catch (error) { calibrationRows.push({ photoIndex: index, sourceFile: photo.sourceFile, calibration: reference.kind, correctedViews: 0, error: String(error) }); console.log(index, "correction failed", String(error)); }
}
writeFileSync(resolve(output, "cases.json"), JSON.stringify(results, null, 2));
writeFileSync(resolve(output, "calibration-coverage.json"), JSON.stringify(calibrationRows, null, 2));
console.log("Prepared", results.length, "views of", calibrationRows.length, "white-sheet photos");
