import { mmPerPixel, type Calibration } from "@shared/geometry/scale";
import type { Point } from "@shared/geometry/types";

import { loadOpenCV } from "@/lib/opencv";

import {
  TEMPLATE_MARKER_IDS,
  TEMPLATE_PAPER_MM,
  templateMarkerCornersMm,
  templateMarkerCentersMm,
  templateMarkerSpacingMm,
  templatePaper,
  type TemplatePaper,
  type TemplateVariant,
} from "./template";
import type { DetectedMarker } from "./solve";

/** The four source points, ordered top-left, top-right, bottom-right, bottom-left. */
export type PerspectiveQuad = [Point, Point, Point, Point];

export type PerspectiveSource = "template" | "manual";

/** A proposed mapping from the photographed plane to a metric paper rectangle. */
export interface PerspectiveProposal {
  source: PerspectiveSource;
  points: PerspectiveQuad;
  /** Automatically encoded by the marker-id family for template proposals. */
  paper?: TemplatePaper;
  /** Exact stable or experimental sheet encoded by the marker-id family. */
  template?: TemplateVariant;
  /** Redundant marker-corner correspondences for a precision homography. */
  correspondences?: {
    source: Point[];
    destinationMm: Point[];
  };
}

export interface PerspectiveLayout {
  width: number;
  height: number;
  pxPerMm: number;
  destination: PerspectiveQuad;
}

export interface PerspectiveCorrectionResult extends PerspectiveLayout {
  imageData: ImageData;
  calibration: Calibration;
  /** Root-mean-square destination error; null for a four-click manual fit. */
  reprojectionErrorPx: number | null;
}

/**
 * Perspective correction gets a larger working plane than an ordinary source
 * image. At four pixels per millimetre A4 is 841 x 1189 and Letter is
 * 865 x 1119: large enough to retain readable text and sharp marker edges,
 * while still bounded to roughly one megapixel for interactive tracing.
 */
export const RECTIFIED_PX_PER_MM = 4;
export const RECTIFIED_IMAGE_MAX = { width: 1200, height: 1200 } as const;

/** Reject a template fit whose residual exceeds 0.75 mm on the output plane. */
export const MAX_REPROJECTION_RMS_PX =
  0.75 * RECTIFIED_PX_PER_MM;
export const MAX_TEMPLATE_REPROJECTION_RMS_MM =
  MAX_REPROJECTION_RMS_PX / RECTIFIED_PX_PER_MM;

/** Builds an ordered four-marker proposal, or null when any template id is absent. */
export function proposalFromTemplateMarkers(
  markers: readonly DetectedMarker[],
  template: TemplateVariant,
): PerspectiveProposal | null {
  const unique = new Map<number, DetectedMarker>();
  const duplicates = new Set<number>();
  for (const marker of markers) {
    if (unique.has(marker.id)) duplicates.add(marker.id);
    else unique.set(marker.id, marker);
  }

  const ordered: Point[] = [];
  const source: Point[] = [];
  const destinationMm: Point[] = [];
  const physicalCorners = new Map(
    templateMarkerCornersMm(template).map((marker) => [marker.id, marker.corners]),
  );
  for (const id of TEMPLATE_MARKER_IDS[template]) {
    if (duplicates.has(id)) return null;
    const marker = unique.get(id);
    const destinationCorners = physicalCorners.get(id);
    if (!marker?.cornersPx || !destinationCorners) return null;
    ordered.push(marker.centerPx);
    source.push(...marker.cornersPx);
    destinationMm.push(...destinationCorners);
  }
  return {
    source: "template",
    paper: templatePaper(template),
    template,
    points: ordered as PerspectiveQuad,
    correspondences: { source, destinationMm },
  };
}

/**
 * Fits every detected marker corner to the signed template geometry without
 * warping the image. A four-point centre quad can fit almost anything; the 16
 * corners also constrain marker size and orientation relative to the sheet.
 */
