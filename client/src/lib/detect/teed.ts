import type { DetectOptions, ImageLike, ScoreField } from "./types";
import type { OpenCV } from "./segment-opencv";
import { clampRoi } from "./segment-js";
import { checkDetectionAbort } from "./grabcut";
import { maskFromEdges } from "./edge-mask";

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
export interface TeedResult { field?: ScoreField; reason?: string; cached?: boolean; reconstructionMs?: number }

/** A worker owns one warm net and one bounded image embedding (edge map) cache.
 * Native nets are released explicitly by dispose; worker termination also frees
 * its entire WASM heap. Per-inference Mats always leave through finally.
 */
export function createTeedDetector(load: (signal?: AbortSignal) => Promise<Uint8Array> = loadTeedModel) {
  let net: NativeNet | undefined;
  let lastFrame: Uint8Array | undefined, lastEdges: Float32Array | undefined;
  const dispose = () => { net?.delete(); net = undefined; lastFrame = undefined; lastEdges = undefined; };
  return {
    dispose,
    async segment(cv: OpenCV, image: ImageLike, options: DetectOptions, baseline: ScoreField): Promise<TeedResult> {
      checkDetectionAbort(options.signal);
      if (baseline.alphaUsed) return { reason: "alpha-mask" };
      if (options.occlusions?.length) return { reason: "occluded-boundary" };
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
        const small = track(new cv.Mat());
        cv.resize(crop, small, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
        const bgr = track(new cv.Mat()); cv.cvtColor(small, bgr, cv.COLOR_RGBA2BGR);
        const frame = track(new cv.Mat());
        cv.copyMakeBorder(bgr, frame, top, SIDE - height - top, left, SIDE - width - left, cv.BORDER_REPLICATE);
        const cached = !!lastFrame && lastFrame.length === frame.data.length && frame.data.every((v, i) => v === lastFrame![i]);
        if (!cached || !lastEdges) {
          const blob = track(cv.blobFromImage(frame, 1, new cv.Size(SIDE, SIDE), new cv.Scalar(103.939, 116.779, 123.68, 0), false, false));
          checkDetectionAbort(options.signal);
          net.setInput(blob);
          const output = track(net.forward());
          if (output.data32F.length !== SIDE * SIDE) throw new Error("Unexpected learned-outline output");
          lastEdges = new Float32Array(output.data32F);
          lastFrame = new Uint8Array(frame.data);
        }
        checkDetectionAbort(options.signal);
        const edges = new Float32Array(width * height), seeds = new Uint8Array(edges.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x;
          edges[i] = lastEdges[(y + top) * SIDE + x + left];
          const bx = Math.min(baseline.width - 1, Math.floor((x + 0.5) * baseline.width / width));
          const by = Math.min(baseline.height - 1, Math.floor((y + 0.5) * baseline.height / height));
          seeds[i] = baseline.score[by * baseline.width + bx] >= baseline.iso ? 1 : 0;
        }
        // Sensitivity selects an edge barrier, never an Otsu threshold on edges.
        const threshold = Math.max(0.48, Math.min(0.85, 0.60 + ((options.sensitivity ?? 128) - 128) / 500));
        const reconstructStarted = performance.now();
        const result = maskFromEdges(edges, width, height, seeds, threshold);
        const reconstructionMs = performance.now() - reconstructStarted;
        if (result.reason) return { reason: result.reason, cached, reconstructionMs };
        return { cached, reconstructionMs, field: { score: result.score, width, height,
          scale: width / roi.width, scaleY: height / roi.height,
          offsetX: roi.x, offsetY: roi.y, iso: 128, otsu: 128 } };
      } catch (error) {
        dispose(); throw error;
      } finally { for (const handle of handles.reverse()) handle.delete(); }
    },
  };
}
export type TeedDetector = ReturnType<typeof createTeedDetector>;
