import { rotateObjectVector } from "./object-pose";
import type { Vec3 } from "./object-pose";
export type { Vec3 } from "./object-pose";

/** Shape axes are tilted X, then Y, then given the existing bin Z heading. */
export interface PocketOrientation {
  rotationDeg: number;
  tilt?: { xDeg: number; yDeg: number };
  profileBottom?: unknown;
}


export function hasPocketTilt(pocket: Pick<PocketOrientation, "tilt" | "profileBottom">): boolean {
  return !pocket.profileBottom && ((pocket.tilt?.xDeg ?? 0) !== 0 || (pocket.tilt?.yDeg ?? 0) !== 0);
}

/** Rz * Ry * Rx, independent of the renderer and geometry kernel. */
export function rotatePocketVector(p: Vec3, orientation: PocketOrientation): Vec3 {
  return rotateObjectVector(p, { xDeg: orientation.tilt?.xDeg ?? 0, yDeg: orientation.tilt?.yDeg ?? 0, zDeg: orientation.rotationDeg });
}

export function pocketAxis(orientation: PocketOrientation): Vec3 {
  return rotatePocketVector({ x: 0, y: 0, z: 1 }, orientation);
}

/** Maps the outline to its intersection with the horizontal bin top, along
 * the tilted depth axis. This is an oblique section, not a foreshortened view. */
export function pocketMouthBasis(orientation: PocketOrientation): { x: Vec3; y: Vec3 } {
  const axis = pocketAxis(orientation);
  // Invalid/near-horizontal inputs remain renderable while validation reports
  // the problem; builders reject them before allocating a huge cutter.
  const nz = Math.max(0.01, axis.z);
  const project = (v: Vec3): Vec3 => ({ x: v.x - axis.x * v.z / nz, y: v.y - axis.y * v.z / nz, z: 0 });
  return { x: project(rotatePocketVector({ x: 1, y: 0, z: 0 }, orientation)), y: project(rotatePocketVector({ x: 0, y: 1, z: 0 }, orientation)) };
}
