/**
 * Camera framing math for the bin viewport — pure, so the distance rule is
 * testable without three.js. The G4 review found the fixed camera swallowed
 * by a 7×10 bin: the viewport now re-fits whenever the bin's outer
 * dimensions change, and this is the distance it fits to.
 */

export interface FitSize {
  widthMm: number;
  lengthMm: number;
  heightMm: number;
}

/** Headroom so the bin never kisses the viewport edge. */
const FIT_MARGIN = 1.12;

/**
 * Distance from the bin's centre at which a perspective camera sees the
 * whole bounding sphere, on whichever axis of the frustum is tighter.
 */
export function fitDistanceMm(
  size: FitSize,
  verticalFovDeg: number,
  aspect: number,
): number {
  const radius =
    0.5 * Math.hypot(size.widthMm, size.lengthMm, size.heightMm);
  const vFov = (verticalFovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.1));
  const tightest = Math.min(vFov, hFov);
  return (radius / Math.sin(tightest / 2)) * FIT_MARGIN;
}
