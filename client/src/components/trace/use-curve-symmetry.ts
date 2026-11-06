import { useEffect, useState } from "react";
import { symmetrizeCurves, type CurveSymmetryRequest, type CurveSymmetryResult } from "@/lib/geometry/curve-symmetry";
import { symmetryInWorker } from "@/lib/detect/worker-client";

/** Axis gestures invalidate old results immediately. Curve work runs off the UI
 * thread; a short debounce avoids starting work for every pointer movement. */
export function useCurveSymmetry(request: CurveSymmetryRequest | undefined) {
  const key = request && JSON.stringify([request.shapeIndex, request.axis, request.side, request.tolerance]);
  const source = request?.source;
  const [preview, setPreview] = useState<{ key: string; source: typeof source; result?: CurveSymmetryResult; error?: string }>();
  useEffect(() => {
    if (!request || !key) { setPreview(undefined); return; }
    const controller = new AbortController();
    const run = async () => {
      try {
        const result = typeof Worker === "undefined" ? symmetrizeCurves(request) : await symmetryInWorker(request, controller.signal);
        if (!controller.signal.aborted) setPreview({ key, source, result });
      } catch (cause) {
        if (!controller.signal.aborted) setPreview({ key, source, error: cause instanceof Error ? cause.message : "Could not preview symmetry." });
      }
    };
    const timer = typeof Worker === "undefined" ? undefined : setTimeout(() => void run(), 75);
    if (timer === undefined) void run();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, source]);
  const current = preview && preview.key === key && preview.source === source ? preview : undefined;
  return { result: current?.result, error: current?.error, pending: !!request && !current };
}
