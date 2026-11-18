import type { Point } from "@shared/geometry/types";

import {
  ARUCO_4X4_MODULES,
  POCKETRY_ARUCO_BITS,
  PAPER_TEMPLATE_MARKER_COUNT,
  STABLE_TEMPLATE_MARKER_COUNT,
} from "./aruco-4x4";
import { REFERENCE_STRIP_MARKER_IDS } from "./reference-strip";
import type { DetectedMarker } from "./solve";

/**
 * ArUco marker detection over the aruco-enabled opencv.js build. `cv` is
 * injected, never imported — the same rule as the detection pipeline — so
 * this module runs on the main thread, in a worker, and under Vitest against
 * the exact bundle the browser ships.
 *
 * The wasm classes carry the `aruco_` embind prefix (`aruco_ArucoDetector`,
 * `aruco_DetectorParameters`, …); every handle is deleted in `finally`, the
 * `MatScope` discipline in miniature.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */
type Cv = any;

export interface ArucoDetection {
  markers: DetectedMarker[];
  /** Which predefined dictionary matched, e.g. "DICT_ARUCO_ORIGINAL". */
  family: string;
  /** True when the match is the Pocketry template's dictionary. */
  isTemplate: boolean;
}

/** Machine-readable namespace of the printable Pocketry v2 template. */
export const TEMPLATE_DICTIONARY = "POCKETRY_4X4_V2";

/**
 * Families probed when the template dictionary finds nothing, most likely
 * first: home-printed sheets usually come from generator sites whose default
 * is Original ArUco, and 5×5/6×6/AprilTag cover the common alternatives.
 * A hit here means "the user is clearly trying to calibrate with markers" —
 * worth a pointer at the Pocketry sheet — while costing one extra detector
 * pass each on this one-shot path.
 */
const FOREIGN_FAMILIES = [
  "DICT_4X4_50",
  "DICT_ARUCO_ORIGINAL",
  "DICT_6X6_250",
  "DICT_5X5_250",
  "DICT_7X7_250",
  "DICT_APRILTAG_36h11",
] as const;

/** True when the loaded cv build carries the aruco API. */
export function hasArucoSupport(cv: Cv): boolean {
  return (
    typeof cv?.aruco_ArucoDetector === "function" &&
    typeof cv?.getPredefinedDictionary === "function" &&
    typeof cv?.extendDictionary === "function" &&
    typeof cv?.findHomography === "function" &&
    typeof cv?.perspectiveTransform === "function"
  );
}

/**
 * Recreates the pinned Pocketry v2 custom dictionary from OpenCV 4.11.0.
 * The oracle test compares every generated cell with `POCKETRY_ARUCO_BITS`, so
 * an OpenCV upgrade cannot silently change the printed/detected namespace.
 */
export function createPocketryTemplateDictionary(
  cv: Cv,
  markerCount = PAPER_TEMPLATE_MARKER_COUNT,
): Cv {
  return cv.extendDictionary(markerCount, 4);
}

/** Dedicated pass, before paper detection: a sheet must not hide a raised strip. */
export function detectReferenceStripMarkers(
  cv: Cv,
  image: ImageData,
  refinement: "subpixel" | "contour" = "subpixel",
): DetectedMarker[] {
  return detectMarkersWithDictionary(cv, image, () =>
    createPocketryTemplateDictionary(cv, POCKETRY_ARUCO_BITS.length),
    refinement === "contour" ? cv.CORNER_REFINE_CONTOUR : cv.CORNER_REFINE_SUBPIX,
  ).filter(({ id }) => REFERENCE_STRIP_MARKER_IDS.includes(id));
}

/**
 * Print streaks up to about this fraction of one marker cell are filled before
 * the second look, and never fewer than `MIN_STREAK_FILL_PX`. For markers
 * about 60 px and wider a cell is over three times the fill, so the pattern
 * survives. For smaller markers the 3 px floor is a larger share of a cell
 * and the second look may simply find nothing.
 */
