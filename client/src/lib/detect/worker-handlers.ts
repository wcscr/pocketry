import type { HandlerContext } from "../worker/host";
import { checkDetectionAbort } from "./grabcut";
import { detectOutline } from "./pipeline";
import type { OpenCV } from "./segment-opencv";
import type { DetectOptions, ImageLike } from "./types";

export interface DetectRequest {
  image: ImageLike;
  options: Omit<DetectOptions, "signal">;
}

/** Serializes WASM work, including calls queued while the runtime is loading. */
export function createDetectionHandlers(loadCV: () => Promise<OpenCV>) {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    detect(payload: DetectRequest, { signal }: HandlerContext) {
      const result = tail.then(() => {
        checkDetectionAbort(signal);
        return detectOutline(payload.image, { ...payload.options, signal }, { loadCV });
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
