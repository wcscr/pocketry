/** Shape axes are tilted X, then Y, then given the existing bin Z heading. */
export interface PocketOrientation {
  rotationDeg: number;
  tilt?: { xDeg: number; yDeg: number };
}

export type Vec3 = { x: number; y: number; z: number };

export function hasPocketTilt(pocket: Pick<PocketOrientation, "tilt">): boolean {
  return (pocket.tilt?.xDeg ?? 0) !== 0 || (pocket.tilt?.yDeg ?? 0) !== 0;
}

/** Rz * Ry * Rx, independent of the renderer and geometry kernel. */
export function rotatePocketVector(p: Vec3, orientation: PocketOrientation): Vec3 {
  const x = (orientation.tilt?.xDeg ?? 0) * Math.PI / 180;
  const y = (orientation.tilt?.yDeg ?? 0) * Math.PI / 180;
  const z = orientation.rotationDeg * Math.PI / 180;
  const a = { x: p.x, y: p.y * Math.cos(x) - p.z * Math.sin(x), z: p.y * Math.sin(x) + p.z * Math.cos(x) };
  const b = { x: a.x * Math.cos(y) + a.z * Math.sin(y), y: a.y, z: -a.x * Math.sin(y) + a.z * Math.cos(y) };
  return { x: b.x * Math.cos(z) - b.y * Math.sin(z), y: b.x * Math.sin(z) + b.y * Math.cos(z), z: b.z };
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