const STREAK_FILL_CELL_FRACTION = 0.3;
const MIN_STREAK_FILL_PX = 3;
const MAX_STREAK_FILL_PX = 9;

/**
 * Side, in pixels, of the square that fills print streaks for markers of the
 * size the first pass found. A streak can cut a quad short, so the longest
 * measured side stands in for the marker's true size; in a tilted photo that
 * is the nearest marker. Always odd, so the square is centered on its pixel.
 */
export function streakFillSizePx(markers: readonly DetectedMarker[]): number {
  let longestSide = 0;
  for (const { cornersPx } of markers) {
    if (!cornersPx) continue;
    for (let i = 0; i < 4; i++) {
      const a = cornersPx[i];
      const b = cornersPx[(i + 1) % 4];
      const side = Math.hypot(b.x - a.x, b.y - a.y);
      // A comparison, not Math.max: a non-finite corner must not win.
      if (side > longestSide && Number.isFinite(side)) longestSide = side;
    }
  }
  const target = (longestSide / ARUCO_4X4_MODULES) * STREAK_FILL_CELL_FRACTION;
  const odd = 2 * Math.round((target - 1) / 2) + 1;
  return Math.min(MAX_STREAK_FILL_PX, Math.max(MIN_STREAK_FILL_PX, odd));
}

/**
 * Fills light lines thinner than `sizePx` in a grayscale frame, in place.
 *
 * This is a morphological opening. The outline of a dark convex shape with
 * clear lighter ground around it, which is what a marker's outer square on
 * paper is, stays where it was: corners refined afterwards moved 0 px on clean
 * synthetic sheets and under 0.1 px on a photographed streaked sheet. The light
 * cells inside a marker lose a little at their corners. Anything dark within
 * `sizePx` of a marker can merge with it, so a result from this frame still
 * has to pass the sheet geometry checks like any other.
 */
function fillThinLightLines(cv: Cv, gray: Cv, sizePx: number): void {
  const square = cv.Mat.ones(sizePx, sizePx, cv.CV_8U);
  try {
    cv.morphologyEx(gray, gray, cv.MORPH_OPEN, square);
  } finally {
    square.delete();
  }
}

function detectMarkersWithDictionary(
  cv: Cv,
  image: ImageData,
  createDictionary: () => Cv,
  cornerRefinement = cv.CORNER_REFINE_SUBPIX,
  /** Fill light lines thinner than this many pixels first; 0 reads the frame as is. */
  streakFillPx = 0,
): DetectedMarker[] {
  const src = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const corners = new cv.MatVector();
  const ids = new cv.Mat();
  const rejected = new cv.MatVector();
  let dictionary: Cv | null = null;
  let parameters: Cv | null = null;
  let refine: Cv | null = null;
  let detector: Cv | null = null;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    if (streakFillPx > 1) fillThinLightLines(cv, gray, streakFillPx);
    dictionary = createDictionary();
    parameters = new cv.aruco_DetectorParameters();
    // The default is CORNER_REFINE_NONE. Subpixel refinement gives the
    // homography stable point correspondences without changing the template.
    if (typeof cornerRefinement === "number") {
      parameters.cornerRefinementMethod = cornerRefinement;
    }
    refine = new cv.aruco_RefineParameters(10, 3, true);
    detector = new cv.aruco_ArucoDetector(dictionary, parameters, refine);
    detector.detectMarkers(gray, corners, ids, rejected);

    const markers: DetectedMarker[] = [];
    const count = ids.rows;
    for (let i = 0; i < count; i++) {
      const id = ids.data32S[i];
      const quad = corners.get(i);
      try {
        const data = quad.data32F as Float32Array;
        const cornersPx: Point[] = [
          { x: data[0], y: data[1] },
          { x: data[2], y: data[3] },
          { x: data[4], y: data[5] },
          { x: data[6], y: data[7] },
        ];
        markers.push({
          id,
          cornersPx: cornersPx as [Point, Point, Point, Point],
          centerPx: {
            x: (cornersPx[0].x + cornersPx[1].x + cornersPx[2].x + cornersPx[3].x) / 4,
            y: (cornersPx[0].y + cornersPx[1].y + cornersPx[2].y + cornersPx[3].y) / 4,
          },
        });
      } finally {
        quad.delete();
      }
    }
    return markers;
  } finally {
    detector?.delete?.();
    refine?.delete?.();
    parameters?.delete?.();
    dictionary?.delete?.();
    rejected.delete();
    ids.delete();
    corners.delete();
    gray.delete();
    src.delete();
  }
}

