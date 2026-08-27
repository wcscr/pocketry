import type { Calibration } from "@shared/geometry/scale";
import type { Point } from "@shared/geometry/types";

import { loadOpenCV } from "@/lib/opencv";

import {
  TEMPLATE_SPACING_MM,
  TEMPLATE_MARKER_IDS,
  TEMPLATE_PAPER_MM,
  templateMarkerCentersMm,
  type TemplatePaper,
} from "./template";
import type { DetectedMarker } from "./solve";

/** The four source points, ordered top-left, top-right, bottom-right, bottom-left. */
export type PerspectiveQuad = [Point, Point, Point, Point];

export type PerspectiveSource = "template" | "manual";

/** A proposed mapping from the photographed plane to a metric paper rectangle. */
export interface PerspectiveProposal {
  source: PerspectiveSource;
  points: PerspectiveQuad;
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
}

/**
 * Two pixels per millimetre nearly fills the existing 800 x 600 working frame
 * for portrait A4 while keeping both A4 and Letter below the cap. More pixels
 * would be discarded by the canvas cap; fewer would throw away source detail.
 */
export const RECTIFIED_PX_PER_MM = 2;

/** Builds an ordered four-marker proposal, or null when any template id is absent. */
export function proposalFromTemplateMarkers(
  markers: readonly DetectedMarker[],
): PerspectiveProposal | null {
  const unique = new Map<number, DetectedMarker>();
  const duplicates = new Set<number>();
  for (const marker of markers) {
    if (unique.has(marker.id)) duplicates.add(marker.id);
    else unique.set(marker.id, marker);
  }

  const ordered: Point[] = [];
  for (const id of TEMPLATE_MARKER_IDS) {
    if (duplicates.has(id)) return null;
    const marker = unique.get(id);
    if (!marker) return null;
    ordered.push(marker.centerPx);
  }
  return { source: "template", points: ordered as PerspectiveQuad };
}

/** Rescales a proposal between detection and working-image coordinate spaces. */
export function scalePerspectiveProposal(
  proposal: PerspectiveProposal,
  factor: number,
): PerspectiveProposal {
  return {
    ...proposal,
    points: proposal.points.map((point) => ({
      x: point.x * factor,
      y: point.y * factor,
    })) as PerspectiveQuad,
  };
}

/**
 * Defines the corrected paper raster and the four destination correspondences.
 * Manual points are page corners. Template points are marker centres, whose
 * page locations are already fixed by the printable sheet.
 */
export function perspectiveLayout(
  proposal: PerspectiveProposal,
  paper: TemplatePaper,
  max = { width: 800, height: 600 },
): PerspectiveLayout {
  const page = TEMPLATE_PAPER_MM[paper];
  const availableX = Math.max(1, max.width - 1) / page.width;
  const availableY = Math.max(1, max.height - 1) / page.height;
  const pxPerMm = Math.min(RECTIFIED_PX_PER_MM, availableX, availableY);
  const width = Math.ceil(page.width * pxPerMm) + 1;
  const height = Math.ceil(page.height * pxPerMm) + 1;

  const destination =
    proposal.source === "template"
      ? (templateMarkerCentersMm(paper).map(({ x, y }) => ({
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

/** Pure OpenCV composition, separated so tests exercise the shipped build. */
export function runPerspectiveCorrection(
  cv: any,
  image: ImageData,
  proposal: PerspectiveProposal,
  paper: TemplatePaper,
  max = { width: 800, height: 600 },
): PerspectiveCorrectionResult {
  if (!validPerspectiveQuad(proposal.points)) {
    throw new Error(
      "The four correction points must form one non-overlapping rectangle in clockwise order.",
    );
  }

  const layout = perspectiveLayout(proposal, paper, max);
  const source = cv.matFromImageData(image);
  const corrected = new cv.Mat();
  const sourcePoints = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    proposal.points.flatMap(({ x, y }) => [x, y]),
  );
  const destinationPoints = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    layout.destination.flatMap(({ x, y }) => [x, y]),
  );
  let transform: any | null = null;

  try {
    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
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
    const lengthMm =
      proposal.source === "template"
        ? Math.hypot(TEMPLATE_SPACING_MM.width, TEMPLATE_SPACING_MM.height)
        : Math.hypot(TEMPLATE_PAPER_MM[paper].width, TEMPLATE_PAPER_MM[paper].height);

    return {
      ...layout,
      imageData,
      calibration: {
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        lengthMm,
      },
    };
  } finally {
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
  paper: TemplatePaper,
): Promise<PerspectiveCorrectionResult> {
  const cv = await loadOpenCV();
  if (
    typeof cv?.getPerspectiveTransform !== "function" ||
    typeof cv?.warpPerspective !== "function"
  ) {
    throw new Error("Perspective correction is unavailable in this browser session.");
  }
  return runPerspectiveCorrection(cv, image, proposal, paper);
}
