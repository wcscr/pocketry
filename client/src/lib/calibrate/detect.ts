import type { Point } from "@shared/geometry/types";

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

/** The dictionary the printable Pocketry template uses. */
export const TEMPLATE_DICTIONARY = "DICT_4X4_50";

/**
 * Families probed when the template dictionary finds nothing, most likely
 * first: home-printed sheets usually come from generator sites whose default
 * is Original ArUco, and 5×5/6×6/AprilTag cover the common alternatives.
 * A hit here means "the user is clearly trying to calibrate with markers" —
 * worth a pointer at the Pocketry sheet — while costing one extra detector
 * pass each on this one-shot path.
 */
const FOREIGN_FAMILIES = [
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
    typeof cv?.getPredefinedDictionary === "function"
  );
}

/** Runs the detector for one predefined dictionary id. */
export function detectArucoMarkers(
  cv: Cv,
  image: ImageData,
  predefinedDictionary: number,
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
    dictionary = cv.getPredefinedDictionary(predefinedDictionary);
    parameters = new cv.aruco_DetectorParameters();
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

/**
 * Looks for a calibration sheet: the Pocketry template's dictionary first;
 * failing that, the common foreign families, so the UI can point the user at
 * the printable template instead of silently finding nothing.
 */
export function detectCalibrationSheet(cv: Cv, image: ImageData): ArucoDetection | null {
  const primary = detectArucoMarkers(cv, image, cv[TEMPLATE_DICTIONARY]);
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
