import { REFERENCE_STRIP, referenceStripMarkers } from "./reference-strip";
import type { DetectedMarker, ScaleSolution } from "./solve";

/**
 * A strip supplies a scalar ruler, not a paper homography. Check all eight
 * corners against one orientation-preserving similarity transform anchored
 * at the known marker centres. This rejects a wrong spacing, swapped/turned
 * marker, bent strip or oblique photo instead of hiding it in a homography.
 * The tolerances allow subpixel noise on ~30 px markers; they cannot prove
 * coplanarity with the object or eliminate lens distortion.
 */
export function solveReferenceStrip(markers: readonly DetectedMarker[]): ScaleSolution | null {
  const expected = referenceStripMarkers();
  const pair = expected.map(({ id }) => markers.filter((marker) => marker.id === id));
  if (pair.some((copies) => copies.length !== 1)) return null;
  const [a, b] = pair.map(([marker]) => marker);
  if (!a.cornersPx || !b.cornersPx) return null;
  const dx = b.centerPx.x - a.centerPx.x;
  const dy = b.centerPx.y - a.centerPx.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 40) return null;
  const mmPerPx = REFERENCE_STRIP.centerSpacingMm / distance;
  const cos = dx / distance;
  const sin = dy / distance;
  let squaredError = 0;
  let maxDeviation = 0;
  for (const [index, marker] of [a, b].entries()) {
    const corners = marker.cornersPx!;
    for (let corner = 0; corner < 4; corner++) {
      const point = corners[corner];
      const x = point.x - a.centerPx.x;
      const y = point.y - a.centerPx.y;
      const actualX = (x * cos + y * sin) * mmPerPx + expected[0].center.x;
      const actualY = (-x * sin + y * cos) * mmPerPx + expected[0].center.y;
      const target = expected[index].corners[corner];
      squaredError += (actualX - target.x) ** 2 + (actualY - target.y) ** 2;
      const next = corners[(corner + 1) % 4];
      const edgeMm = Math.hypot(next.x - point.x, next.y - point.y) * mmPerPx;
      maxDeviation = Math.max(maxDeviation, Math.abs(edgeMm / REFERENCE_STRIP.markerSizeMm - 1));
    }
  }
  const rmsMm = Math.sqrt(squaredError / 8);
  if (!Number.isFinite(rmsMm) || rmsMm > 0.45 || maxDeviation > 0.06) return null;
  return {
    mmPerPx,
    markerIds: [...REFERENCE_STRIP.markerIds],
    pairCount: 1,
    maxDeviation,
    ruler: {
      a: a.centerPx,
      b: b.centerPx,
      lengthMm: REFERENCE_STRIP.centerSpacingMm,
    },
  };
}
