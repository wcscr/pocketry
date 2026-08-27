import { useEffect, useRef } from "react";

import type { Calibration } from "@shared/geometry/scale";
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
 * Re-derives the displayed outline only when an outline-shaping control moves.
 *
 * Calibration deliberately is not part of the signature. Setting scale changes
 * how pixels map to millimetres; it must not silently replace a contour the user
 * just approved or edited. It remains an effect dependency so a scale change
 * cancels an older in-flight refinement, but it cannot start a new one.
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
  const refinementSignature = JSON.stringify([tolerancePx, smoothing, margin]);
  const previousRefinementSignature = useRef(refinementSignature);

  useEffect(() => {
    const settingsChanged =
      previousRefinementSignature.current !== refinementSignature;
    previousRefinementSignature.current = refinementSignature;
    // DETECTED already applies the current settings. This guard also protects
    // hand edits across navigation and scale placement.
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
