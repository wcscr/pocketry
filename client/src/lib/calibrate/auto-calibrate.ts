import type { Calibration } from "@shared/geometry/scale";

import { loadOpenCV } from "@/lib/opencv";

import { detectCalibrationSheet, hasArucoSupport } from "./detect";
import { solveScaleFromMarkers, type ScaleSolution } from "./solve";

/**
 * Detect → solve → Calibration, in one step the UI can act on.
 *
 * The result deliberately distinguishes "no markers at all" from "markers
 * from some other sheet": the first is the common case (most photos have no
 * markers) and stays silent on the automatic path, while the second means
 * the user is clearly *trying* to calibrate and deserves a pointer at the
 * printable template.
 */
export type AutoCalibrationResult =
  | { kind: "calibrated"; calibration: Calibration; solution: ScaleSolution }
  | { kind: "foreign-sheet"; family: string }
  | { kind: "no-markers" }
  | { kind: "unsupported" };

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */

/** Pure composition over an injected cv — what the closed-loop test drives. */
export function runAutoCalibration(cv: any, image: ImageData): AutoCalibrationResult {
  const detection = detectCalibrationSheet(cv, image);
  if (!detection) return { kind: "no-markers" };
  if (!detection.isTemplate) return { kind: "foreign-sheet", family: detection.family };

  const solution = solveScaleFromMarkers(detection.markers);
  // 4x4 markers that aren't the template's ids 0–3 are still a foreign sheet.
  if (!solution) return { kind: "foreign-sheet", family: detection.family };

  return {
    kind: "calibrated",
    // The synthesised ruler joins the longest detected pair — for the full
    // sheet that is a 250 mm diagonal, the geometry least sensitive to
    // per-marker centre noise.
    calibration: {
      startX: solution.ruler.a.x,
      startY: solution.ruler.a.y,
      endX: solution.ruler.b.x,
      endY: solution.ruler.b.y,
      lengthMm: solution.ruler.lengthMm,
    },
    solution,
  };
}

/** Browser entry point: loads the bundled OpenCV build and runs detection. */
export async function autoCalibrate(image: ImageData): Promise<AutoCalibrationResult> {
  let cv: any;
  try {
    cv = await loadOpenCV();
  } catch {
    return { kind: "unsupported" };
  }
  if (!hasArucoSupport(cv)) return { kind: "unsupported" };
  return runAutoCalibration(cv, image);
}
