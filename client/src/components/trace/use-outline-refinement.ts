import { useEffect, useRef } from "react";

import {
  mmPerPixel,
  type Calibration,
} from "@shared/geometry/scale";
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
    const outlineChanged = previousOutline.current !== outline;
    const imageRotated = previousImageRotation.current !== imageRotation;
    const sourceReplaced = previousSourceRevision.current !== sourceRevision;
    previousOutline.current = outline;
    previousImageRotation.current = imageRotation;
    previousSourceRevision.current = sourceRevision;

    // A committed edit, undo or recovered/photo-transformed source already
    // supplies its geometry and controls together. It becomes the new baseline.
    if (outlineChanged || sourceReplaced || imageRotated || (rawOutline.length === 0 && !entry?.refinementBase?.length)) {
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

    const refinement = detectionSettingsChanged
      ? refineOutline(entry?.refinementBase ?? rawOutline, {
          detect: { tolerancePx, smoothing },
          margin: null,
          calibration,
        }).then((refined) => {
          const deltaPx = marginToPixels(margin, calibration) - (entry?.baselineMarginPx ?? 0);
          return deltaPx === 0 ? refined : offsetEditedOutline(refined, deltaPx);
        })
      : offsetEditedOutline(outline, scaleMarginDeltaPx);

    void refinement.then((refined) => {
      if (!cancelled) {
        applied.current = settings;
        dispatch({
          type: "OUTLINE_REFINED",
          outline: withoutNewInteriorHoles(refined, outline),
        });
      }
    }).catch(() => {
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
    };
  }, [
    rawOutline,
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
