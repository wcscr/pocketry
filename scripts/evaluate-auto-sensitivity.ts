/** Prepared local RGBA views only: cases.json, output dir, frozen before module.
 * Multiple views may come from the same photograph; never discovers a corpus.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { detectOutline } from "../client/src/lib/detect/pipeline";
import { createTeedDetector } from "../client/src/lib/detect/teed";
import { outsideSilhouettes } from "../client/src/lib/geometry/outline";
import type { Ring } from "../shared/geometry/types";

interface Case { name: string; view: string; path: string; width: number; height: number; sourceFile: string; mmPerPx: number; occlusions: Ring[] }
const cases: Case[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const baselinePath = resolve(process.argv[4]);
const before: { detectOutline: typeof detectOutline; createTeedDetector: typeof createTeedDetector } = await import(pathToFileURL(baselinePath).href);
const start = performance.now(), cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const initializeMs = performance.now() - start;
const bytes = new Uint8Array(readFileSync(resolve("client/public/models/teed/teed-512-f1a4f305.onnx")));
const oldNet = before.createTeedDetector(async () => bytes), newNet = createTeedDetector(async () => bytes);
const records = cases.map(c => ({ name: c.name, view: c.view, sourceFile: c.sourceFile, width: c.width, height: c.height, mmPerPx: c.mmPerPx,
  occlusions: c.occlusions, rgbaSha256: createHash("sha256").update(readFileSync(c.path)).digest("hex"),
  samples: { beforeMs: [] as number[], afterMs: [] as number[], cachedMs: [] as number[], beforeReconstructionMs: [] as number[], reconstructionMs: [] as number[] },
  before: undefined as Awaited<ReturnType<typeof detectOutline>> | undefined, after: undefined as Awaited<ReturnType<typeof detectOutline>> | undefined }));
try {
  for (let round = 0; round < 3; round++) for (let i = 0; i < cases.length; i++) {
    const c = cases[i], record = records[i], image = { width: c.width, height: c.height, data: new Uint8ClampedArray(readFileSync(c.path)) };
    const options = { engine: "opencv" as const, boundary: "teed" as const, sensitivity: 128, occlusions: c.occlusions };
    let began = performance.now(); record.before = await before.detectOutline(image, options, { loadCV: async () => cv, teed: oldNet }); record.samples.beforeMs.push(performance.now() - began);
    record.samples.beforeReconstructionMs.push(record.before.timings.reconstruct ?? 0);
    began = performance.now(); record.after = await detectOutline(image, options, { loadCV: async () => cv, teed: newNet }); record.samples.afterMs.push(performance.now() - began);
    record.samples.reconstructionMs.push(record.after.timings.reconstruct ?? 0);
    began = performance.now(); const cached = await detectOutline(image, options, { loadCV: async () => cv, teed: newNet }); record.samples.cachedMs.push(performance.now() - began);
    if (!cached.refinement?.cached || JSON.stringify(cached.outline) !== JSON.stringify(record.after.outline)) throw new Error("Cache mismatch: " + c.name);
    if (outsideSilhouettes(record.after.outline).length !== 1) throw new Error("Expected one tool: " + c.name);
    if (c.name.endsWith("original") && JSON.stringify(record.before.outline) !== JSON.stringify(record.after.outline)) throw new Error("Original control changed: " + c.name);
    console.log(round + 1, c.name, outsideSilhouettes(record.before.outline).length, "→", outsideSilhouettes(record.after.outline).length,
      record.after.refinement?.edgeThreshold, record.after.refinement?.edgeThresholdTrials, Math.round(record.samples.afterMs.at(-1)!) + "ms");
  }
  for (const record of records) writeFileSync(resolve(output, record.name + ".json"), JSON.stringify({ ...record,
    beforeSilhouette: outsideSilhouettes(record.before!.outline), afterSilhouette: outsideSilhouettes(record.after!.outline) }));
  writeFileSync(resolve(output, "summary.json"), JSON.stringify({ scope: "Two Craftsman white-sheet photographs; original and exact perspective-corrected browser crops. Three alternating passes on Mac CPU/WASM. No full-corpus or phone qualification.",
    node: process.version, initializeMs, beforeBundleSha256: createHash("sha256").update(readFileSync(baselinePath)).digest("hex"),
    cases: records.map(({ before: original, after, ...record }) => ({ ...record, beforeShapes: outsideSilhouettes(original!.outline).length,
      afterShapes: outsideSilhouettes(after!.outline).length, beforeStatus: original!.refinement, afterStatus: after!.refinement })) }, null, 2));
} finally { oldNet.dispose(); newNet.dispose(); }
