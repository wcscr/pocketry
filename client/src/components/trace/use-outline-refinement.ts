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
import { offsetOutline } from "@/lib/geometry/offset";
import { useTrace } from "@/state/trace-store";
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
  offsetEditedOutline: OutlineOffsetter = offsetOutline,
): void {
  const { toast } = useToast();
  const {
    outline,
    rawOutline,
    tolerancePx,
    smoothing,
    margin,
    calibration,
    imageRotation,
    history,
    dispatch,
  } = useTrace();
  const detectionSignature = JSON.stringify([tolerancePx, smoothing]);
  const scaleMmPerPx = mmPerPixel(calibration);
  const previousDetectionSignature = useRef(detectionSignature);
  const previousScaleMmPerPx = useRef(scaleMmPerPx);
  const previousImageRotation = useRef(imageRotation);
  const entry = history.stack[history.index];

  useEffect(() => {
    const detectionSettingsChanged =
      previousDetectionSignature.current !== detectionSignature;
    const previousMmPerPx = previousScaleMmPerPx.current;
    const scaleChanged = previousMmPerPx !== scaleMmPerPx;
    const imageRotated = previousImageRotation.current !== imageRotation;
    previousDetectionSignature.current = detectionSignature;
    previousScaleMmPerPx.current = scaleMmPerPx;
    previousImageRotation.current = imageRotation;

    // ROTATE_SOURCE already transforms the margin-bearing edited outline and
    // its calibration into the new pixel scale atomically. Applying the usual
    // scale-change offset again would double-adjust the physical margin.
    if (imageRotated) return;

    // Undo restores both the exact contour and its controls. Do not refine an
    // already-restored snapshot a second time.
    if (detectionSettingsChanged && !scaleChanged &&
        entry?.tolerancePx === tolerancePx && entry?.smoothing === smoothing) return;

    // Detection supplies a dense baseline; a manual edit replaces that base.
    // Margin changes are committed directly by TraceControlsPanel.
    if ((!detectionSettingsChanged && !scaleChanged) || rawOutline.length === 0) {
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
      : (() => {
          const previousMarginPx =
            margin !== null && margin > 0 && previousMmPerPx !== null
              ? margin / previousMmPerPx
              : 0;
          const nextMarginPx = marginToPixels(margin, calibration);
          const deltaPx = nextMarginPx - previousMarginPx;
          return deltaPx === 0
            ? Promise.resolve(outline)
            : offsetEditedOutline(outline, deltaPx);
        })();

    void refinement.then((refined) => {
      if (!cancelled) {
        dispatch({
          type: "OUTLINE_REFINED",
          outline: withoutNewInteriorHoles(refined, outline),
        });
      }
    }).catch(() => {
      if (!cancelled) toast({ title: "Could not refine outline", description: "Your current contour has been kept. Try a smaller adjustment.", variant: "destructive" });
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
    detectionSignature,
    scaleMmPerPx,
    imageRotation,
    dispatch,
    entry,
    refineOutline,
    offsetEditedOutline,
    toast,
  ]);
}
