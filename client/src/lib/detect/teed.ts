import type { DetectOptions, EdgeSensitivityReport, ImageLike, ScoreField } from "./types";
import type { OpenCV } from "./segment-opencv";
import { clampRoi } from "./segment-js";
import { checkDetectionAbort } from "./grabcut";
import { labelMaskComponents, maskFromEdges, scoreFromEdgeMask } from "./edge-mask";
import { cleanupEdgeMask, type EdgeCleanupReport } from "./edge-cleanup";
import { pointInRing } from "@shared/geometry/rings";
import { reconstructEdges } from "./reconstruct-edges";

export const TEED_MODEL_URL = "/models/teed/teed-512-f1a4f305.onnx";
export const TEED_MODEL_SHA256 = "f1a4f305356f9752e1a9af0f43f067ecb93ab4f27c8a5ed7beb9b37970797837";
const MODEL_BYTES = 248782, SIDE = 512;

/** Bounded, self-hosted model download. The graph is verified before import. */
export async function loadTeedModel(signal?: AbortSignal, request: typeof fetch = fetch): Promise<Uint8Array> {
  checkDetectionAbort(signal);
  const response = await request(TEED_MODEL_URL, { signal, cache: "force-cache" });
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
  if (hash !== TEED_MODEL_SHA256) throw new Error("Learned-outline model verification failed");
  checkDetectionAbort(signal);
  return bytes;
}

interface NativeMat { delete(): void; data: Uint8Array; data32F: Float32Array }
interface NativeNet { delete(): void; setInput(blob: NativeMat): void; forward(): NativeMat }
export interface TeedResult { field?: ScoreField; reason?: string; cached?: boolean; reconstructionMs?: number; selection?: EdgeSensitivityReport; cleanup?: EdgeCleanupReport }

/** A retry may join fragments of an already-associated object, but must not
 * bridge independent seeded objects that the primary result kept separate. */
function preservesSeedSeparation(primary: Uint8Array, candidate: Uint8Array, seeds: Uint8Array, width: number, height: number): boolean {
  const source = labelMaskComponents(seeds, width, height, 4);
  const parents = Int32Array.from(source.sizes, (_, i) => i);
  const minimum = Math.max(16, seeds.reduce((sum, value) => sum + (value ? 1 : 0), 0) * .001);
  const root = (id: number): number => {
    while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; }
    return id;
  };
  const associations = (mask: Uint8Array) => {
    const parts = labelMaskComponents(mask, width, height, 4), sets = parts.sizes.map(() => new Set<number>());
    for (let i = 0; i < mask.length; i++) if (parts.labels[i] && source.labels[i] && source.sizes[source.labels[i]] >= minimum) {
      sets[parts.labels[i]].add(source.labels[i]);
    }
    return sets;
  };
  for (const set of associations(primary)) {
    const ids = [...set]; for (const id of ids.slice(1)) parents[root(id)] = root(ids[0]);
  }
  return associations(candidate).every(set => new Set([...set].map(root)).size <= 1);
}

/** A worker owns one warm net and two bounded image embeddings (edge map cache).
 * Native nets are released explicitly by dispose; worker termination also frees
 * its entire WASM heap. Per-inference Mats always leave through finally.
 */
