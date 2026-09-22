import { Euler, Quaternion, type Vector3 } from "three";
import {
  resolvePlacedPocketDepth, resolvePocketDepth, transformOutlinePlacement, transformPointPlacement,
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

/** Preserve old translated cavities while returning an equivalent surface anchor.
 * New gestures edit depth instead of storing a floating Z translation. */
export function surfaceAnchoredPocket(original: CutoutPlacement): CutoutPlacement {
  const offset = original.zOffsetMm ?? 0;
  if (offset === 0) return { ...original, zOffsetMm: undefined };
  const nz = Math.max(0.01, pocketAxis(original).z);
  const depthAtSurface = (depth: DepthSpec): DepthSpec => depth.mode === "through" ? depth
    : depth.mode === "remaining" ? { mode: "remaining", floorThicknessMm: depth.floorThicknessMm + offset }
      : { mode: "mm", value: depth.value - offset / nz };
  return { ...original, position: transformPointPlacement({ x: 0, y: 0 }, original), zOffsetMm: undefined,
    depth: depthAtSurface(original.depth),
    split: original.split ? { ...original.split, depths: [depthAtSurface(original.split.depths[0]), depthAtSurface(original.split.depths[1])] } : undefined };
}

/** The gizmo stays at the top surface in the bin's fixed XYZ frame. Its Z
 * displacement resizes depth; its quaternion is a world-axis rotation delta. */
export function pocketTransformPatch(
  original: CutoutPlacement, shape: TracedShape, spec: BinSpec,
  position: Pick<Vector3, "x" | "y" | "z">, quaternion: Quaternion, mode: PocketTransformMode,
): PocketTransformPatch | null {
  const anchored = surfaceAnchoredPocket(original);
  const top = resolvePocketDepth(spec, anchored.depth).infillTopZ;
  if (![position.x, position.y, position.z, ...quaternion.toArray()].every(Number.isFinite)) return null;
  const patch: PocketTransformPatch = {
    position: { x: tidy(position.x), y: tidy(position.y) }, zOffsetMm: undefined,
    rotationDeg: anchored.rotationDeg, tilt: anchored.tilt, depth: anchored.depth, split: anchored.split,
  };
  const split = anchored.split ? resolvePocketSplit(shape.outlineMm, anchored.split.boundary) : null;
  const resolve = (depth: DepthSpec, index: number) => resolvePlacedPocketDepth(spec, depth,
    { outlineMm: split?.regions?.[index] ?? shape.outlineMm }, anchored);
  if (mode === "translate") {
    const nz = pocketAxis(anchored).z;
    if (nz < 0.01) return null;
    const blind = (anchored.split?.depths ?? [anchored.depth]).map(resolve).filter(p => p.floorZ !== null);
    // Stop before any seat crosses the top or underside. Preserve split-seat
    // differences by applying one common vertical depth change to both seats.
    const lower = Math.max(...blind.map(p => -p.floorZ!));
    const upper = Math.min(...blind.map(p => top - p.highestFloorZ! - 0.5));
    const requestedDz = position.z - top;
    if (Math.abs(requestedDz) > 1e-7 && blind.length && lower > upper) return null;
    const dz = Math.abs(requestedDz) > 1e-7 && blind.length ? Math.max(lower, Math.min(upper, requestedDz)) : 0;
    const resize = (depth: DepthSpec): DepthSpec => depth.mode === "through" ? depth
      : depth.mode === "remaining" ? { mode: "remaining", floorThicknessMm: depth.floorThicknessMm + dz }
        : { mode: "mm", value: depth.value - dz / nz };
    patch.depth = anchored.split ? anchored.depth : resize(anchored.depth);
    if (anchored.split) patch.split = { ...anchored.split, depths: [resize(anchored.split.depths[0]), resize(anchored.split.depths[1])] };
    return patch;
  }
  // Premultiplication rotates around fixed bin axes regardless of prior tilt.
  const rotated = quaternion.clone().multiply(pocketQuaternion(anchored));
  const angles = new Euler().setFromQuaternion(rotated, "ZYX");
  const tilt = { xDeg: tidy(angles.x / RAD), yDeg: tidy(angles.y / RAD) };
  if (Math.abs(tilt.xDeg) > 89 || Math.abs(tilt.yDeg) > 89 || pocketAxis({ tilt, rotationDeg: 0 }).z < 0.01) return null;
  patch.rotationDeg = tidy(angles.z / RAD);
  patch.tilt = tilt;
  const freeze = (depth: DepthSpec, index: number): DepthSpec => depth.mode !== "remaining" ? depth
    : { mode: "mm", value: resolve(depth, index).axialDepthMm! };
  patch.depth = anchored.split ? anchored.depth : freeze(anchored.depth, 0);
  if (anchored.split) patch.split = { ...anchored.split, depths: [freeze(anchored.split.depths[0], 0), freeze(anchored.split.depths[1], 1)] };
  if ((patch.split?.depths ?? [patch.depth]).some(d => d.mode === "mm" && d.value <= 0)) return null;
  return patch;
}

/** Ignore no-op drags and legacy re-anchoring when deciding whether to undo. */
export function pocketTransformChanged(original: CutoutPlacement, patch: PocketTransformPatch, mode: PocketTransformMode): boolean {
  const anchored = surfaceAnchoredPocket(original);
  if (Math.hypot(patch.position.x - anchored.position.x, patch.position.y - anchored.position.y) > 1e-5) return true;
  if (mode === "rotate") return 1 - Math.abs(pocketQuaternion(original).dot(pocketQuaternion({ ...original, ...patch }))) > 1e-12;
  const before = anchored.split?.depths ?? [anchored.depth];
  return (patch.split?.depths ?? [patch.depth]).some((after, i) => {
    const previous = before[i];
    return after.mode === "mm" && previous.mode === "mm" ? Math.abs(after.value - previous.value) > 1e-5
      : after.mode === "remaining" && previous.mode === "remaining" ? Math.abs(after.floorThicknessMm - previous.floorThicknessMm) > 1e-5
        : after.mode !== previous.mode;
  });
}

/** Selection uses the same mouth transform as Layout, including interior holes. */
export function pickPocketAtTop(pockets: readonly EditablePocket[], point: Point): string | null {
  for (let i = pockets.length - 1; i >= 0; i--) {
    const { cutout, shape } = pockets[i];
    if (pointInOutline(transformOutlinePlacement(shape.outlineMm, cutout), point)) return cutout.id;
  }
  return null;
}

/** Actual maximum vertical depth, including both seats and legacy offsets. */
export function pocketVerticalDepthMm({ cutout, shape }: EditablePocket, spec: BinSpec): number | null {
  const split = cutout.split ? resolvePocketSplit(shape.outlineMm, cutout.split.boundary) : null;
  const depths = (cutout.split?.depths ?? [cutout.depth]).map((depth, i) => resolvePlacedPocketDepth(spec, depth,
    { outlineMm: split?.regions?.[i] ?? shape.outlineMm }, cutout).depthMm);
  return depths.some(depth => depth === null) ? null : Math.max(...depths as number[]);
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
