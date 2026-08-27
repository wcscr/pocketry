import type { Point } from "@shared/geometry/types";

import {
  TEMPLATE_MARKER_IDS,
  templateMarkerCentersMm,
  type TemplatePaper,
} from "./template";

/**
 * Scale recovery from detected calibration-sheet markers — pure math, no cv.
 *
 * Every pair of detected template markers has a known millimetre distance
 * (the sheet's 150 × 200 × 250 grid is the same on A4 and Letter), so the
 * scale is a one-parameter least-squares fit through the origin over all
 * pairs: mmPerPx = Σ(d_mm · d_px) / Σ(d_px²). Per-pair deviation from that
 * fit measures perspective skew — a phone held at an angle stretches some
 * pairs more than others — and past a threshold the UI should warn rather
 * than silently absorb the error into every exported millimetre.
 */

export interface DetectedMarker {
  id: number;
  centerPx: Point;
  /** Canonical marker corners: top-left, top-right, bottom-right, bottom-left. */
  cornersPx?: [Point, Point, Point, Point];
}

export interface ScaleSolution {
  mmPerPx: number;
  /** Markers that matched template ids and entered the fit. */
  markerIds: number[];
  /** Number of pairwise distances in the fit (1 for 2 markers, 6 for 4). */
  pairCount: number;
  /** Worst per-pair deviation from the fitted scale, as a fraction (0.02 = 2%). */
  maxDeviation: number;
  /**
   * The longest detected pair, for synthesising the app's ruler calibration:
   * a line between these centres whose true template length is `lengthMm`.
   */
  ruler: { a: Point; b: Point; lengthMm: number };
}

/** Above this per-pair deviation the shot is meaningfully off-axis. */
export const SKEW_WARN_FRACTION = 0.02;

export function solveScaleFromMarkers(
  markers: readonly DetectedMarker[],
  paper: TemplatePaper,
): ScaleSolution | null {
  const template = new Map(
    templateMarkerCentersMm(paper).map((entry) => [entry.id, entry]),
  );
  const usable = markers.filter(
    (marker) =>
      template.has(marker.id) &&
      TEMPLATE_MARKER_IDS[paper].includes(marker.id),
  );
  // Dedupe ids: a reflection or reprint can yield the same id twice; trust
  // neither copy.
  const byId = new Map<number, DetectedMarker>();
  for (const marker of usable) {
    if (byId.has(marker.id)) byId.delete(marker.id);
    else byId.set(marker.id, marker);
  }
  const detected = [...byId.values()];
  if (detected.length < 2) return null;

  let sumMmPx = 0;
  let sumPxPx = 0;
  const pairs: { a: DetectedMarker; b: DetectedMarker; dMm: number; dPx: number }[] = [];
  for (let i = 0; i < detected.length; i++) {
    for (let j = i + 1; j < detected.length; j++) {
      const a = detected[i];
      const b = detected[j];
      const ta = template.get(a.id)!;
      const tb = template.get(b.id)!;
      const dMm = Math.hypot(ta.x - tb.x, ta.y - tb.y);
      const dPx = Math.hypot(a.centerPx.x - b.centerPx.x, a.centerPx.y - b.centerPx.y);
      if (dPx <= 0) continue;
      pairs.push({ a, b, dMm, dPx });
      sumMmPx += dMm * dPx;
      sumPxPx += dPx * dPx;
    }
  }
  if (pairs.length === 0 || sumPxPx === 0) return null;

  const mmPerPx = sumMmPx / sumPxPx;
  let maxDeviation = 0;
  let longest = pairs[0];
  for (const pair of pairs) {
    const deviation = Math.abs(pair.dPx * mmPerPx - pair.dMm) / pair.dMm;
    if (deviation > maxDeviation) maxDeviation = deviation;
    if (pair.dPx > longest.dPx) longest = pair;
  }

  return {
    mmPerPx,
    markerIds: detected.map((marker) => marker.id).sort((a, b) => a - b),
    pairCount: pairs.length,
    maxDeviation,
    ruler: {
      a: longest.a.centerPx,
      b: longest.b.centerPx,
      lengthMm: longest.dMm,
    },
  };
}
