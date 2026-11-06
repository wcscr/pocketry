/** Focused aid evaluation: prepared RGBA cases.json, output directory, optional
 * bundled before-runtime.mjs exporting detectOutline/createTeedDetector. Photos
 * remain local; no corpus discovery or full-library run is performed.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { detectOutline } from "../client/src/lib/detect/pipeline";
import { createTeedDetector } from "../client/src/lib/detect/teed";
import { runAutoCalibration } from "../client/src/lib/calibrate/auto-calibrate";
import { outsideSilhouettes } from "../client/src/lib/geometry/outline";
import { curvesFromOutline } from "../shared/geometry/curves";
import { recommendedReconstructionTolerance, reconstructDetectedOutline } from "../shared/geometry/contour-reconstruction";
import { simplifyDetectedOutline } from "../shared/geometry/contour-simplification";
import { mmPerPixel } from "../shared/geometry/scale";
import type { ImageLike, DetectResult } from "../client/src/lib/detect/types";

interface Frame { path: string; width: number; height: number }
interface Case extends Frame { name: string; source: string; sourceSize: { width: number; height: number }; crop: [number, number, number, number]; frames: Record<string, Frame> }
const cases: Case[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const before: { detectOutline: typeof detectOutline; createTeedDetector: typeof createTeedDetector } = process.argv[4]
  ? await import(pathToFileURL(resolve(process.argv[4])).href) : { detectOutline, createTeedDetector };
const began = performance.now(), cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const initializeMs = performance.now() - began;
const bytes = new Uint8Array(readFileSync(resolve("client/public/models/teed/teed-512-f1a4f305.onnx")));
const oldNet = before.createTeedDetector(async () => bytes), newNet = createTeedDetector(async () => bytes);
const pixels = (f: Frame): ImageLike => ({ width: f.width, height: f.height, data: new Uint8ClampedArray(readFileSync(f.path)) });
const records = cases.map(c => {
  let reference: ReturnType<typeof runAutoCalibration> | undefined, chosen: Frame | undefined;
  for (const limit of [1600, 2400]) {
    chosen = c.frames[limit]; reference = runAutoCalibration(cv, pixels(chosen) as ImageData);
    if (reference.kind === "calibrated-strip" || !(reference.kind === "invalid-strip" || reference.kind === "calibrated" && reference.stripFallbackReason)) break;
  }
  if (!chosen || !reference || !["calibrated", "calibrated-strip"].includes(reference.kind)) throw new Error("Calibration failed: " + c.name);
  const toLocal = (p: { x: number; y: number }) => ({ x: (p.x * c.sourceSize.width / chosen!.width - c.crop[0]) * c.width / (c.crop[2] - c.crop[0]),
    y: (p.y * c.sourceSize.height / chosen!.height - c.crop[1]) * c.height / (c.crop[3] - c.crop[1]) });
  if (reference.kind !== "calibrated" && reference.kind !== "calibrated-strip") throw new Error("No ruler");
  const ruler = reference.calibration, a = toLocal({ x: ruler.startX, y: ruler.startY }), b = toLocal({ x: ruler.endX, y: ruler.endY });
  const calibration = { startX: a.x, startY: a.y, endX: b.x, endY: b.y, lengthMm: ruler.lengthMm };
  return { name: c.name, sourceFile: basename(c.source), sourceSha256: createHash("sha256").update(readFileSync(c.source)).digest("hex"),
    width: c.width, height: c.height, crop: c.crop, sourceSize: c.sourceSize, calibrationKind: reference.kind, calibration,
    mmPerPx: mmPerPixel(calibration)!, occlusions: reference.kind === "calibrated-strip" && reference.aidOutline ? [reference.aidOutline.map(toLocal)] : [],
    samples: { beforeMs: [] as number[], afterMs: [] as number[], cachedMs: [] as number[], pointMs: [] as number[], curveMs: [] as number[], repairMs: [] as number[] },
    before: undefined as DetectResult | undefined, after: undefined as DetectResult | undefined,
    geometry: {} as Record<string, unknown> };
});
try {
  for (let round = 0; round < 3; round++) for (let i = 0; i < cases.length; i++) {
    const c = cases[i], r = records[i], image = pixels(c), options = { engine: "opencv" as const, boundary: "teed" as const, occlusions: r.occlusions };
    // The old runtime skips inference for an aid, so alternating cases alone
    // would leave its no-aid frame cached. Evict with the other prepared photo
    // outside the timed interval, retaining the warm net in both runtimes.
    const other = cases.find(candidate => candidate.name !== c.name);
    if (!r.occlusions.length && other) await before.detectOutline(pixels(other), { engine: "opencv", boundary: "teed" }, { loadCV: async () => cv, teed: oldNet });
    let start = performance.now(); r.before = await before.detectOutline(image, options, { loadCV: async () => cv, teed: oldNet }); r.samples.beforeMs.push(performance.now() - start);
    start = performance.now(); r.after = await detectOutline(image, options, { loadCV: async () => cv, teed: newNet }); r.samples.afterMs.push(performance.now() - start);
    r.samples.repairMs.push(r.after.timings.occlusionRepair ?? 0);
    start = performance.now(); const cached = await detectOutline(image, options, { loadCV: async () => cv, teed: newNet }); r.samples.cachedMs.push(performance.now() - start);
    if (!cached.refinement?.cached || JSON.stringify(cached.outline) !== JSON.stringify(r.after.outline)) throw new Error("Cache mismatch: " + c.name);
    const outline = outsideSilhouettes(r.after.outline), dense = outsideSilhouettes(r.after.rawOutline), source = curvesFromOutline(outline);
    const tolerance = Math.max(...dense.map(s => recommendedReconstructionTolerance(s.outer, r.mmPerPx, "mm")));
    for (const [name, reconstruct] of [["points", simplifyDetectedOutline], ["curves", reconstructDetectedOutline]] as const) {
      start = performance.now();
      try { r.geometry[name] = { ...reconstruct(source, dense, tolerance), tolerance }; }
      catch (error) { r.geometry[name] = { error: String(error), tolerance }; }
      r.samples[name === "points" ? "pointMs" : "curveMs"].push(performance.now() - start);
    }
    if (!r.occlusions.length && JSON.stringify(r.before.outline) !== JSON.stringify(r.after.outline)) throw new Error("No-aid control changed: " + c.name);
    console.log(round + 1, c.name, r.before.refinement?.status, "→", r.after.refinement?.status, Math.round(r.samples.afterMs.at(-1)!) + "ms");
  }
  for (const r of records) writeFileSync(resolve(output, r.name + ".json"), JSON.stringify({ ...r,
    beforeSilhouette: outsideSilhouettes(r.before!.outline), afterSilhouette: outsideSilhouettes(r.after!.outline) }));
  writeFileSync(resolve(output, "summary.json"), JSON.stringify({ scope: "Only the two supplied Craftsman white-sheet photos. Three alternating passes; exact bundled CPU/WASM model. Mac desktop, no phone qualification or physical ground truth.",
    node: process.version, initializeMs, beforeRevision: process.argv[5] ?? (process.argv[4] ? "provided baseline module" : "current"), afterRevision: "local review build", cases: records.map(({ before: _before, after: _after, geometry: _geometry, ...r }) => r) }, null, 2));
} finally { oldNet.dispose(); newNet.dispose(); }
