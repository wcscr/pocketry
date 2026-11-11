import { reprojectPhoto, type ReprojectionRequest } from "./reproject";
import type { HandlerContext } from "../worker/host";
import { checkDetectionAbort } from "./grabcut";
import { detectOutline } from "./pipeline";
import type { OpenCV } from "./segment-opencv";
import type { DetectOptions, ImageLike } from "./types";
import { createTeedDetector } from "./teed";
import { reconstructDetectedForEditing } from "@shared/geometry/detected-cleanup";
import { simplifyAcceptedOutline, type OutlineSimplificationRequest } from "@shared/geometry/outline-simplification";
import type { CurveOutline } from "@shared/geometry/curves";
import type { Outline } from "@shared/geometry/types";
import { symmetrizeCurves, type CurveSymmetryRequest } from "../geometry/curve-symmetry";

export interface ReconstructionRequest { source: CurveOutline; dense: Outline; tolerance: number; editableCurves?: boolean }

export interface DetectRequest {
  image: ImageLike;
  options: Omit<DetectOptions, "signal">;
}

/** Serializes WASM work, including calls queued while the runtime is loading. */
export function createDetectionHandlers(loadCV: () => Promise<OpenCV>) {
  let tail: Promise<unknown> = Promise.resolve();
  const teed = createTeedDetector();
  return {
    reproject(payload: ReprojectionRequest, { signal }: HandlerContext) {
      const result = tail.then(() => { checkDetectionAbort(signal); return reprojectPhoto(payload); });
      tail = result.catch(() => undefined);
      return result;
    },
    symmetry(payload: CurveSymmetryRequest, { signal }: HandlerContext) {
      const result = tail.then(() => { checkDetectionAbort(signal); return symmetrizeCurves(payload); });
      tail = result.catch(() => undefined);
      return result;
    },
    reconstruct(payload: ReconstructionRequest, { signal }: HandlerContext) {
      const result = tail.then(() => {
        checkDetectionAbort(signal);
        return reconstructDetectedForEditing(payload.source, payload.dense, payload.tolerance, payload.editableCurves !== false);
      });
      tail = result.catch(() => undefined);
      return result;
    },
    simplify(payload: OutlineSimplificationRequest, { signal }: HandlerContext) {
      const result = tail.then(() => { checkDetectionAbort(signal); return simplifyAcceptedOutline(payload); });
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