export function templateReprojectionErrorMm(
  cv: any,
  proposal: PerspectiveProposal,
  template: TemplateVariant,
): number | null {
  if (
    (proposal.template && proposal.template !== template) ||
    (proposal.paper && proposal.paper !== templatePaper(template))
  ) {
    return null;
  }
  const fit = proposal.source === "template" ? proposal.correspondences : null;
  if (
    !fit ||
    fit.source.length !== 16 ||
    fit.destinationMm.length !== fit.source.length ||
    !validPerspectiveQuad(proposal.points)
  ) {
    return null;
  }

  const sourcePoints = cv.matFromArray(
    fit.source.length,
    1,
    cv.CV_32FC2,
    fit.source.flatMap(({ x, y }) => [x, y]),
  );
  const destinationPoints = cv.matFromArray(
    fit.destinationMm.length,
    1,
    cv.CV_32FC2,
    fit.destinationMm.flatMap(({ x, y }) => [x, y]),
  );
  const projected = new cv.Mat();
  let transform: any | null = null;

  try {
    transform = cv.findHomography(sourcePoints, destinationPoints, 0);
    if (!transform || transform.rows !== 3 || transform.cols !== 3) return null;
    cv.perspectiveTransform(sourcePoints, projected, transform);
    const values = projected.data32F as Float32Array;
    let sumSquared = 0;
    for (let index = 0; index < fit.destinationMm.length; index++) {
      const dx = values[index * 2] - fit.destinationMm[index].x;
      const dy = values[index * 2 + 1] - fit.destinationMm[index].y;
      sumSquared += dx * dx + dy * dy;
    }
    const error = Math.sqrt(sumSquared / fit.destinationMm.length);
    return Number.isFinite(error) ? error : null;
  } catch {
    return null;
  } finally {
    transform?.delete?.();
    projected.delete();
    destinationPoints.delete();
    sourcePoints.delete();
  }
}

/**
 * Carry detected marker geometry through a validated paper fit without
 * resampling/decoding its pixels. The returned coordinates use the same output
 * raster as runPerspectiveCorrection, so source-corner precision is retained.
 * Callers must validate the paper signature and fit before using this helper.
 */
export function projectMarkersThroughTemplate(
  cv: any,
  markers: readonly DetectedMarker[],
  proposal: PerspectiveProposal,
  template: TemplateVariant,
): DetectedMarker[] | null {
  const fit = proposal.source === "template" ? proposal.correspondences : null;
  if (
    !fit || fit.source.length !== 16 || fit.destinationMm.length !== 16 ||
    (proposal.template && proposal.template !== template) ||
    (proposal.paper && proposal.paper !== templatePaper(template)) ||
    !validPerspectiveQuad(proposal.points) || markers.length === 0 ||
    markers.some((marker) => !marker.cornersPx ||
      [marker.centerPx, ...marker.cornersPx].some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y)))
  ) return null;

  const layout = perspectiveLayout(proposal, template);
  let sourcePoints: any | null = null;
  let destinationPoints: any | null = null;
  let markerPoints: any | null = null;
  let projected: any | null = null;
  let transform: any | null = null;
  try {
    sourcePoints = cv.matFromArray(16, 1, cv.CV_32FC2,
      fit.source.flatMap(({ x, y }) => [x, y]));
    destinationPoints = cv.matFromArray(16, 1, cv.CV_32FC2,
      fit.destinationMm.flatMap(({ x, y }) => [x * layout.pxPerMm, y * layout.pxPerMm]));
    markerPoints = cv.matFromArray(markers.length * 5, 1, cv.CV_32FC2,
      markers.flatMap((marker) => [marker.centerPx, ...marker.cornersPx!].flatMap(({ x, y }) => [x, y])));
    projected = new cv.Mat();
    transform = cv.findHomography(sourcePoints, destinationPoints, 0);
    if (!transform || transform.rows !== 3 || transform.cols !== 3) return null;
    cv.perspectiveTransform(markerPoints, projected, transform);
    const values = projected.data32F as Float32Array;
    const result = markers.map(({ id }, index) => {
      const points = Array.from({ length: 5 }, (_, point) => ({
        x: values[index * 10 + point * 2],
        y: values[index * 10 + point * 2 + 1],
      }));
      return { id, centerPx: points[0], cornersPx: points.slice(1) as PerspectiveQuad };
    });
    // The combined correction crops to the paper. Do not propose an aid whose
    // geometry would be clipped or mapped through a degenerate homography.
    if (result.some((marker) => [marker.centerPx, ...marker.cornersPx].some(({ x, y }) =>
      !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= layout.width || y < 0 || y >= layout.height))) return null;
    return result;
  } catch {
    return null;
  } finally {
    transform?.delete?.();
    projected?.delete?.();
    markerPoints?.delete?.();
    destinationPoints?.delete?.();
    sourcePoints?.delete?.();
  }
}

