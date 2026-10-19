import type { CutoutPlacement } from "./cutout";
import { hasPocketTilt, rotatePocketVector, type Vec3 } from "./pocket-orientation";

/** A fresh pocket gets clearance on its first tilt. Once its finite dimensions
 * are frozen, preserve disabled clearance too, including after an upright reset. */
export function defaultPocketInsertion(previous: CutoutPlacement, next: CutoutPlacement): CutoutPlacement["insertionMode"] {
  // Elevation marks an established rigid object; an unset mode then means no
  // extra clearance, rather than a default that can be reapplied on every tilt.
  return next.insertionMode ?? (previous.elevationMm === undefined && !hasPocketTilt(previous) && hasPocketTilt(next) ? "axis" : undefined);
}

/** Follow a local object axis after its complete pose. Axis direction is
 * unsigned: always take its upward end, including mirrored/inverted pockets. */
export function pocketInsertionAxis(pocket: CutoutPlacement): Vec3 {
  if (pocket.insertionMode === "vertical") return { x: 0, y: 0, z: 1 };
  const localAxis = pocket.insertionAxis ?? "z";
  const axis = rotatePocketVector({ x: localAxis === "x" ? 1 : 0, y: localAxis === "y" ? 1 : 0, z: localAxis === "z" ? 1 : 0 }, pocket);
  const sign = axis.z < 0 ? -1 : 1;
  return { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign };
}

/** Finite pockets remain valid at any angle; an axial path must reach the top. */
export function pocketInsertionError(pocket: CutoutPlacement): string | null {
  return pocket.insertionMode === "axis" && pocketInsertionAxis(pocket).z < 0.01
    ? `The selected ${(pocket.insertionAxis ?? "z").toUpperCase()} axis is too close to horizontal to reach the bin top. Choose another axis, use ${pocket.role === "hole" ? "vertical projection" : "vertical drop-in"}, or change the rotation.`
    : null;
}