export function createTeedDetector(load: (signal?: AbortSignal) => Promise<Uint8Array> = loadTeedModel) {
  let net: NativeNet | undefined;
  const cache = new Map<number, { frame: Uint8Array; edges: Float32Array }>();
  const dispose = () => { net?.delete(); net = undefined; cache.clear(); };
  return {
    dispose,
    async segment(cv: OpenCV, image: ImageLike, options: DetectOptions, baseline: ScoreField): Promise<TeedResult> {
      checkDetectionAbort(options.signal);
      if (baseline.alphaUsed) return { reason: "alpha-mask" };
      if (typeof cv.readNetFromONNX !== "function") throw new Error("Learned outlines unavailable in this runtime");
      if (!net) {
        const bytes = await load(options.signal);
        checkDetectionAbort(options.signal);
        cv.FS.writeFile("/pocketry-teed.onnx", bytes);
        try { net = cv.readNetFromONNX("/pocketry-teed.onnx") as NativeNet; }
        finally { cv.FS.unlink("/pocketry-teed.onnx"); }
      }
      const handles: NativeMat[] = [];
      const track = (mat: NativeMat): NativeMat => { handles.push(mat); return mat; };
      try {
        const roi = clampRoi(options.roi ?? null, image.width, image.height);
        const scale = SIDE / Math.max(roi.width, roi.height);
        const width = Math.max(3, Math.round(roi.width * scale)), height = Math.max(3, Math.round(roi.height * scale));
        const left = Math.floor((SIDE - width) / 2), top = Math.floor((SIDE - height) / 2);
        const rgba = track(cv.matFromImageData(image));
        const crop = track((rgba as unknown as { roi(rect: unknown): NativeMat }).roi(new cv.Rect(roi.x, roi.y, roi.width, roi.height)));
        const infer = (interpolation: number): { edges: Float32Array; cached: boolean } => {
          const small = track(new cv.Mat());
          cv.resize(crop, small, new cv.Size(width, height), 0, 0, interpolation);
          const bgr = track(new cv.Mat()); cv.cvtColor(small, bgr, cv.COLOR_RGBA2BGR);
          const frame = track(new cv.Mat());
          cv.copyMakeBorder(bgr, frame, top, SIDE - height - top, left, SIDE - width - left, cv.BORDER_REPLICATE);
          const previous = cache.get(interpolation);
          if (previous && previous.frame.length === frame.data.length && frame.data.every((v, i) => v === previous.frame[i])) {
            return { edges: previous.edges, cached: true };
          }
          const blob = track(cv.blobFromImage(frame, 1, new cv.Size(SIDE, SIDE), new cv.Scalar(103.939, 116.779, 123.68, 0), false, false));
          checkDetectionAbort(options.signal);
          net!.setInput(blob);
          const output = track(net!.forward());
          if (output.data32F.length !== SIDE * SIDE) throw new Error("Unexpected learned-outline output");
          const edges = new Float32Array(output.data32F);
          cache.set(interpolation, { frame: new Uint8Array(frame.data), edges });
          return { edges, cached: false };
        };
        const initial = infer(cv.INTER_LINEAR);
        let cached = initial.cached;
        const lastEdges = initial.edges;
        checkDetectionAbort(options.signal);
        const edges = new Float32Array(width * height), seeds = new Uint8Array(edges.length), background = new Uint8Array(edges.length);
        const colour = new Uint8Array(edges.length), unknownMask = new Uint8Array(edges.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x;
          edges[i] = lastEdges[(y + top) * SIDE + x + left];
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
        // shrunk to 512px. Retry once with area averaging only after automatic
        // reconstruction misses substantial seeded material. Complete detections
        // never change. The normal polygon topology guard still applies later.
        if (automatic && scale < 1 && selection.seedCoverage < .95 && result.reason !== "selection-too-tight") {
          const initialSelection = selection;
          try {
            const alternate = infer(cv.INTER_AREA), averaged = new Float32Array(edges.length);
            cached = cached && alternate.cached;
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
              averaged[y * width + x] = alternate.edges[(y + top) * SIDE + x + left];
            }
            const retry = reconstructEdges(averaged, width, height, seeds, background, unknownMask);
            const trials = selection.edgeThresholdTrials + retry.selection.edgeThresholdTrials;
            selection = { ...selection, edgeThresholdTrials: trials, samplingRetry: true };
            if (!retry.result.reason && retry.selection.seedCoverage >= .98 &&
              !seeds.some((value, i) => value && result.mask[i] && !retry.result.mask[i]) &&
              !unknownMask.some((value, i) => value && result.mask[i] !== retry.result.mask[i]) &&
              preservesSeedSeparation(result.mask, retry.result.mask, seeds, width, height)) {
              result = retry.result;
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
