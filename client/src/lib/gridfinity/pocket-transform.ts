import { hasRigidPocket, rigidPocket, rigidPocketPreviewWires } from "@shared/gridfinity/rigid-pocket";
import { Euler, Quaternion, type Vector3 } from "three";
import {
  defaultPocketFloorThicknessMm, resolvePlacedPocketDepth, resolvePocketDepth, transformOutlinePlacement, transformPointPlacement,
  type CutoutPlacement, type DepthSpec, type TracedShape,
} from "@shared/gridfinity/cutout";
import { pocketAxis, rotatePocketVector } from "@shared/gridfinity/pocket-orientation";
import { defaultPocketInsertion } from "@shared/gridfinity/pocket-insertion";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import { profilePrisms } from "@shared/gridfinity/profile-bottom";
import type { BinSpec } from "@shared/gridfinity/types";
import { pointInOutline } from "@/lib/geometry/outline";
import type { Point } from "@shared/geometry/types";

export type PocketTransformMode = "translate" | "rotate";
export type PocketTransformPatch = Pick<CutoutPlacement, "position" | "zOffsetMm" | "rotationDeg" | "tilt" | "depth" | "split" | "profileBottom" | "profileRotation" | "elevationMm" | "insertionMode">;
export interface EditablePocket { cutout: CutoutPlacement; shape: TracedShape }
export type PocketWire = [number, number, number][];
const RAD = Math.PI / 180;
const tidy = (value: number) => Math.round(value * 1e6) / 1e6;

/** Three's ZYX Euler convention is the shared Rz * Ry * Rx pocket transform. */
export function pocketQuaternion(pocket: CutoutPlacement): Quaternion {
  const rotation = pocket.profileBottom ? pocket.profileRotation : pocket.tilt;
  return new Quaternion().setFromEuler(new Euler(
    (rotation?.xDeg ?? 0) * RAD, (rotation?.yDeg ?? 0) * RAD, pocket.rotationDeg * RAD, "ZYX",
  ));
}

/** Preserve old translated cavities while returning an equivalent surface anchor.
 * Only legacy placement uses this adapter; rigid pockets already have an elevation. */
export function surfaceAnchoredPocket(original: CutoutPlacement): CutoutPlacement {
  if (original.profileBottom || hasRigidPocket(original)) return original;
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

/** The gizmo uses fixed bin axes. Z moves the generated solid rigidly; a
 * rotation never changes its source dimensions. */
export function pocketTransformPatch(
  original: CutoutPlacement, shape: TracedShape, spec: BinSpec,
  position: Pick<Vector3, "x" | "y" | "z">, quaternion: Quaternion, mode: PocketTransformMode, rigidZOffsetMm = 0,
): PocketTransformPatch | null {
  const anchored = surfaceAnchoredPocket(original);
  const top = resolvePocketDepth(spec, anchored.depth).infillTopZ;
  if (![position.x, position.y, position.z, ...quaternion.toArray()].every(Number.isFinite)) return null;
  const patch: PocketTransformPatch = {
    position: { x: tidy(position.x), y: tidy(position.y) }, zOffsetMm: undefined,
    rotationDeg: anchored.rotationDeg, tilt: anchored.tilt, depth: anchored.depth, split: anchored.split, elevationMm: anchored.elevationMm,
  };
  // Finite inputs can overflow during coordinate rounding. Never let a bad
  // preview become a committed edit: it would also invalidate saved history.
  if (![patch.position.x, patch.position.y].every(Number.isFinite)) return null;
  if (original.profileBottom) {
    patch.zOffsetMm = original.zOffsetMm;
    patch.profileBottom = { ...original.profileBottom };
    patch.profileRotation = original.profileRotation;
    if (mode === "translate") {
      patch.profileBottom.elevationMm = Math.max(defaultPocketFloorThicknessMm(spec), Math.min(300,
        original.profileBottom.elevationMm + position.z - top));
    } else {
      const rotated = quaternion.clone().multiply(pocketQuaternion(original));
      const angles = new Euler().setFromQuaternion(rotated, "ZYX");
      patch.profileRotation = { xDeg: angles.x / RAD, yDeg: angles.y / RAD };
      patch.rotationDeg = angles.z / RAD;
      patch.profileBottom.elevationMm = Math.max(defaultPocketFloorThicknessMm(spec), Math.min(300,
        original.profileBottom.elevationMm + rigidZOffsetMm));
    }
    return patch;
  }
  if (mode === "translate" && Math.abs(position.z - top) < 1e-8) return patch;
  const rigid = rigidPocket(anchored, shape, spec);
  patch.depth = rigid.depth;
  patch.split = rigid.split;
  patch.elevationMm = Math.max(0, Math.min(300, rigid.elevationMm! +
    (mode === "translate" ? position.z - top : rigidZOffsetMm)));
  if (mode === "rotate") {
    const rotated = quaternion.clone().multiply(pocketQuaternion(rigid));
    const angles = new Euler().setFromQuaternion(rotated, "ZYX");
    patch.tilt = { xDeg: angles.x / RAD, yDeg: angles.y / RAD };
    patch.rotationDeg = angles.z / RAD;
    patch.insertionMode = defaultPocketInsertion(original, { ...original, ...patch });
  }
  return patch;
}

/** Ignore no-op drags and legacy re-anchoring when deciding whether to undo. */
export function pocketTransformChanged(original: CutoutPlacement, patch: PocketTransformPatch, mode: PocketTransformMode): boolean {
  const anchored = surfaceAnchoredPocket(original);
  if (Math.hypot(patch.position.x - anchored.position.x, patch.position.y - anchored.position.y) > 1e-5) return true;
  if (mode === "rotate") return 1 - Math.abs(pocketQuaternion(original).dot(pocketQuaternion({ ...original, ...patch }))) > 1e-12;
  if (original.profileBottom) return Math.abs(original.profileBottom.elevationMm - (patch.profileBottom?.elevationMm ?? original.profileBottom.elevationMm)) > 1e-7;
  if (patch.elevationMm !== undefined) return Math.abs(patch.elevationMm - (original.elevationMm ?? 0)) > 1e-7;
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
  if (cutout.profileBottom) return resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout).depthMm;
  const split = cutout.split ? resolvePocketSplit(shape.outlineMm, cutout.split.boundary) : null;
  const depths = (cutout.split?.depths ?? [cutout.depth]).map((depth, i) => resolvePlacedPocketDepth(spec, depth,
    { outlineMm: split?.regions?.[i] ?? shape.outlineMm }, cutout).depthMm);
  return depths.some(depth => depth === null) ? null : Math.max(...depths as number[]);
}

/** Nominal opening and seat edges for an immediate, kernel-free drag preview. */
export function pocketTransformWires({ cutout, shape }: EditablePocket, spec: BinSpec): PocketWire[] {
  const top = resolvePocketDepth(spec, cutout.depth).infillTopZ;
  if (cutout.profileBottom) {
    const wires: PocketWire[] = [];
    for (const { vertices, edges } of profilePrisms(shape.outlineMm, cutout)) {
      const point = (i: number): [number, number, number] => [vertices[i].x, vertices[i].y, vertices[i].z];
      for (const [i, j] of edges) wires.push([point(i), point(j)]);
    }
    return wires;
  }
  if (hasRigidPocket(cutout)) {
    return rigidPocketPreviewWires(shape.outlineMm,cutout,spec)
      .map(wire => wire.map(p => [p.x,p.y,p.z]));
  }
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
