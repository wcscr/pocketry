import type { Calibration } from "@shared/geometry/scale";

import { loadOpenCV } from "@/lib/opencv";

import {
  detectCalibrationSheet,
  detectReferenceStripMarkers,
  hasArucoSupport,
} from "./detect";
import {
  MAX_TEMPLATE_REPROJECTION_RMS_MM,
  projectMarkersThroughTemplate,
  proposalFromTemplateMarkers,
  templateReprojectionErrorMm,
  type PerspectiveProposal,
} from "./perspective";
import { solveReferenceStrip } from "./solve-reference-strip";
import { referenceStripFromMarkerIds } from "./reference-strip";
import { solveScaleFromMarkers, type ScaleSolution } from "./solve";
import {
  templateFromTemplateMarkerIds,
  templatePaper,
  type TemplatePaper,
  type TemplateVariant,
} from "./template";

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
      kind: "calibrated-strip";
      calibration: Calibration;
      /** For recovered aids this solution uses paper-rectified coordinates. */
      solution: ScaleSolution;
      /** Source endpoints are only a valid scale after the paper correction. */
      requiresPerspectiveCorrection?: true;
      /** A usable paper reference offered alongside the aid. */
      sheet?: Extract<AutoCalibrationResult, { kind: "calibrated" }>;
    }
  | { kind: "invalid-strip"; reason: "incomplete-signature" | "invalid-geometry" }
  | {
      kind: "calibrated";
      /** The aid was present but unusable; paper calibration is the fallback. */
      stripFallbackReason?: "incomplete-signature" | "invalid-geometry";
      calibration: Calibration;
      solution: ScaleSolution;
      /** Paper size encoded by this template's unique marker-id family. */
      paper: TemplatePaper;
      /** Exact stable or experimental sheet encoded by the marker ids. */
      template: TemplateVariant;
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
  const stripMarkers = detectReferenceStripMarkers(cv, image);
  const stripSolution = stripMarkers.length ? solveReferenceStrip(stripMarkers) : null;
  // Evaluate both references so the UI can offer a choice or combine paper
  // perspective with aid scale. An invalid aid must not hide a usable sheet.
  const sheet = runSheetCalibration(cv, image);
  if (stripSolution) {
    return {
      kind: "calibrated-strip",
      solution: stripSolution,
      calibration: {
        startX: stripSolution.ruler.a.x,
        startY: stripSolution.ruler.a.y,
        endX: stripSolution.ruler.b.x,
        endY: stripSolution.ruler.b.y,
        lengthMm: stripSolution.ruler.lengthMm,
      },
      ...(sheet.kind === "calibrated" ? { sheet } : {}),
    };
  }
  if (sheet.kind === "calibrated") {
    const spec = referenceStripFromMarkerIds(stripMarkers.map(({ id }) => id));
    if (spec) {
      const [a, b] = spec.markerIds.map((id) => stripMarkers.find((marker) => marker.id === id)!);
      // Rectification must not turn an under-resolved source into apparently
      // sufficient evidence merely by increasing the output pixel count.
      const baselinePx = Math.hypot(b.centerPx.x - a.centerPx.x, b.centerPx.y - a.centerPx.y);
      const correctedMarkers = baselinePx >= 40
        ? projectMarkersThroughTemplate(cv, stripMarkers, sheet.perspectiveProposal, sheet.template)
        : null;
      const recovered = correctedMarkers
        ? solveReferenceStrip(correctedMarkers, { sourceBaselinePx: baselinePx }) : null;
      if (recovered) {
        return {
          kind: "calibrated-strip",
          requiresPerspectiveCorrection: true,
          solution: recovered,
          // Keep the original detected endpoints for the exact image warp.
          // They must never be accepted as an unrectified scalar calibration.
          calibration: {
            startX: a.centerPx.x, startY: a.centerPx.y,
            endX: b.centerPx.x, endY: b.centerPx.y,
            lengthMm: spec.centerSpacingMm,
          },
          sheet,
        };
      }
    }
  }
  if (!stripMarkers.length) return sheet;
  const reason = stripMarkers.length < 2 ? "incomplete-signature" : "invalid-geometry";
  return sheet.kind === "calibrated"
    ? { ...sheet, stripFallbackReason: reason }
    : { kind: "invalid-strip", reason };
}

function runSheetCalibration(cv: any, image: ImageData): Exclude<AutoCalibrationResult, { kind: "calibrated-strip" | "invalid-strip" | "unsupported" }> {
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

  const template = templateFromTemplateMarkerIds(markerIds);
  if (!template) {
    return {
      kind: "foreign-sheet",
      family: detection.family,
      reason: "incomplete-signature",
      markerIds,
    };
  }
  const paper = templatePaper(template);

  const perspectiveProposal = proposalFromTemplateMarkers(
    detection.markers,
    template,
  );
  const templateReprojectionError = perspectiveProposal
    ? templateReprojectionErrorMm(cv, perspectiveProposal, template)
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

  const solution = solveScaleFromMarkers(detection.markers, template);
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
    template,
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
