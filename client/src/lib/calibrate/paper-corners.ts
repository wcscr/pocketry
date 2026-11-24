import { signedArea } from "@shared/geometry/rings";
import type { Point } from "@shared/geometry/types";
import { MatScope, type OpenCV } from "@/lib/detect/segment-opencv";
import { loadOpenCV } from "@/lib/opencv";
import { validPerspectiveQuad, type PerspectiveQuad } from "./perspective";

interface Candidate {
  points: PerspectiveQuad;
  score: number;
}

const MIN_PAGE_AREA_FRACTION = 0.075;

/** Keep the same clockwise numbering as the manual page-corner tool. */
function orderedCorners(values: Int32Array): PerspectiveQuad {
  const points = Array.from({ length: 4 }, (_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] }));
  if (signedArea(points) < 0) points.reverse();
  const first = points.reduce((best, point, i) =>
    point.x + point.y < points[best].x + points[best].y ? i : best, 0);
  return [points[first], points[(first + 1) % 4], points[(first + 2) % 4], points[(first + 3) % 4]];
}

/** Count the portions of each proposed edge with brighter paper on the inside. */
function edgeSupport(image: ImageData, lightPaper: Uint8Array, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // Straddle the rasterized edge by a few pixels, including on downsampled photos.
  const distance = Math.max(2, Math.min(image.width, image.height) * 0.005);
  const nx = -dy / length * distance;
  const ny = dx / length * distance;
  const samples = 20;
  let supported = 0;
  for (let i = 0; i < samples; i++) {
    const t = 0.1 + 0.8 * (i + 0.5) / samples;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const inner = Math.round(y + ny) * image.width + Math.round(x + nx);
    const outer = Math.round(y - ny) * image.width + Math.round(x - nx);
    if (image.data[inner * 4 + 3] >= 250 && image.data[outer * 4 + 3] >= 250 &&
      lightPaper[inner] >= 100 && lightPaper[inner] - lightPaper[outer] >= 10) supported++;
  }
  return supported / samples;
}

function scoreCandidate(image: ImageData, lightPaper: Uint8Array, points: PerspectiveQuad): number | null {
  const { width, height } = image;
  const margin = Math.max(3, Math.min(width, height) * 0.005 + 1);
  if (points.some(({ x, y }) => x <= margin || y <= margin || x >= width - 1 - margin || y >= height - 1 - margin) ||
    !validPerspectiveQuad(points)) return null;
  const areaFraction = signedArea(points) / (width * height);
  if (areaFraction < MIN_PAGE_AREA_FRACTION) return null;
  const sides = points.map((a, i) => {
    const b = points[(i + 1) % 4];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  const axisA = sides[0] + sides[2];
  const axisB = sides[1] + sides[3];
  // Permit rotation and foreshortening, while rejecting narrow strips and spikes.
  if (Math.min(axisA, axisB) < 0.4 * Math.max(axisA, axisB) ||
    Math.min(...sides) < 0.35 * Math.max(...sides)) return null;
  const support = points.map((a, i) => edgeSupport(image, lightPaper, a, points[(i + 1) % 4]));
  const mean = support.reduce((sum, fraction) => sum + fraction, 0) / 4;
  if (Math.min(...support) < 0.55 || mean < 0.75) return null;
  return mean * Math.sqrt(areaFraction);
}

function sameSheet(a: PerspectiveQuad, b: PerspectiveQuad, tolerance: number): boolean {
  return b.some((_, offset) => a.every((point, i) => {
    const other = b[(i + offset) % 4];
    return Math.hypot(point.x - other.x, point.y - other.y) <= tolerance;
  }));
}

/** Detect one fully visible light sheet. All four edges need visible support. */
export function findPaperCorners(cv: OpenCV, image: ImageData): PerspectiveQuad | null {
  const scope = new MatScope();
  try {
    const rgba = scope.track(cv.matFromImageData(image));
    const gray = scope.track(new cv.Mat());
    const blurred = scope.track(new cv.Mat());
    const mask = scope.track(new cv.Mat());
    const polygon = scope.track(new cv.Mat());
    const hierarchy = scope.track(new cv.Mat());
    const kernel = scope.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    // Reduce the response from colorful backgrounds such as wood or
    // cardboard, which can be lighter than the paper in its shadowed areas.
    const lightPaper = new Uint8Array(gray.data);
    for (let i = 0, offset = 0; i < lightPaper.length; i++, offset += 4) {
      const r = image.data[offset], g = image.data[offset + 1], b = image.data[offset + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      lightPaper[i] = Math.max(0, lightPaper[i] - 2 * chroma);
    }
    gray.data.set(lightPaper);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    const minimumArea = image.width * image.height * MIN_PAGE_AREA_FRACTION;
    const candidates: Candidate[] = [];
    const collect = () => {
      const contours = scope.track(new cv.MatVector());
      cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          if (cv.contourArea(contour) < minimumArea) continue;
          const perimeter = cv.arcLength(contour, true);
          cv.approxPolyDP(contour, polygon, perimeter * 0.015, true);
          if (polygon.rows !== 4) cv.approxPolyDP(contour, polygon, perimeter * 0.025, true);
          if (polygon.rows !== 4) continue;
          const points = orderedCorners(polygon.data32S);
          const score = scoreCandidate(image, lightPaper, points);
          if (score !== null) candidates.push({ points, score });
        } finally {
          contour.delete();
        }
      }
    };
    // The light-region pass handles even lighting. The edge pass can recover
    // the perimeter when a shadow or gradient splits the paper's light region.
    cv.threshold(blurred, mask, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    collect();
    cv.Canny(blurred, mask, 20, 60);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
    collect();

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;
    const tolerance = Math.min(image.width, image.height) * 0.025;
    const competing = candidates.some(candidate => candidate.score >= best.score * 0.9 &&
      !sameSheet(best.points, candidate.points, tolerance));
    return competing ? null : best.points;
  } finally {
    scope.dispose();
  }
}

export async function detectPaperCorners(image: ImageData): Promise<PerspectiveQuad | null> {
  return findPaperCorners(await loadOpenCV(), image);
}