/** Runs the detector for one predefined dictionary id. */
export function detectArucoMarkers(
  cv: Cv,
  image: ImageData,
  predefinedDictionary: number,
): DetectedMarker[] {
  return detectMarkersWithDictionary(cv, image, () =>
    cv.getPredefinedDictionary(predefinedDictionary),
  );
}

/**
 * Detects only Pocketry v2 custom markers, never stock-dictionary lookalikes.
 * Existing sheets are tried against their original eight-marker dictionary
 * first, preserving its exact decoding/error-correction behaviour. The full
 * dictionary is only needed for the new experimental marker signatures.
 */
export function detectPocketryTemplateMarkers(
  cv: Cv,
  image: ImageData,
): DetectedMarker[] {
  const stable = detectMarkersWithDictionary(cv, image, () =>
    createPocketryTemplateDictionary(cv, STABLE_TEMPLATE_MARKER_COUNT),
  );
  if (stable.length >= 2) return stable;
  return detectMarkersWithDictionary(cv, image, () =>
    createPocketryTemplateDictionary(cv),
  );
}

/**
 * Second look at a sheet whose markers are crossed by thin light print
 * streaks (banding from an inkjet or laser printer).
 *
 * A streak through a marker's black border splits the square the detector
 * needs: the marker is missed, or found with one edge placed on the streak.
 * This pass fills such lines first and otherwise detects exactly as usual,
 * with the dictionary the first pass's markers belong to. `firstPass` must
 * hold at least one marker; it sets the streak size to fill. The caller
 * decides whether the result is a better sheet than the first pass found.
 */
export function detectStreakedTemplateMarkers(
  cv: Cv,
  image: ImageData,
  firstPass: readonly DetectedMarker[],
): DetectedMarker[] {
  const stable = firstPass.every(({ id }) => id < STABLE_TEMPLATE_MARKER_COUNT);
  return detectMarkersWithDictionary(
    cv,
    image,
    () =>
      createPocketryTemplateDictionary(
        cv,
        stable ? STABLE_TEMPLATE_MARKER_COUNT : PAPER_TEMPLATE_MARKER_COUNT,
      ),
    cv.CORNER_REFINE_SUBPIX,
    streakFillSizePx(firstPass),
  );
}

/**
 * Looks for a calibration sheet: the Pocketry template's dictionary first;
 * failing that, the common foreign families, so the UI can point the user at
 * the printable template instead of silently finding nothing. `primary` lets
 * a caller that already ran the template pass reuse its markers.
 */
export function detectCalibrationSheet(
  cv: Cv,
  image: ImageData,
  primary: DetectedMarker[] = detectPocketryTemplateMarkers(cv, image),
): ArucoDetection | null {
  if (primary.length >= 2) {
    return { markers: primary, family: TEMPLATE_DICTIONARY, isTemplate: true };
  }

  for (const family of FOREIGN_FAMILIES) {
    const dictionaryId = cv[family];
    if (typeof dictionaryId !== "number") continue;
    const markers = detectArucoMarkers(cv, image, dictionaryId);
    if (markers.length >= 2) return { markers, family, isTemplate: false };
  }
  return null;
}
