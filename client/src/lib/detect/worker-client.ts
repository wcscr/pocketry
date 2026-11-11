import type { ReprojectionRequest } from "./reproject";
import { createWorkerClient, type WorkerClient } from "../worker/client";
import { WorkerCancelledError, type MessageEndpoint } from "../worker/protocol";
import type { ReconstructionRequest } from "./worker-handlers";
import type { ReconstructionResult } from "@shared/geometry/contour-reconstruction";
import type { DetectOptions, DetectResult, ImageLike } from "./types";
import type { CurveSymmetryRequest, CurveSymmetryResult } from "../geometry/curve-symmetry";

/** One warm detection worker; superseding/cancelling terminates synchronous WASM. */
export function createDetectionClient(spawn: () => MessageEndpoint) {
  let client: WorkerClient | undefined;
  let active: (() => void) | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  async function invoke<T>(method: string, prepare: () => { payload: unknown; transfer?: Transferable[] }, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new WorkerCancelledError();
    clearTimeout(idleTimer);
    active?.();
    const current = client ??= createWorkerClient(spawn);
    const stop = () => {
      current.dispose();
      if (client === current) client = undefined;
    };
    active = stop;
    signal?.addEventListener("abort", stop, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; stop(); }, 30_000);
    try {
      // Payload preparation can fail too; always detach the listener/timer.
      const { payload, transfer } = prepare();
      return await current.call<T>(method, payload, { signal, transfer, channel: "detect" });
    } catch (error) {
      if (timedOut) throw new Error("Detection took too long. Try a smaller region.");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      if (active === stop) active = undefined;
      // OpenCV's WASM heap cannot shrink. Keep slider/retrace bursts warm,
      // then release the entire idle worker, particularly on mobile Safari.
      if (!active && client === current) idleTimer = setTimeout(stop, 30_000);
    }
  }
  return {
    reproject(payload: ReprojectionRequest, signal?: AbortSignal): Promise<ImageLike> {
      return invoke("reproject", () => ({ payload, transfer: [payload.image.data.buffer] }), signal);
    },
    detect(image: ImageLike, options: DetectOptions = {}): Promise<DetectResult> {
      const { signal, ...wireOptions } = options;
      return invoke("detect", () => {
        // Preserve caller pixels for calibration, editing and retry.
        const data = image.data.slice();
        return { payload: { image: { width: image.width, height: image.height, data }, options: wireOptions }, transfer: [data.buffer] };
      }, signal);
    },
    reconstruct(payload: ReconstructionRequest, signal?: AbortSignal): Promise<ReconstructionResult> {
      return invoke("reconstruct", () => ({ payload }), signal);
    },
    symmetry(payload: CurveSymmetryRequest, signal?: AbortSignal): Promise<CurveSymmetryResult> {
      return invoke("symmetry", () => ({ payload }), signal);
    },
    dispose() {
      clearTimeout(idleTimer);
      client?.dispose();
      client = undefined;
      active = undefined;
    },
  };
}

const detector = createDetectionClient(() =>
  new Worker(new URL("./detect.worker.ts", import.meta.url), { type: "module" }));

export const detectInWorker = detector.detect;

export const reconstructInWorker = detector.reconstruct;
export const symmetryInWorker = detector.symmetry;

export const reprojectInWorker = detector.reproject;