/** Rescales a proposal between detection and working-image coordinate spaces. */
export function scalePerspectiveProposal(
  proposal: PerspectiveProposal,
  factorX: number,
  factorY = factorX,
): PerspectiveProposal {
  return {
    ...proposal,
    points: proposal.points.map((point) => ({
      x: point.x * factorX,
      y: point.y * factorY,
    })) as PerspectiveQuad,
    correspondences: proposal.correspondences
      ? {
          ...proposal.correspondences,
          source: proposal.correspondences.source.map((point) => ({
            x: point.x * factorX,
            y: point.y * factorY,
          })),
        }
      : undefined,
  };
}

/**
 * Defines the corrected paper raster and the four destination correspondences.
 * Manual points are page corners. Template points are marker centres, whose
 * page locations are already fixed by the printable sheet.
 */
export function perspectiveLayout(
  proposal: PerspectiveProposal,
  template: TemplateVariant,
  max: { width: number; height: number } = RECTIFIED_IMAGE_MAX,
): PerspectiveLayout {
  const paper = templatePaper(template);
  const page = TEMPLATE_PAPER_MM[paper];
  const availableX = Math.max(1, max.width - 1) / page.width;
  const availableY = Math.max(1, max.height - 1) / page.height;
  const pxPerMm = Math.min(RECTIFIED_PX_PER_MM, availableX, availableY);
  const width = Math.ceil(page.width * pxPerMm) + 1;
  const height = Math.ceil(page.height * pxPerMm) + 1;

  const destination =
    proposal.source === "template"
      ? (templateMarkerCentersMm(template).map(({ x, y }) => ({
          x: x * pxPerMm,
          y: y * pxPerMm,
        })) as PerspectiveQuad)
      : ([
          { x: 0, y: 0 },
          { x: page.width * pxPerMm, y: 0 },
          { x: page.width * pxPerMm, y: page.height * pxPerMm },
          { x: 0, y: page.height * pxPerMm },
        ] as PerspectiveQuad);

  return { width, height, pxPerMm, destination };
}

