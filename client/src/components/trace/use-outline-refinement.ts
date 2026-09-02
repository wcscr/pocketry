import { useEffect, useRef } from "react";

import {
  mmPerPixel,
  type Calibration,
} from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";

import {
  marginToPixels,
  reprocessOutline,
  type Margin,
} from "@/lib/image-processor";
import { offsetOutline } from "@/lib/geometry/offset";
import { useTrace } from "@/state/trace-store";

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
  const {
    outline,
    rawOutline,
    tolerancePx,
    smoothing,
    margin,
    calibration,
    dispatch,
  } = useTrace();
  const detectionSignature = JSON.stringify([tolerancePx, smoothing]);
  const scaleMmPerPx = mmPerPixel(calibration);
  const previousDetectionSignature = useRef(detectionSignature);
  const previousScaleMmPerPx = useRef(scaleMmPerPx);

  useEffect(() => {
    const detectionSettingsChanged =
      previousDetectionSignature.current !== detectionSignature;
    const previousMmPerPx = previousScaleMmPerPx.current;
    const scaleChanged = previousMmPerPx !== scaleMmPerPx;
    previousDetectionSignature.current = detectionSignature;
    previousScaleMmPerPx.current = scaleMmPerPx;

    // DETECTED already applies the current settings. Detail and smoothing are
    // intentionally re-derived from the dense detector result. Margin changes,
    // by contrast, are committed directly from the current edited contour in
    // TraceControlsPanel and must never come through this raw-outline path.
    if ((!detectionSettingsChanged && !scaleChanged) || rawOutline.length === 0) {
      return;
    }
    let cancelled = false;

    const refinement = detectionSettingsChanged
      ? refineOutline(rawOutline, {
          detect: { tolerancePx, smoothing },
          margin,
          calibration,
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
      if (!cancelled) dispatch({ type: "OUTLINE_REFINED", outline: refined });
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
    dispatch,
    refineOutline,
    offsetEditedOutline,
  ]);
}
