/** Compare prepared, identical local image views with a frozen pre-Auto runtime.
 * Args: cases.json, output directory, frozen module, [rounds=3].
 * Probe checks are review aids, not annotated contour ground truth.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { detectOutline } from "../client/src/lib/detect/pipeline";
import { createTeedDetector } from "../client/src/lib/detect/teed";
import { outsideSilhouettes } from "../client/src/lib/geometry/outline";
import { auditOutlinePair, type Probe } from "./white-sheet-audit";
import type { Ring } from "../shared/geometry/types";

interface Case { name: string; view: string; path: string; width: number; height: number;
  sourceFile: string; photoIndex: number; role: string; expectedTools: number; mmPerPx?: number;
  occlusions: Ring[]; tolerancePx: number; probes: Probe[] }
type Result = Awaited<ReturnType<typeof detectOutline>>;
const cases: Case[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const baselinePath = resolve(process.argv[4]), rounds = Number(process.argv[5] ?? 3);
const before: { detectOutline: typeof detectOutline; createTeedDetector: typeof createTeedDetector } = await import(pathToFileURL(baselinePath).href);
const started = performance.now(), cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const initializeMs = performance.now() - started;
const modelPath = resolve("client/public/models/teed/teed-512-f1a4f305.onnx");
const bytes = new Uint8Array(readFileSync(modelPath));
const oldNet = before.createTeedDetector(async () => bytes), newNet = createTeedDetector(async () => bytes);
const hash = (data: Uint8Array | Uint8ClampedArray) => createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
const records = cases.map(c => ({ ...c, path: undefined, rgbaSha256: hash(readFileSync(c.path)),
  samples: { beforeMs: [] as number[], afterMs: [] as number[], cachedMs: [] as number[],
    beforeReconstructionMs: [] as number[], reconstructionMs: [] as number[] },
  before: undefined as Result | undefined, after: undefined as Result | undefined,
  error: undefined as string | undefined, audit: undefined as ReturnType<typeof auditOutlinePair> | undefined }));

function save(completedRounds: number) {
  writeFileSync(resolve(output, "summary.json"), JSON.stringify({ scope: "40 named Pocketry-sheet photos; paired original and available app-calibrated views, plus individual crops. CPU/WASM desktop evaluation; no real-phone timing or contour ground truth.",
    completedRounds, requestedRounds: rounds, node: process.version, initializeMs, modelSha256: hash(bytes), beforeBundleSha256: hash(readFileSync(baselinePath)),
    cases: records.map(({ before: a, after: b, ...record }) => ({ ...record, beforeStatus: a?.refinement, afterStatus: b?.refinement })) }, null, 2));
}
try {
  for (let round = 0; round < rounds; round++) for (let i = 0; i < cases.length; i++) {
    const c = cases[i], record = records[i];
    try {
      const data = new Uint8ClampedArray(readFileSync(c.path));
      if (hash(data) !== record.rgbaSha256) throw new Error("Input changed during evaluation");
      const image = { width: c.width, height: c.height, data };
      const options = { engine: "opencv" as const, boundary: "teed" as const, sensitivity: 128,
        occlusions: c.occlusions, tolerancePx: c.tolerancePx, smoothing: 1 };
      let began = performance.now(); const a = await before.detectOutline(image, options, { loadCV: async () => cv, teed: oldNet }); record.samples.beforeMs.push(performance.now() - began);
      began = performance.now(); const b = await detectOutline(image, options, { loadCV: async () => cv, teed: newNet }); record.samples.afterMs.push(performance.now() - began);
      began = performance.now(); const cached = await detectOutline(image, options, { loadCV: async () => cv, teed: newNet }); record.samples.cachedMs.push(performance.now() - began);
      if (!cached.refinement?.cached || JSON.stringify(cached.outline) !== JSON.stringify(b.outline)) throw new Error("Cached output mismatch");
      if (record.after && JSON.stringify(record.after.outline) !== JSON.stringify(b.outline)) throw new Error("Nondeterministic output between passes");
      record.before = a; record.after = b; record.samples.beforeReconstructionMs.push(a.timings.reconstruct ?? 0);
      record.samples.reconstructionMs.push(b.timings.reconstruct ?? 0);
      if (!round) record.audit = auditOutlinePair(c, a, b);
      writeFileSync(resolve(output, c.name + ".json"), JSON.stringify({ ...record, beforeSilhouette: outsideSilhouettes(a.outline), afterSilhouette: outsideSilhouettes(b.outline) }));
      console.log(round + 1, c.name, record.audit?.beforeShapes, "→", record.audit?.afterShapes, b.refinement?.status, b.refinement?.edgeThreshold, b.refinement?.edgeThresholdTrials,
        Math.round(record.samples.afterMs.at(-1)!) + "ms", record.audit?.unchanged ? "unchanged" : "CHANGED");
    } catch (error) { record.error = String(error); console.error("ERROR", c.name, error); }
    save(round + (i === cases.length - 1 ? 1 : 0));
  }
} finally { oldNet.dispose(); newNet.dispose(); }
if (records.some(r => r.error)) process.exitCode = 1;
