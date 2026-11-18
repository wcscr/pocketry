import type { Calibration } from "@shared/geometry/scale";
import type { Ring } from "@shared/geometry/types";
import { aidFootprint } from "./aid-footprint";

import { loadOpenCV } from "@/lib/opencv";

import {
  detectCalibrationSheet,
  detectPocketryTemplateMarkers,
  detectReferenceStripMarkers,
  detectStreakedTemplateMarkers,
  hasArucoSupport,
  TEMPLATE_DICTIONARY,
  type ArucoDetection,
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
import { solveScaleFromMarkers, type DetectedMarker, type ScaleSolution } from "./solve";
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
      /** Recognized carrier in source pixels, independent of the chosen scale. */
      aidOutline?: Ring;
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
  // Evaluate both references so the UI can offer a choice or combine paper
  // perspective with aid scale. An invalid aid must not hide a usable sheet.
  const sheet = runSheetCalibration(cv, image);
  const strip = calibrateStrip(cv, stripMarkers, sheet);
  if (strip) return strip;

  const spec = referenceStripFromMarkerIds(stripMarkers.map(({ id }) => id));
  if (spec && typeof cv.CORNER_REFINE_CONTOUR === "number") {
    // Small damaged/aliased corners can pull SUBPIX into the marker border.
    // Fit the outer contour instead, but only for the same unambiguous pair;
    // a different pass must never hide duplicates, mixed IDs or multiple aids.
    const contourMarkers = detectReferenceStripMarkers(cv, image, "contour");
    if (referenceStripFromMarkerIds(contourMarkers.map(({ id }) => id)) === spec) {
      const recovered = calibrateStrip(cv, contourMarkers, sheet);
      if (recovered) return recovered;
    }
  }
  if (!stripMarkers.length) return sheet;
  const reason = stripMarkers.length < 2 ? "incomplete-signature" : "invalid-geometry";
  return sheet.kind === "calibrated"
    ? { ...sheet, stripFallbackReason: reason }
    : { kind: "invalid-strip", reason };
}

/** Apply identical geometry checks to either corner estimator. */
function calibrateStrip(
  cv: any,
  stripMarkers: DetectedMarker[],
  sheet: ReturnType<typeof runSheetCalibration>,
): Extract<AutoCalibrationResult, { kind: "calibrated-strip" }> | null {
  const stripSolution = stripMarkers.length ? solveReferenceStrip(stripMarkers) : null;
  if (stripSolution) {
    return {
      kind: "calibrated-strip",
      aidOutline: aidFootprint(cv, stripMarkers) ?? undefined,
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
          aidOutline: aidFootprint(cv, stripMarkers) ?? undefined,
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
  return null;
}

type SheetCalibrationResult = Exclude<
  AutoCalibrationResult,
  { kind: "calibrated-strip" | "invalid-strip" | "unsupported" }
>;

/**
 * Paper-sheet calibration, with one second look for a streaked print.
 *
 * Thin light print streaks across the markers can hide one or put an edge in
 * the wrong place, so a sheet that is plainly in the photo fails as incomplete
 * or as the wrong geometry. When the first pass saw at least one Pocketry
 * marker but no valid sheet, detection runs once more with those streaks
 * filled. The second result replaces the first only if it is a complete sheet
 * that passes the same geometry checks; otherwise the first verdict stands.
 * Photos without any Pocketry marker, the common case, never pay for it.
 *
 * The second look may add markers and move corners. It must never hide what
 * the first pass saw: filling light lines can also join a marker to a dark
 * shape beside it, and a marker that disappears that way could take an
 * ambiguity with it. So a repeated id in the first pass is final, and every
 * first-pass marker has to be found again where it was.
 */
function runSheetCalibration(cv: any, image: ImageData): SheetCalibrationResult {
  const firstPass = detectPocketryTemplateMarkers(cv, image);
  const direct = calibrateDetectedSheet(
    cv,
    detectCalibrationSheet(cv, image, firstPass),
  );
  if (direct.kind === "calibrated" || firstPass.length === 0) return direct;
  // Streaks hide a marker or shift its edges; they do not print a second one.
  if (new Set(firstPass.map(({ id }) => id)).size !== firstPass.length) return direct;

  const secondLook = detectStreakedTemplateMarkers(cv, image, firstPass);
  if (!keepsEveryMarker(firstPass, secondLook)) return direct;
  const recovered = calibrateDetectedSheet(cv, {
    markers: secondLook,
    family: TEMPLATE_DICTIONARY,
    isTemplate: true,
  });
  return recovered.kind === "calibrated" ? recovered : direct;
}

/**
 * True when each marker of `seen` appears in `again` with the same id and its
 * center within half a marker side. A streak that cut a quad short moves the
 * center by a fraction of that; a different marker with the same id is
 * elsewhere on the page.
 */
function keepsEveryMarker(
  seen: readonly DetectedMarker[],
  again: readonly DetectedMarker[],
): boolean {
  return seen.every((first) =>
    again.some((marker) => {
      if (marker.id !== first.id || !marker.cornersPx) return false;
      const [a, b, c] = marker.cornersPx;
      const side = Math.max(
        Math.hypot(b.x - a.x, b.y - a.y),
        Math.hypot(c.x - b.x, c.y - b.y),
      );
      const moved = Math.hypot(
        marker.centerPx.x - first.centerPx.x,
        marker.centerPx.y - first.centerPx.y,
      );
      return moved <= side / 2;
    }),
  );
}

/** Identifies and validates a sheet from one detection pass's markers. */
function calibrateDetectedSheet(
  cv: any,
  detection: ArucoDetection | null,
): SheetCalibrationResult {
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
