import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { Outline } from "@shared/geometry/types";
import { marginToPixels } from "@/lib/image-processor";
import { offsetDetectedOutline } from "@/lib/geometry/trace-refinement";
import type { TraceAction, TraceState } from "./trace-store";

/** Presentation-only review. Only useOutline commits geometry to history. */
export function useDetectedOutlineReview(state: TraceState, dispatch: Dispatch<TraceAction>) {
  const context = useMemo(() => ({ outline: state.outline, rawOutline: state.rawOutline,
    calibration: state.calibration, margin: state.margin, region: state.region, sourceRevision: state.sourceRevision }),
  [state.outline, state.rawOutline, state.calibration, state.margin, state.sourceRevision, state.region,
    state.history, state.tolerancePx, state.smoothing, state.sensitivity, state.boundaryMethod, state.includeInteriorHoles]);
  const [session, setSession] = useState<{ context: typeof context; preview?: Outline; error?: string } | null>(null);
  const revision = useRef(0);
  const unavailable = !state.rawOutline.length ? "Detect an outline from a photo first."
    : state.processing ? "Wait for detection to finish."
    : state.pendingAutoCalibration || state.draftCalibration || state.mode === "calibrate" || state.mode === "perspective"
      ? "Finish calibration before comparing outlines." : undefined;
  const current = !unavailable && (state.mode === "pan" || state.mode === "navigate") && session?.context === context ? session : null;
  const close = () => { revision.current++; setSession(null); };
  useEffect(() => {
    if (session && !current) close();
  }, [session, current]);
  useEffect(() => {
    if (!current) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [current]);
  useEffect(() => () => { revision.current++; }, []);
  const setShowing = (show: boolean) => {
    close();
    if (!show || unavailable) return;
    dispatch({ type: "SET_MODE", mode: "pan" });
    const request = revision.current;
    const marginPx = marginToPixels(context.margin, context.calibration);
    if (!marginPx) { setSession({ context, preview: context.rawOutline }); return; }
    setSession({ context });
    void offsetDetectedOutline(context.rawOutline, marginPx).then(preview => {
      if (request === revision.current) setSession({ context, preview });
    }).catch(error => {
      if (request === revision.current) setSession({ context, error: error instanceof Error ? error.message : "Could not prepare the detected outline." });
    });
  };
  const unchanged = useMemo(() => !!current?.preview && JSON.stringify(current.preview) === JSON.stringify(state.outline), [current?.preview, state.outline]);
  const pending = !!current && !current.preview && !current.error;
  const hint = current?.error ?? (pending ? "Preparing the detected outline with the current margin…"
    : unchanged ? "The detected outline is already in use."
      : "Replace the current outline and edits with the detected contour. Keep the current margin. Undo restores your outline.");
  return { showing: !!current, preview: current?.preview ?? null, pending, error: current?.error,
    unavailable, unchanged, hint, close, setShowing,
    useOutline: () => {
      if (!current?.preview || unchanged) return;
      dispatch({ type: "USE_DETECTED_OUTLINE", outline: current.preview, expected: context });
      close();
    },
  };
}

export type DetectedOutlineReview = ReturnType<typeof useDetectedOutlineReview>;
