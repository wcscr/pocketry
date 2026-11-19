import type { DetectOptions, EdgeSensitivityReport, ImageLike, ScoreField } from "./types";
import type { OpenCV } from "./segment-opencv";
import { clampRoi } from "./segment-js";
import { checkDetectionAbort } from "./grabcut";
import { MAX_EDGE_SIDE, maskFromEdges, scoreFromEdgeMask } from "./edge-mask";
import { cleanupEdgeMask, type EdgeCleanupReport } from "./edge-cleanup";
import { pointInRing } from "@shared/geometry/rings";
import { reconstructEdges } from "./reconstruct-edges";
import { recoverAcrossScales, preservesSeedSeparation } from "./multiscale-edges";

export const TEED_MODEL_URL = "/models/teed/teed-512-f1a4f305.onnx";
export const TEED_MODEL_SHA256 = "f1a4f305356f9752e1a9af0f43f067ecb93ab4f27c8a5ed7beb9b37970797837";
const MODEL_BYTES = 248782;
const HIGH_DETAIL_URL = "/models/teed/teed-768-b50a01b1.onnx";
const HIGH_DETAIL_SHA256 = "b50a01b1f5cf2b4e345fa62ada8ed5e30370f9aebf7a25312eb118f9fbb8ca3c";

/** Bounded, self-hosted model download. The graph is verified before import. */
export async function loadTeedModel(signal?: AbortSignal, request: typeof fetch = fetch, highDetail = false): Promise<Uint8Array> {
  checkDetectionAbort(signal);
  const response = await request(highDetail ? HIGH_DETAIL_URL : TEED_MODEL_URL, { signal, cache: "force-cache" });
  if (!response.ok || !response.body) throw new Error("Could not load learned-outline model");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      checkDetectionAbort(signal);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MODEL_BYTES) throw new Error("Unexpected learned-outline model size");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  if (length !== MODEL_BYTES) throw new Error("Incomplete learned-outline model");
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("");
  if (hash !== (highDetail ? HIGH_DETAIL_SHA256 : TEED_MODEL_SHA256)) throw new Error("Learned-outline model verification failed");
  checkDetectionAbort(signal);
  return bytes;
}

interface NativeMat { delete(): void; data: Uint8Array; data32F: Float32Array }
interface NativeNet { delete(): void; setInput(blob: NativeMat): void; forward(): NativeMat }
export interface TeedResult { field?: ScoreField; reason?: string; cached?: boolean; reconstructionMs?: number; selection?: EdgeSensitivityReport; cleanup?: EdgeCleanupReport }

/** A worker owns one native net and bounded edge maps keyed by size and interpolation.
 * Native nets are released explicitly by dispose; worker termination also frees
 * its entire WASM heap. Per-inference Mats always leave through finally.
 */
