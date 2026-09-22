import { Euler, Quaternion, type Vector3 } from "three";
import {
  resolvePlacedPocketDepth, resolvePocketDepth, transformOutlinePlacement,
  type CutoutPlacement, type DepthSpec, type TracedShape,
} from "@shared/gridfinity/cutout";
import { pocketAxis, rotatePocketVector } from "@shared/gridfinity/pocket-orientation";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import type { BinSpec } from "@shared/gridfinity/types";
import { pointInOutline } from "@/lib/geometry/outline";
import type { Point } from "@shared/geometry/types";

export type PocketTransformMode = "translate" | "rotate";
export type PocketTransformPatch = Pick<CutoutPlacement, "position" | "zOffsetMm" | "rotationDeg" | "tilt" | "depth" | "split">;
export interface EditablePocket { cutout: CutoutPlacement; shape: TracedShape }
export type PocketWire = [number, number, number][];
const RAD = Math.PI / 180;
const tidy = (value: number) => Math.round(value * 1e6) / 1e6;

/** Three's ZYX Euler convention is the shared Rz * Ry * Rx pocket transform. */
export function pocketQuaternion(pocket: CutoutPlacement): Quaternion {
  return new Quaternion().setFromEuler(new Euler(
    (pocket.tilt?.xDeg ?? 0) * RAD, (pocket.tilt?.yDeg ?? 0) * RAD, pocket.rotationDeg * RAD, "ZYX",
  ));
}

/** A CAD rotation keeps seat geometry rigid. Freeze remaining-floor depths at
 * their current axial length before rotating, including both split seats. */
export function pocketTransformPatch(
  original: CutoutPlacement, shape: TracedShape, spec: BinSpec,
  position: Pick<Vector3, "x" | "y" | "z">, quaternion: Quaternion, mode: PocketTransformMode,
): PocketTransformPatch | null {
  const top = resolvePocketDepth(spec, original.depth).infillTopZ;
  const angles = new Euler().setFromQuaternion(quaternion, "ZYX");
  const tilt = { xDeg: tidy(angles.x / RAD), yDeg: tidy(angles.y / RAD) };
  const zOffsetMm = tidy(position.z - top);
  if (![position.x, position.y, zOffsetMm, angles.x, angles.y, angles.z].every(Number.isFinite)
    || Math.abs(zOffsetMm) > 300 || Math.abs(tilt.xDeg) > 89 || Math.abs(tilt.yDeg) > 89
    || pocketAxis({ tilt, rotationDeg: 0 }).z < 0.01) return null;
  const patch: PocketTransformPatch = {
    position: { x: tidy(position.x), y: tidy(position.y) }, zOffsetMm,
    rotationDeg: original.rotationDeg, tilt: original.tilt, depth: original.depth, split: original.split,
  };
  if (mode === "translate") return patch;
  patch.rotationDeg = tidy(angles.z / RAD);
  patch.tilt = tilt;
  const split = original.split ? resolvePocketSplit(shape.outlineMm, original.split.boundary) : null;
  const freeze = (depth: DepthSpec, index: number): DepthSpec => {
    if (depth.mode !== "remaining") return depth;
    const resolved = resolvePlacedPocketDepth(spec, depth, { outlineMm: split?.regions?.[index] ?? shape.outlineMm }, original);
    return { mode: "mm", value: resolved.axialDepthMm! };
  };
  patch.depth = original.split ? original.depth : freeze(original.depth, 0);
  if (original.split) patch.split = { ...original.split, depths: [freeze(original.split.depths[0], 0), freeze(original.split.depths[1], 1)] };
  if ((patch.split?.depths ?? [patch.depth]).some(d => d.mode === "mm" && d.value <= 0)) return null;
  return patch;
}

/** Selection uses the same mouth transform as Layout, including interior holes. */
export function pickPocketAtTop(pockets: readonly EditablePocket[], point: Point): string | null {
  for (let i = pockets.length - 1; i >= 0; i--) {
    const { cutout, shape } = pockets[i];
    if (pointInOutline(transformOutlinePlacement(shape.outlineMm, cutout), point)) return cutout.id;
  }
  return null;
}

/** Nominal opening and seat edges for an immediate, kernel-free drag preview. */
export function pocketTransformWires({ cutout, shape }: EditablePocket, spec: BinSpec): PocketWire[] {
  const top = resolvePocketDepth(spec, cutout.depth).infillTopZ;
  const anchorZ = top + (cutout.zOffsetMm ?? 0);
  const axis = pocketAxis(cutout);
  const split = cutout.split ? resolvePocketSplit(shape.outlineMm, cutout.split.boundary) : null;
  const regions = split?.regions ?? [shape.outlineMm];
  const wires: PocketWire[] = [];
  regions.forEach((outline, index) => {
    const depth = cutout.split?.depths[index] ?? cutout.depth;
    const resolved = resolvePlacedPocketDepth(spec, depth, { outlineMm: outline }, cutout);
    for (const part of outline) for (const ring of [part.outer, ...part.holes]) {
      if (!ring.length) continue;
      const floor: PocketWire = [], mouth: PocketWire = [];
      for (const point of ring) {
        const v = rotatePocketVector({ x: point.x * cutout.scaleX * (cutout.mirrored ? -1 : 1), y: point.y * cutout.scaleY, z: 0 }, cutout);
        const toTop = (top - anchorZ - v.z) / Math.max(0.01, axis.z);
        const toFloor = resolved.axialDepthMm === null ? (-anchorZ - v.z) / Math.max(0.01, axis.z) : -resolved.axialDepthMm;
        const at = (t: number): [number, number, number] => [cutout.position.x + v.x + axis.x * t, cutout.position.y + v.y + axis.y * t, anchorZ + v.z + axis.z * t];
        mouth.push(at(toTop)); floor.push(at(toFloor));
      }
      wires.push([...mouth, mouth[0]], [...floor, floor[0]]);
      // Sparse struts keep traced outlines readable while dragging.
      for (let i = 0; i < ring.length; i += Math.max(1, Math.ceil(ring.length / 8))) wires.push([mouth[i], floor[i]]);
    }
  });
  return wires;
}
