import { useEffect, useRef } from "react";

import {
  mmPerPixel,
  type Calibration,
} from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";

import {
  reprocessOutline,
  type Margin,
} from "@/lib/image-processor";
import { useTrace } from "@/state/trace-store";

export type OutlineRefiner = (
  rawOutline: Outline,
  options: {
    detect: { tolerancePx: number; smoothing: number };
    margin: Margin;
    calibration: Calibration | null;
  },
) => Promise<Outline>;

/**
 * Re-derives the displayed outline when an outline-shaping control or its
 * physical scale changes. A margin is stored in millimetres, so changing
 * mm/px must recalculate its pixel offset or the visible clearance lies.
 */
export function useOutlineRefinement(
  refineOutline: OutlineRefiner = reprocessOutline,
): void {
  const {
    rawOutline,
    tolerancePx,
    smoothing,
    margin,
    calibration,
    dispatch,
  } = useTrace();
  const refinementSignature = JSON.stringify([
    tolerancePx,
    smoothing,
    margin,
    margin !== null && margin > 0 ? mmPerPixel(calibration) : null,
  ]);
  const previousRefinementSignature = useRef(refinementSignature);

  useEffect(() => {
    const settingsChanged =
      previousRefinementSignature.current !== refinementSignature;
    previousRefinementSignature.current = refinementSignature;
    // DETECTED already applies the current settings. Once a physical margin is
    // visible, however, a scale change is itself an outline-shaping change.
    if (!settingsChanged || rawOutline.length === 0) return;
    let cancelled = false;

    void refineOutline(rawOutline, {
      detect: { tolerancePx, smoothing },
      margin,
      calibration,
    }).then((refined) => {
      if (!cancelled) dispatch({ type: "OUTLINE_REFINED", outline: refined });
    });

    return () => {
      cancelled = true;
    };
  }, [
    rawOutline,
    tolerancePx,
    smoothing,
    margin,
    calibration,
    refinementSignature,
    dispatch,
    refineOutline,
  ]);
}
