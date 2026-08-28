import type { Calibration } from "@shared/geometry/scale";

import { loadOpenCV } from "@/lib/opencv";

import { detectCalibrationSheet, hasArucoSupport } from "./detect";
import {
  MAX_TEMPLATE_REPROJECTION_RMS_MM,
  proposalFromTemplateMarkers,
  templateReprojectionErrorMm,
  type PerspectiveProposal,
} from "./perspective";
import { solveScaleFromMarkers, type ScaleSolution } from "./solve";
import { paperFromTemplateMarkerIds, type TemplatePaper } from "./template";

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
  | {
      kind: "calibrated";
      calibration: Calibration;
      solution: ScaleSolution;
      /** Paper size encoded by this template's unique marker-id family. */
      paper: TemplatePaper;
      /** Present only when all four unique template markers can define a homography. */
      perspectiveProposal: PerspectiveProposal;
      /** Sixteen-corner template-fit residual on the physical page plane. */
      templateReprojectionErrorMm: number;
    }
  | {
      kind: "foreign-sheet";
      family: string;
      reason:
        | "different-dictionary"
        | "incomplete-signature"
        | "invalid-geometry";
      markerIds: number[];
    }
  | { kind: "no-markers" }
  | { kind: "unsupported" };

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */

/** Pure composition over an injected cv — what the closed-loop test drives. */
export function runAutoCalibration(cv: any, image: ImageData): AutoCalibrationResult {
  const detection = detectCalibrationSheet(cv, image);
  if (!detection) return { kind: "no-markers" };
  const markerIds = detection.markers
    .map((marker) => marker.id)
    .sort((a, b) => a - b);
  if (!detection.isTemplate) {
    return {
      kind: "foreign-sheet",
      family: detection.family,
      reason: "different-dictionary",
      markerIds,
    };
  }

  const paper = paperFromTemplateMarkerIds(
    markerIds,
  );
  if (!paper) {
    return {
      kind: "foreign-sheet",
      family: detection.family,
      reason: "incomplete-signature",
      markerIds,
    };
  }

  const perspectiveProposal = proposalFromTemplateMarkers(
    detection.markers,
    paper,
  );
  const templateReprojectionError = perspectiveProposal
    ? templateReprojectionErrorMm(cv, perspectiveProposal, paper)
    : null;
  if (
    templateReprojectionError === null ||
    templateReprojectionError > MAX_TEMPLATE_REPROJECTION_RMS_MM
  ) {
    return {
      kind: "foreign-sheet",
      family: detection.family,
      reason: "invalid-geometry",
      markerIds,
    };
  }

  const solution = solveScaleFromMarkers(detection.markers, paper);
  if (!solution || !perspectiveProposal) {
    return {
      kind: "foreign-sheet",
      family: detection.family,
      reason: "invalid-geometry",
      markerIds,
    };
  }

  return {
    kind: "calibrated",
    paper,
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
    perspectiveProposal,
    templateReprojectionErrorMm: templateReprojectionError,
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
