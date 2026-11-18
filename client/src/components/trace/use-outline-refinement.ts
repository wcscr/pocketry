import { useEffect, useRef } from "react";

import {
  mmPerPixel,
  type Calibration,
} from "@shared/geometry/scale";
import { CURVE_TOLERANCE_MM, curvesFromOutline, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import { reconstructDetectedForEditing } from "@shared/geometry/detected-cleanup";
import { reconstructInWorker } from "@/lib/detect/worker-client";
import type { Outline } from "@shared/geometry/types";

import {
  marginToPixels,
  reprocessOutline,
  withoutNewInteriorHoles,
  type Margin,
} from "@/lib/image-processor";
import { offsetTraceOutline } from "@/lib/geometry/trace-refinement";
import { useTrace, type TraceRefinementSettings } from "@/state/trace-store";
import { useToast } from "@/hooks/use-toast";

export type OutlineRefiner = (
  rawOutline: Outline,
  options: {
    detect: { tolerancePx: number; smoothing: number };
    margin: Margin;
    calibration: Calibration | null;
  },
) => Promise<Outline>;

export type OutlineOffsetter = (
  outline: Outline,
  deltaPx: number,
) => Promise<Outline>;

/** Fit native spans against a sample of the edited curve. Sampling and fitting share the requested error budget. */
async function refineCurveDetail(source: CurveOutline, tolerancePx: number, sampleTolerance: number, signal: AbortSignal) {
  const samplingError = Math.min(sampleTolerance, tolerancePx / 8);
  const dense = sampleCurves(source, samplingError);
  const request = { source: curvesFromOutline(dense), dense, tolerance: tolerancePx - samplingError, editableCurves: true };
  const result = typeof Worker === "undefined" ? reconstructDetectedForEditing(request.source, dense, request.tolerance)
    : await reconstructInWorker(request, signal);
  const count = (curves: CurveOutline) => curves.reduce((n, shape) => n + shape.outer.length + shape.holes.reduce((m, hole) => m + hole.length, 0), 0);
  return result.after < count(source) ? result.curves : source;
}

/**
 * Re-derives the displayed outline when an outline-shaping control or its
 * physical scale changes. A margin is stored in millimetres, so changing
 * mm/px must recalculate its pixel offset or the visible clearance lies.
 */
export function useOutlineRefinement(
  refineOutline: OutlineRefiner = reprocessOutline,
  offsetEditedOutline: OutlineOffsetter = offsetTraceOutline,
): void {
  const { toast } = useToast();
  const {
    outline,
    rawOutline,
    tolerancePx,
    smoothing,
    margin,
    calibration,
    calibrationSource,
    rulerLengthMm,
    imageRotation,
    sourceRevision,
    history,
    curves,
    processing,
    dispatch,
  } = useTrace();
  const settings: TraceRefinementSettings = { tolerancePx, smoothing, margin, calibration,
    calibrationSource, rulerLengthMm, rulerLengthInput: String(rulerLengthMm) };
  const applied = useRef(settings);
  const previousOutline = useRef(outline);
  const previousImageRotation = useRef(imageRotation);
  const previousSourceRevision = useRef(sourceRevision);
  const entry = history.stack[history.index];

  useEffect(() => {
    // A fresh detection owns its geometry and controls as one transaction.
    // Cancel an older refinement rather than racing it against the new result.
    if (processing) return;
    const outlineChanged = previousOutline.current !== outline;
    const imageRotated = previousImageRotation.current !== imageRotation;
    const sourceReplaced = previousSourceRevision.current !== sourceRevision;
    previousOutline.current = outline;
    previousImageRotation.current = imageRotation;
    previousSourceRevision.current = sourceRevision;

    // A committed edit, undo or recovered/photo-transformed source already
    // supplies its geometry and controls together. It becomes the new baseline.
    if (outlineChanged || sourceReplaced || imageRotated || (!curves && rawOutline.length === 0 && !entry?.refinementBase?.length)) {
      applied.current = settings;
      return;
    }
    const previous = applied.current;
    const detectionSettingsChanged = previous.tolerancePx !== tolerancePx || previous.smoothing !== smoothing;
    const scaleChanged = mmPerPixel(previous.calibration) !== mmPerPixel(calibration);

    // Undo can restore the same outline reference with different controls.
    if (detectionSettingsChanged && !scaleChanged &&
        entry?.tolerancePx === tolerancePx && entry?.smoothing === smoothing) {
      applied.current = settings;
      return;
    }

    // Detection supplies a dense baseline; a manual edit replaces that base.
    // Margin changes are committed directly by TraceControlsPanel.
    const scaleMarginDeltaPx = marginToPixels(margin, calibration) - marginToPixels(previous.margin, previous.calibration);
    // A new scale with no effective margin change does not change geometry or
    // deserve an undo step, including for a manually started contour.
    if (!detectionSettingsChanged && (!scaleChanged || scaleMarginDeltaPx === 0)) {
      applied.current = settings;
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      if (curves) {
        const refined = await refineCurveDetail(entry?.curveRefinementBase ?? curves, tolerancePx,
          CURVE_TOLERANCE_MM / (mmPerPixel(calibration) ?? .1), controller.signal);
        if (!cancelled) {
          applied.current = settings;
          dispatch({ type: "CURVES_REFINED", curves: refined, expectedCurves: curves, tolerancePx });
        }
        return;
      }
      let refined: Outline;
      if (detectionSettingsChanged) {
        refined = await refineOutline(entry?.refinementBase ?? rawOutline, {
          detect: { tolerancePx, smoothing }, margin: null, calibration,
        });
        const deltaPx = marginToPixels(margin, calibration) - (entry?.baselineMarginPx ?? 0);
        if (deltaPx !== 0) refined = await offsetEditedOutline(refined, deltaPx);
      } else {
        refined = await offsetEditedOutline(outline, scaleMarginDeltaPx);
      }
      if (!cancelled) {
        applied.current = settings;
        dispatch({ type: "OUTLINE_REFINED", outline: withoutNewInteriorHoles(refined, outline) });
      }
    };
    void run().catch(() => {
      if (cancelled) return;
      dispatch({ type: "REFINEMENT_REJECTED", expectedOutline: outline, expectedSourceRevision: sourceRevision,
        expected: { tolerancePx, smoothing, margin, calibration }, settings: previous });
      toast({ title: scaleChanged ? "Could not apply the new scale" : "Could not refine outline",
        description: scaleChanged
          ? "The previous scale, margin and contour have been kept. Reduce the margin before changing scale."
          : "The previous detail, smoothing and contour have been kept. Try a smaller adjustment.",
        variant: "destructive" });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    rawOutline,
    curves,
    processing,
    outline,
    tolerancePx,
    smoothing,
    margin,
    calibration,
    calibrationSource,
    rulerLengthMm,
    imageRotation,
    sourceRevision,
    dispatch,
    entry,
    refineOutline,
    offsetEditedOutline,
    toast,
  ]);
}