export function createTeedDetector(load: (signal?: AbortSignal, highDetail?: boolean) => Promise<Uint8Array> =
  (signal, highDetail) => loadTeedModel(signal, fetch, highDetail)) {
  let net: NativeNet | undefined;
  let loadedSide = 0;
  const cache = new Map<string, { frame: Uint8Array; edges: Float32Array; width: number; height: number }>();
  const dispose = () => { net?.delete(); net = undefined; cache.clear(); };
  return {
    dispose,
    async segment(cv: OpenCV, image: ImageLike, options: DetectOptions, baseline: ScoreField): Promise<TeedResult> {
      checkDetectionAbort(options.signal);
      if (baseline.alphaUsed) return { reason: "alpha-mask" };
      if (typeof cv.readNetFromONNX !== "function") throw new Error("Learned outlines unavailable in this runtime");
      const side = options.highDetail ? MAX_EDGE_SIDE : 512;
      const handles: NativeMat[] = [];
      const track = (mat: NativeMat): NativeMat => { handles.push(mat); return mat; };
      try {
        const roi = clampRoi(options.roi ?? null, image.width, image.height);
        const scale = side / Math.max(roi.width, roi.height);
        const rgba = track(cv.matFromImageData(image));
        const crop = track((rgba as unknown as { roi(rect: unknown): NativeMat }).roi(new cv.Rect(roi.x, roi.y, roi.width, roi.height)));
        const infer = async (modelSide: number, interpolation: number) => {
          const modelScale = modelSide / Math.max(roi.width, roi.height);
          const w = Math.max(3, Math.round(roi.width * modelScale)), h = Math.max(3, Math.round(roi.height * modelScale));
          const left = Math.floor((modelSide - w) / 2), top = Math.floor((modelSide - h) / 2);
          const small = track(new cv.Mat());
          cv.resize(crop, small, new cv.Size(w, h), 0, 0, interpolation);
          const bgr = track(new cv.Mat()); cv.cvtColor(small, bgr, cv.COLOR_RGBA2BGR);
          const frame = track(new cv.Mat());
          cv.copyMakeBorder(bgr, frame, top, modelSide - h - top, left, modelSide - w - left, cv.BORDER_REPLICATE);
          const key = modelSide + ":" + interpolation, previous = cache.get(key);
          if (previous && previous.width === w && previous.height === h && frame.data.every((v, i) => v === previous.frame[i])) {
            return { edges: previous.edges, width: w, height: h, cached: true };
          }
          if (!net || loadedSide !== modelSide) {
            net?.delete(); net = undefined;
            const bytes = await load(options.signal, modelSide === MAX_EDGE_SIDE);
            checkDetectionAbort(options.signal);
            cv.FS.writeFile("/pocketry-teed.onnx", bytes);
            try { net = cv.readNetFromONNX("/pocketry-teed.onnx") as NativeNet; loadedSide = modelSide; }
            finally { cv.FS.unlink("/pocketry-teed.onnx"); }
          }
          const blob = track(cv.blobFromImage(frame, 1, new cv.Size(modelSide, modelSide), new cv.Scalar(103.939, 116.779, 123.68, 0), false, false));
          checkDetectionAbort(options.signal);
          net.setInput(blob);
          const output = track(net.forward());
          if (output.data32F.length !== modelSide * modelSide) throw new Error("Unexpected learned-outline output");
          const edges = new Float32Array(w * h);
          const padded = output.data32F;
          for (let y = 0; y < h; y++) {
            const start = (y + top) * modelSide + left;
            edges.set(padded.subarray(start, start + w), y * w);
          }
          cache.set(key, { frame: new Uint8Array(frame.data), edges, width: w, height: h });
          return { edges, width: w, height: h, cached: false };
        };
        const initial = await infer(side, cv.INTER_LINEAR);
        const { width, height } = initial;
        let cached = initial.cached, edges = initial.edges;
        checkDetectionAbort(options.signal);
        const seeds = new Uint8Array(edges.length), background = new Uint8Array(edges.length);
        const colour = new Uint8Array(edges.length), unknownMask = new Uint8Array(edges.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const bx = Math.min(baseline.width - 1, Math.floor((x + 0.5) * baseline.width / width));
          const by = Math.min(baseline.height - 1, Math.floor((y + 0.5) * baseline.height / height));
          const unknown = options.occlusions?.some(r => pointInRing(r, { x: roi.x + (x + .5) * roi.width / width, y: roi.y + (y + .5) * roi.height / height }));
          seeds[i] = !unknown && baseline.score[by * baseline.width + bx] >= baseline.iso ? 1 : 0;
          background[i] = !unknown && baseline.evidence && baseline.evidence[by * baseline.width + bx] < baseline.iso * .4 ? 1 : 0;
          colour[i] = baseline.evidence?.[by * baseline.width + bx] ?? 0;
          unknownMask[i] = unknown ? 1 : 0;
        }
        // Sensitivity selects an edge barrier, never an Otsu threshold on edges.
        const threshold = Math.max(0.48, Math.min(0.85, 0.60 + ((options.sensitivity ?? 128) - 128) / 500));
        const reconstructStarted = performance.now();
        const automatic = (options.sensitivity ?? 128) === 128 && !!baseline.evidence;
        const selected = automatic ? reconstructEdges(edges, width, height, seeds, background, unknownMask) : undefined;
        let result = selected?.result ?? maskFromEdges(edges, width, height, seeds, threshold);
        let selection = selected?.selection ?? { edgeThreshold: threshold, edgeThresholdTrials: 1, automaticSensitivity: false,
          seedCoverage: seeds.reduce((sum, value, i) => sum + (value && result.mask[i] ? 1 : 0), 0) / Math.max(1, seeds.reduce((sum, value) => sum + value, 0)) };
        // Keep the model's established sampling and manual sensitivity response.
        // A large original-photo crop can alias weak boundaries when bilinearly
        // shrunk for inference. Retry once with area averaging only after automatic
        // reconstruction misses substantial seeded material. Complete detections
        // never change. The normal polygon topology guard still applies later.
        if (automatic && scale < 1 && selection.seedCoverage < .95 && result.reason !== "selection-too-tight") {
          const initialSelection = selection;
          try {
            const alternate = await infer(side, cv.INTER_AREA);
            cached = cached && alternate.cached;
            const retry = reconstructEdges(alternate.edges, width, height, seeds, background, unknownMask);
            const trials = selection.edgeThresholdTrials + retry.selection.edgeThresholdTrials;
            selection = { ...selection, edgeThresholdTrials: trials, samplingRetry: true };
            if (!retry.result.reason && retry.selection.seedCoverage >= .98 &&
              !seeds.some((value, i) => value && result.mask[i] && !retry.result.mask[i]) &&
              !unknownMask.some((value, i) => value && result.mask[i] !== retry.result.mask[i]) &&
              preservesSeedSeparation(result.mask, retry.result.mask, seeds, width, height)) {
              result = retry.result; edges = alternate.edges;
              selection = { ...retry.selection, edgeThresholdTrials: trials, samplingRetry: true, inputSampling: "area-recovery" };
            }
          } catch (error) {
            checkDetectionAbort(options.signal);
            if (error instanceof Error && error.name === "AbortError") throw error;
            // A failed optional retry cannot discard the usable first result.
            dispose(); cached = false;
            selection = { ...initialSelection, samplingRetry: true };
          }
        }
        if (result.reason) return { reason: result.reason, cached, reconstructionMs: performance.now() - reconstructStarted, selection };
        if (options.highDetail && automatic && selection.seedCoverage < .98) {
          try {
            const coarse = await infer(512, cv.INTER_LINEAR);
            cached = cached && coarse.cached;
            const native = track(cv.matFromArray(coarse.height, coarse.width, cv.CV_32FC1, coarse.edges));
            const aligned = track(new cv.Mat());
            cv.resize(native, aligned, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
            const recovered = recoverAcrossScales(result.mask, edges, aligned.data32F, width, height,
              seeds, background, unknownMask, selection.edgeThreshold);
            if (recovered) {
              result = recovered.result;
              selection = { ...selection, seedCoverage: recovered.seedCoverage, edgeReconstruction: "cross-scale-recovery" };
            }
          } catch (error) {
            checkDetectionAbort(options.signal);
            if (error instanceof Error && error.name === "AbortError") throw error;
            // The independent coarse pass is optional, including on a cold worker.
            dispose(); cached = false;
          }
        }
        const cleaned = baseline.evidence ? cleanupEdgeMask(result.mask, width, height, { colour, iso: baseline.iso, seeds, unknown: unknownMask }) : undefined;
        const score = cleaned && cleaned.mask !== result.mask ? scoreFromEdgeMask(cleaned.mask, width, height) : result.score;
        const reconstructionMs = performance.now() - reconstructStarted;
        return { cached, reconstructionMs, selection, cleanup: cleaned?.report, field: { score, width, height,
          scale: width / roi.width, scaleY: height / roi.height,
          offsetX: roi.x, offsetY: roi.y, iso: 128, otsu: 128 } };
      } catch (error) {
        dispose(); throw error;
      } finally { for (const handle of handles.reverse()) handle.delete(); }
    },
  };
}
export type TeedDetector = ReturnType<typeof createTeedDetector>;
