import type { HandlerContext } from "../worker/host";
import { checkDetectionAbort } from "./grabcut";
import { detectOutline } from "./pipeline";
import type { OpenCV } from "./segment-opencv";
import type { DetectOptions, ImageLike } from "./types";
import { createTeedDetector } from "./teed";
import { reconstructDetectedOutline } from "@shared/geometry/contour-reconstruction";
import type { CurveOutline } from "@shared/geometry/curves";
import type { Outline } from "@shared/geometry/types";

export interface ReconstructionRequest { source: CurveOutline; dense: Outline; tolerance: number }

export interface DetectRequest {
  image: ImageLike;
  options: Omit<DetectOptions, "signal">;
}

/** Serializes WASM work, including calls queued while the runtime is loading. */
export function createDetectionHandlers(loadCV: () => Promise<OpenCV>) {
  let tail: Promise<unknown> = Promise.resolve();
  const teed = createTeedDetector();
  return {
    reconstruct(payload: ReconstructionRequest, { signal }: HandlerContext) {
      const result = tail.then(() => {
        checkDetectionAbort(signal);
        return reconstructDetectedOutline(payload.source, payload.dense, payload.tolerance);
      });
      tail = result.catch(() => undefined);
      return result;
    },
    detect(payload: DetectRequest, { signal }: HandlerContext) {
      const result = tail.then(() => {
        checkDetectionAbort(signal);
        return detectOutline(payload.image, { ...payload.options, signal }, { loadCV, teed });
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