/** Rejects collapsed, self-intersecting, or incorrectly ordered quads. */
export function validPerspectiveQuad(points: readonly Point[]): boolean {
  if (points.length !== 4) return false;
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return false;
  }

  let areaTwice = 0;
  const turns: number[] = [];
  for (let index = 0; index < 4; index++) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    areaTwice += a.x * b.y - b.x * a.y;
    turns.push((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  }
  if (Math.abs(areaTwice) < 50) return false;
  const positive = turns.every((turn) => turn > 1e-6);
  const negative = turns.every((turn) => turn < -1e-6);
  return positive || negative;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */

/**
 * Rectify from the paper geometry. An optional validated aid ruler, expressed
 * in source-image pixels, supplies the scale after its endpoints are warped.
 */
export function runPerspectiveCorrection(
  cv: any,
  image: ImageData,
  proposal: PerspectiveProposal,
  template: TemplateVariant,
  max: { width: number; height: number } = RECTIFIED_IMAGE_MAX,
  referenceCalibration?: Calibration,
): PerspectiveCorrectionResult {
  if (!validPerspectiveQuad(proposal.points)) {
    throw new Error(
      "The four correction points must form one non-overlapping rectangle in clockwise order.",
    );
  }
  const paper = templatePaper(template);
  if (proposal.paper && proposal.paper !== paper) {
    throw new Error("The detected template paper does not match the requested correction.");
  }
  if (proposal.template && proposal.template !== template) {
    throw new Error("The detected template does not match the requested correction.");
  }

  const layout = perspectiveLayout(proposal, template, max);
  const source = cv.matFromImageData(image);
  const corrected = new cv.Mat();
  const precisionFit =
    proposal.correspondences &&
    proposal.correspondences.source.length >= 4 &&
    proposal.correspondences.source.length ===
      proposal.correspondences.destinationMm.length
      ? proposal.correspondences
      : null;
  const sourceCoordinates = precisionFit?.source ?? proposal.points;
  const destinationCoordinates = precisionFit
    ? precisionFit.destinationMm.map(({ x, y }) => ({
        x: x * layout.pxPerMm,
        y: y * layout.pxPerMm,
      }))
    : layout.destination;
  const sourcePoints = cv.matFromArray(
    sourceCoordinates.length,
    1,
    cv.CV_32FC2,
    sourceCoordinates.flatMap(({ x, y }) => [x, y]),
  );
  const destinationPoints = cv.matFromArray(
    destinationCoordinates.length,
    1,
    cv.CV_32FC2,
    destinationCoordinates.flatMap(({ x, y }) => [x, y]),
  );
  let transform: any | null = null;
  const projected = new cv.Mat();

  try {
    transform = precisionFit
      ? cv.findHomography(sourcePoints, destinationPoints, 0)
      : cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    if (!transform || transform.rows !== 3 || transform.cols !== 3) {
      throw new Error("The correction points could not define a stable plane.");
    }

    let reprojectionErrorPx: number | null = null;
    if (precisionFit) {
      cv.perspectiveTransform(sourcePoints, projected, transform);
      const values = projected.data32F as Float32Array;
      let sumSquared = 0;
      for (let index = 0; index < destinationCoordinates.length; index++) {
        const dx = values[index * 2] - destinationCoordinates[index].x;
        const dy = values[index * 2 + 1] - destinationCoordinates[index].y;
        sumSquared += dx * dx + dy * dy;
      }
      reprojectionErrorPx = Math.sqrt(
        sumSquared / destinationCoordinates.length,
      );
      if (
        !Number.isFinite(reprojectionErrorPx) ||
        reprojectionErrorPx > MAX_REPROJECTION_RMS_PX
      ) {
        throw new Error(
          "The template corners disagree too much for a precise correction. Flatten the sheet, avoid the phone's ultra-wide lens, and retake the photo.",
        );
      }
    }

    cv.warpPerspective(
      source,
      corrected,
      transform,
      new cv.Size(layout.width, layout.height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    );

    const pixels = new Uint8ClampedArray(corrected.data);
    const imageData =
      typeof ImageData === "function"
        ? new ImageData(pixels, layout.width, layout.height)
        : ({
            data: pixels,
            width: layout.width,
            height: layout.height,
            colorSpace: "srgb",
          } as ImageData);

    const start = layout.destination[0];
    const end = layout.destination[2];
    const markerSpacing = templateMarkerSpacingMm(template);
    const lengthMm =
      proposal.source === "template"
        ? Math.hypot(markerSpacing.width, markerSpacing.height)
        : Math.hypot(TEMPLATE_PAPER_MM[paper].width, TEMPLATE_PAPER_MM[paper].height);

    let calibration: Calibration = {
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      lengthMm,
    };
    if (referenceCalibration) {
      if (!mmPerPixel(referenceCalibration)) throw new Error("The measurement aid scale is invalid.");
      const referencePoints = cv.matFromArray(2, 1, cv.CV_32FC2, [
        referenceCalibration.startX, referenceCalibration.startY,
        referenceCalibration.endX, referenceCalibration.endY,
      ]);
      try {
        // Carry the already validated aid centres through the exact image warp.
        // Re-decoding interpolated marker pixels would lose source precision.
        cv.perspectiveTransform(referencePoints, projected, transform);
        const [startX, startY, endX, endY] = Array.from(projected.data32F) as number[];
        calibration = { startX, startY, endX, endY, lengthMm: referenceCalibration.lengthMm };
        if (!mmPerPixel(calibration) || [startX, endX].some((x) => x < 0 || x >= layout.width) ||
          [startY, endY].some((y) => y < 0 || y >= layout.height)) {
          throw new Error("The measurement aid lies outside the corrected paper area. Use aid scale without correction or retake the photo with the aid over the sheet.");
        }
      } finally { referencePoints.delete(); }
    }
    return {
      ...layout,
      imageData,
      reprojectionErrorPx,
      calibration,
    };
  } finally {
    projected.delete();
    transform?.delete?.();
    destinationPoints.delete();
    sourcePoints.delete();
    corrected.delete();
    source.delete();
  }
}

/** Browser entry point using Pocketry's bundled OpenCV build. */
export async function correctPerspective(
  image: ImageData,
  proposal: PerspectiveProposal,
  template: TemplateVariant,
  max: { width: number; height: number } = RECTIFIED_IMAGE_MAX,
  referenceCalibration?: Calibration,
): Promise<PerspectiveCorrectionResult> {
  const cv = await loadOpenCV();
  if (
    typeof cv?.getPerspectiveTransform !== "function" ||
    typeof cv?.warpPerspective !== "function"
  ) {
    throw new Error("Perspective correction is unavailable in this browser session.");
  }
  return runPerspectiveCorrection(cv, image, proposal, template, max, referenceCalibration);
}
