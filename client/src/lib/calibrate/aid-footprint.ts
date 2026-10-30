import type { Ring } from "@shared/geometry/types";
import { ensureOrientation } from "@shared/geometry/rings";
import type { DetectedMarker } from "./solve";
import { referenceStripFromMarkerIds, referenceStripMarkers } from "./reference-strip";

/** Project the known carrier (including the paper cut border) from validated markers.
 * Call only after the aid passes the normal scale/perspective checks. */
export function aidFootprint(
  // OpenCV's injected ArUco/homography API is untyped.
  cv: any,
  markers: readonly DetectedMarker[],
): Ring | null {
  const spec = referenceStripFromMarkerIds(markers.map(({ id }) => id));
  if (!spec || markers.some(marker => !marker.cornersPx)) return null;
  const expected = referenceStripMarkers(spec);
  const border = 2; // Paper cutouts add 2 mm of white carrier around the artwork.
  const body = [
    { x: -border, y: -border }, { x: spec.lengthMm + border, y: -border },
    { x: spec.lengthMm + border, y: spec.widthMm + border },
    { x: -border, y: spec.widthMm + border },
  ];
  // OpenCV handles must be released even when a later allocation/fit fails.
  const handles: Array<{ delete(): void }> = [];
  const track = <T extends { delete(): void }>(handle: T): T => { handles.push(handle); return handle; };
  try {
    const source = track(cv.matFromArray(8, 1, cv.CV_32FC2,
      expected.flatMap(marker => marker.corners.flatMap(p => [p.x, p.y]))));
    const destination = track(cv.matFromArray(8, 1, cv.CV_32FC2,
      expected.flatMap(({ id }) => markers.find(marker => marker.id === id)!.cornersPx!.flatMap(p => [p.x, p.y]))));
    const points = track(cv.matFromArray(4, 1, cv.CV_32FC2, body.flatMap(p => [p.x, p.y])));
    const projected = track(new cv.Mat());
    const transform = cv.findHomography(source, destination, 0);
    if (transform) track(transform);
    if (!transform || transform.rows !== 3 || transform.cols !== 3) return null;
    const h = transform.data64F as Float64Array;
    const weights = body.map(({ x, y }) => h[6] * x + h[7] * y + h[8]);
    if (weights.some(weight => !Number.isFinite(weight) || weight * weights[0] <= 0)) return null;
    cv.perspectiveTransform(points, projected, transform);
    const values = projected.data32F as Float32Array;
    const ring = body.map((_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] }));
    return ring.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      ? ensureOrientation(ring, 1) : null;
  } catch {
    // Failure to describe an optional carrier must not discard a valid scale.
    return null;
  } finally {
    for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
  }
}
