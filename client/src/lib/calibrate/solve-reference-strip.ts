import { referenceStripFromMarkerIds, referenceStripMarkers } from "./reference-strip";
import type { DetectedMarker, ScaleSolution } from "./solve";

// Rasterized marker edges have a finite localization error. A half-pixel
// allowance on each measured edge prevents a ~14 px marker being rejected
// for sampling noise while preserving the 6% geometric limit at high resolution.
const EDGE_LOCALIZATION_ALLOWANCE_PX = 0.5;
const MAX_EDGE_DEVIATION = 0.06;

/**
 * A strip supplies a scalar ruler, not a paper homography. Check all eight
 * corners against one orientation-preserving similarity transform anchored
 * at the known marker centres. This rejects a wrong spacing, swapped/turned
 * marker, bent strip or oblique photo instead of hiding it in a homography.
 * The tolerances account for subpixel edge noise; they cannot prove
 * coplanarity with the object or eliminate lens distortion.
 */
export function solveReferenceStrip(
  markers: readonly DetectedMarker[],
  options: { sourceBaselinePx?: number } = {},
): ScaleSolution | null {
  const spec = referenceStripFromMarkerIds(markers.map(({ id }) => id));
  if (!spec) return null;
  const expected = referenceStripMarkers(spec);
  const pair = expected.map(({ id }) => markers.filter((marker) => marker.id === id));
  if (pair.some((copies) => copies.length !== 1)) return null;
  const [a, b] = pair.map(([marker]) => marker);
  if (!a.cornersPx || !b.cornersPx) return null;
  const dx = b.centerPx.x - a.centerPx.x;
  const dy = b.centerPx.y - a.centerPx.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 40) return null;
  // When points were rectified, retain the source raster's resolution floor
  // and pixel-localization allowance. Output resizing cannot add evidence or
  // make a high-resolution geometric mismatch pass as low-resolution noise.
  const sourceBaselinePx = options.sourceBaselinePx ?? distance;
  if (!Number.isFinite(sourceBaselinePx) || sourceBaselinePx < 40) return null;
  const mmPerPx = spec.centerSpacingMm / distance;
  const maxEdgeDeviation = MAX_EDGE_DEVIATION +
    EDGE_LOCALIZATION_ALLOWANCE_PX * (spec.centerSpacingMm / sourceBaselinePx) / spec.markerSizeMm;
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
      maxDeviation = Math.max(maxDeviation, Math.abs(edgeMm / spec.markerSizeMm - 1));
    }
  }
  const rmsMm = Math.sqrt(squaredError / 8);
  if (!Number.isFinite(rmsMm) || rmsMm > 0.45 || maxDeviation > maxEdgeDeviation) return null;
  return {
    mmPerPx,
    markerIds: [...spec.markerIds],
    pairCount: 1,
    maxDeviation,
    ruler: {
      a: a.centerPx,
      b: b.centerPx,
      lengthMm: spec.centerSpacingMm,
    },
  };
}
