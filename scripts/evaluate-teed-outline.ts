/** Offline white-sheet evaluation. Arguments: existing cases.json, output dir.
 * Uses application code and the exact bundled model. No uploads or downloads.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectOutline } from "../client/src/lib/detect/pipeline";
import { createTeedDetector, loadTeedModel } from "../client/src/lib/detect/teed";
import { curvesFromOutline, curveControls, evaluateCurve, type CurveOutline } from "../shared/geometry/curves";
import { reconstructDetectedOutline, recommendedReconstructionTolerance, type ReconstructionResult } from "../shared/geometry/contour-reconstruction";
import { generateOutlineSVG } from "../client/src/lib/export/svg";
import { outsideSilhouettes } from "../client/src/lib/geometry/outline";
interface Photo { name: string; path: string; width: number; height: number; group: string; variant?: string }
const cases: Photo[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const initialized = performance.now();
const cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const initializeMs = performance.now() - initialized;
const teed = createTeedDetector(signal => loadTeedModel(signal, async () => new Response(
  new Uint8Array(readFileSync(resolve("client/public/models/teed/teed-512-f1a4f305.onnx"))))));
const timings = new Map<string, { baselineMs: number[]; learnedMs: number[]; cachedMs: number[]; fitMs: number[]; reconstructMs: number[] }>();
const rows: unknown[] = [];
const selected = cases.filter(c => c.group === "original" && !c.name.includes("-mat-"));
try {
  // Traversing the corpus between repeats evicts the single-image cache. Thus
  // learnedMs measures fresh inference, not repeated cached reconstruction.
  for (let round = 0; round < 3; round++) for (const c of selected) {
    const image = { width: c.width, height: c.height, data: new Uint8ClampedArray(readFileSync(c.path)) };
    if (image.data.length !== c.width * c.height * 4) throw new Error("Bad pixels: " + c.name);
    const baselineStarted = performance.now();
    const baseline = await detectOutline(image, { engine: "opencv" }, { loadCV: async () => cv });
    baseline.outline = outsideSilhouettes(baseline.outline);
    const baselineMs = performance.now() - baselineStarted;
    const start = performance.now();
    const result = await detectOutline(image, { engine: "opencv", boundary: "teed" }, { loadCV: async () => cv, teed });
    const elapsed = performance.now() - start;
    result.outline = outsideSilhouettes(result.outline);
    const sourceCurves = curvesFromOutline(result.outline);
    const dense = outsideSilhouettes(result.rawOutline);
    const fitTolerancePx = Math.max(...dense.flatMap(s => [s.outer, ...s.holes]).map(r => recommendedReconstructionTolerance(r)));
    let curves: CurveOutline = sourceCurves, fitError: string | undefined;
    let reconstruction: Omit<ReconstructionResult, "curves"> | undefined;
    const fitStarted = performance.now();
    try {
      const fitted = reconstructDetectedOutline(sourceCurves, dense, fitTolerancePx);
      const { curves: next, ...details } = fitted; curves = next; reconstruction = details;
    } catch (error) { curves = sourceCurves; fitError = String(error); }
    const fitMs = performance.now() - fitStarted;
    const cachedStarted = performance.now();
    const cached = await detectOutline(image, { engine: "opencv", boundary: "teed" }, { loadCV: async () => cv, teed });
    const cachedMs = performance.now() - cachedStarted;
    cached.outline = outsideSilhouettes(cached.outline);
    if (!cached.refinement?.cached || JSON.stringify(cached.outline) !== JSON.stringify(result.outline)) throw new Error("Cache disagreement: " + c.name);
    const samples = timings.get(c.name) ?? { baselineMs: [], learnedMs: [], cachedMs: [], fitMs: [], reconstructMs: [] };
    samples.baselineMs.push(baselineMs); samples.learnedMs.push(elapsed); samples.cachedMs.push(cachedMs); samples.fitMs.push(fitMs);
    timings.set(c.name, samples);
    samples.reconstructMs.push(result.timings.reconstruct ?? 0);
    if (round === 2) {
      const previous = process.argv[4] ? JSON.parse(readFileSync(resolve(process.argv[4], c.name + ".json"), "utf8")) : undefined;
      const previousLearned = previous ? { outline: previous.result.outline, curves: previous.curves,
        samples: previous.samples, fitError: previous.fitError, fitTolerancePx: previous.fitTolerancePx } : undefined;
      writeFileSync(resolve(output, c.name + ".json"), JSON.stringify({ ...c, baseline, result, curves, fitError, previousLearned,
        fitTolerancePx, fitReference: "dense detected boundary", reconstructionSource: dense, reconstruction, elapsedMs: elapsed, fitMs, samples, wasmHeapCapacityBytes: cv.HEAPU8.buffer.byteLength }));
      writeFileSync(resolve(output, c.name + ".svg"), generateOutlineSVG(result.outline,
        { width: c.width, height: c.height, curves, fill: "none", stroke: "#00d4ff", strokeWidth: 1 }));
      const capDiagnostics = c.name.startsWith("airduster-body") && !fitError ? curves.flatMap(s => s.outer.map((a, i, r) => ({
        curved: !!(a.out || r[(i + 1) % r.length].in), smooth: !!a.smooth, point: evaluateCurve(curveControls(r, i), .5),
      }))).filter(s => s.point.y > c.height * .9).map(({ curved, smooth }) => ({ curved, smooth })) : undefined;
      if (capDiagnostics && (!capDiagnostics.length || capDiagnostics.some(s => !s.curved))) throw new Error("Wolfbox bottom was not reconstructed as curves: " + c.name);
      rows.push({ name: c.name, status: result.refinement, elapsedMs: elapsed, samples,
      previousPoints: previousLearned?.outline.reduce((n: number, s: { outer: unknown[] }) => n + s.outer.length, 0),
      polygons: result.outline.length, beforePoints: result.outline.reduce((n, s) => n + s.outer.length, 0),
      afterAnchors: curves.reduce((n, s) => n + s.outer.length, 0), fitError, fitTolerancePx, reconstruction, capDiagnostics });
    }
    console.log("round", round + 1, c.name, result.refinement?.status, Math.round(elapsed) + "ms", fitError ?? "fit ok");
  }
} finally { teed.dispose(); }
writeFileSync(resolve(output, "summary.json"), JSON.stringify({ node: process.version, initializeMs,
  scope: "Mac Node/WASM; three corpus passes evicting the image cache; one cached adjustment per pass; visual evaluation, no ground-truth masks",
  coldFirstRun: { case: selected[0]?.name, ms: timings.get(selected[0]?.name)?.learnedMs[0] }, cases: rows }, null, 2));
