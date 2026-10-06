import { rotatePocketVector } from "@shared/gridfinity/pocket-orientation";
import { hasRigidPocket, rigidPocket, rigidPocketVertices, pocketSourceRings } from "@shared/gridfinity/rigid-pocket";
import { applyLinkedEdits } from "@shared/gridfinity/design-links";
import { Quaternion, Vector3 } from "three";
import type { Bounds, Outline, Point } from "@shared/geometry/types";
import { pointInOutline, outlineBounds } from "@/lib/geometry/outline";
import {
  defaultPocketFloorThicknessMm, effectiveFingerHoleDepthMm, fingerHoleFootprintRing, resolvePocketDepth,
  resolvePlacedPocketDepth, transformOutlinePlacement, maximumFingerAccessDepth,
  type CutoutPlacement, type FingerHole,
} from "@shared/gridfinity/cutout";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import type { BinSpec } from "@shared/gridfinity/types";
import { pocketTransformChanged, pocketTransformPatch, surfaceAnchoredPocket, type EditablePocket } from "./pocket-transform";

export type ObjectRef = { kind: "pocket" | "finger"; id: string };
export type EditableObject = ({ kind: "pocket" } & EditablePocket) | { kind: "finger"; hole: FingerHole };
export interface ObjectEdits { cutouts: CutoutPlacement[]; fingerHoles: FingerHole[] }
export type ArrangementAxis = "x" | "y";
export type RotationPivot = "individual" | "selection";
export const objectKey = (ref: ObjectRef): string => `${ref.kind}:${ref.id}`;
export const objectRef = (object: EditableObject): ObjectRef => ({ kind: object.kind, id: object.kind === "pocket" ? object.cutout.id : object.hole.id });
export const sameObject = (a: ObjectRef, b: ObjectRef): boolean => a.kind === b.kind && a.id === b.id;
const identity = { position: { x: 0, y: 0 }, rotationDeg: 0, scaleX: 1, scaleY: 1, mirrored: false };
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

export function objectOutline(object: EditableObject): Outline {
  return object.kind === "pocket" ? transformOutlinePlacement(object.shape.outlineMm, object.cutout)
    : [{ outer: fingerHoleFootprintRing(object.hole, identity, 96), holes: [] }];
}
export function objectBounds(object: EditableObject): Bounds {
  return outlineBounds(objectOutline(object))!;
}
export function objectPosition(object: EditableObject): Point {
  return object.kind === "pocket" ? surfaceAnchoredPocket(object.cutout).position : object.hole.center;
}
export function selectionBounds(objects: readonly EditableObject[]): Bounds {
  const bounds = objects.map(objectBounds);
  return { minX: Math.min(...bounds.map(b => b.minX)), minY: Math.min(...bounds.map(b => b.minY)),
    maxX: Math.max(...bounds.map(b => b.maxX)), maxY: Math.max(...bounds.map(b => b.maxY)) };
}
export function selectionCenter(objects: readonly EditableObject[]): Point {
  if (objects.length === 1) return objectPosition(objects[0]);
  const b = selectionBounds(objects);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
export function pickObject(objects: readonly EditableObject[], point: Point,
  pocketGeometry?: ReadonlyMap<string, { full: Outline }>,
): ObjectRef | null {
  // Access slots take priority where their mouths overlap a pocket.
  const ordered = [...objects.filter(o => o.kind === "pocket"), ...objects.filter(o => o.kind === "finger")];
  const hit = ordered.reverse().find(o => pointInOutline(
    o.kind === "pocket" ? pocketGeometry?.get(o.cutout.id)?.full ?? objectOutline(o) : objectOutline(o), point));
  return hit ? objectRef(hit) : null;
}

/** One common Z interval prevents members of a selection drifting apart at a limit. */
export function selectionZRange(objects: readonly EditableObject[], spec: BinSpec): [number, number] {
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  let lower = -Infinity, upper = Infinity;
  for (const object of objects) {
    if (object.kind === "finger") {
      const depth = effectiveFingerHoleDepthMm(object.hole);
      lower = Math.max(lower, depth - maximumFingerAccessDepth(spec));
      upper = Math.min(upper, depth - 1);
    } else {
      const cutout = object.cutout.profileBottom ? object.cutout : rigidPocket(surfaceAnchoredPocket(object.cutout), object.shape, spec);
      const elevation = cutout.profileBottom?.elevationMm ?? cutout.elevationMm!;
      lower = Math.max(lower, -elevation);
      upper = Math.min(upper, 300 - elevation);
    }
  }
  return [lower, upper];
}

/** All members succeed together. Never persist a partially valid group rotation. */
export function transformObjects(objects: readonly EditableObject[], spec: BinSpec,
  delta: Vector3, rotation: Quaternion = new Quaternion(), pivot: RotationPivot = "individual",
  allObjects: readonly EditableObject[] = objects,
): ObjectEdits | null {
  if (![...delta.toArray(), ...rotation.toArray()].every(Number.isFinite)) return null;
  const rotating = 1 - Math.abs(rotation.w) > 1e-12;
  if (objects.some(o => o.kind === "finger") && (Math.abs(rotation.x) > 1e-8 || Math.abs(rotation.y) > 1e-8)) return null;
  const [lower, upper] = selectionZRange(objects, spec);
  if (Math.abs(delta.z) > 1e-7 && lower > upper) return null;
  const dz = Math.abs(delta.z) > 1e-7 ? Math.max(lower, Math.min(upper, delta.z)) : 0;
  const center = selectionCenter(objects);
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  const result: ObjectEdits = { cutouts: [], fingerHoles: [] };
  for (const object of objects) {
    const start = objectPosition(object);
    const offset = pivot === "selection" && rotating
      ? new Vector3(start.x - center.x, start.y - center.y, 0).applyQuaternion(rotation)
      : new Vector3(start.x - center.x, start.y - center.y, 0);
    let position = { x: center.x + offset.x + delta.x, y: center.y + offset.y + delta.y };
    if (![tidy(position.x), tidy(position.y)].every(Number.isFinite)) return null;
    if (object.kind === "finger") {
      const depth = effectiveFingerHoleDepthMm(object.hole);
      result.fingerHoles.push({ ...object.hole, center: { x: tidy(position.x), y: tidy(position.y) },
        ...(rotating ? { rotationDeg: (object.hole.rotationDeg ?? 0) + 2 * Math.atan2(rotation.z, rotation.w) * 180 / Math.PI } : {}),
        ...(Math.abs(dz) > 1e-7 ? { depthMm: Math.max(1, depth - dz), kind: object.hole.kind === "scoop" ? "deep-scoop" : object.hole.kind } : {}) });
    } else {
      let elevationDelta = offset.z + dz;
      if (rotating && pivot === "selection" && !object.cutout.profileBottom) {
        const rigid = rigidPocket(surfaceAnchoredPocket(object.cutout), object.shape, spec);
        const source = pocketSourceRings(object.shape.outlineMm, rigid, top).flat();
        const minimum = Math.min(...source.map(v => rotatePocketVector(v, rigid).z));
        const sourceOrigin = new Vector3(rigid.position.x - center.x, rigid.position.y - center.y,
          rigid.elevationMm! - minimum - top).applyQuaternion(rotation);
        position = { x: center.x + sourceOrigin.x + delta.x, y: center.y + sourceOrigin.y + delta.y };
        const floor = Math.min(...rigidPocketVertices(object.shape.outlineMm, rigid, top).map(v =>
          new Vector3(v.x - center.x, v.y - center.y, v.z - top).applyQuaternion(rotation).z + top + dz));
        if (floor < -1e-7 || floor > 300) return null;
        elevationDelta = floor - rigid.elevationMm!;
      }
      const patch = pocketTransformPatch(object.cutout, object.shape, spec, { ...position, z: top + dz }, rotation,
        rotating ? "rotate" : "translate", elevationDelta);
      if (!patch) return null;
      result.cutouts.push({ ...object.cutout, ...patch });
    }
  }
  return expandLinkedObjectEdits(allObjects, spec, result);
}

/** Preview and validate every affected linked copy, including unselected ones. */
export function expandLinkedObjectEdits(objects: readonly EditableObject[], spec: BinSpec, edits: ObjectEdits): ObjectEdits | null {
  const expanded = applyLinkedEdits({ cutouts: objects.flatMap(o => o.kind === "pocket" ? [o.cutout] : []),
    fingerHoles: objects.flatMap(o => o.kind === "finger" ? [o.hole] : []) }, edits);
  if (!expanded) return null;
  // Linked orientation is shared; elevation remains placement-local. Initialize
  // an untouched legacy copy in its own frame before applying a rigid rotation.
  expanded.cutouts = expanded.cutouts.map(next => {
    const old = objects.find(o => o.kind === "pocket" && o.cutout.id === next.id);
    const linkedRotation = next.designLink?.tilt
      && edits.cutouts.some(c => c.designLink?.id === next.designLink?.id && hasRigidPocket(c));
    if (hasRigidPocket(next) || old?.kind !== "pocket" || (!next.insertionMode && !linkedRotation)) return next;
    const rigid = rigidPocket(old.cutout, old.shape, spec);
    return { ...next, elevationMm: rigid.elevationMm,
      ...(next.insertionMode ? { zOffsetMm: undefined } : {}) };
  });
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  for (const next of expanded.cutouts) {
    if (!next.designLink) continue;
    const old = objects.find(o => o.kind === "pocket" && o.cutout.id === next.id);
    if (old?.kind !== "pocket" || JSON.stringify(old.cutout) === JSON.stringify(next)) continue;
    if (hasRigidPocket(next)) continue;
    if (next.profileBottom) {
      if (next.profileBottom.elevationMm < defaultPocketFloorThicknessMm(spec) || next.profileBottom.elevationMm > 300) return null;
      continue;
    }
    const split = next.split ? resolvePocketSplit(old.shape.outlineMm, next.split.boundary) : null;
    for (const [i, depth] of (next.split?.depths ?? [next.depth]).entries()) {
      const seat = resolvePlacedPocketDepth(spec, depth, { outlineMm: split?.regions?.[i] ?? old.shape.outlineMm }, next);
      if (seat.floorZ !== null && (seat.floorZ < -1e-7 || seat.highestFloorZ! > top - 0.5 + 1e-7)) return null;
    }
  }
  return expanded;
}

export function applyObjectEdits(objects: readonly EditableObject[], edits: ObjectEdits): EditableObject[] {
  return objects.map(o => o.kind === "pocket" ? { ...o, cutout: edits.cutouts.find(c => c.id === o.cutout.id) ?? o.cutout }
    : { ...o, hole: edits.fingerHoles.find(h => h.id === o.hole.id) ?? o.hole });
}
export function objectEditsChanged(objects: readonly EditableObject[], edits: ObjectEdits): boolean {
  return objects.some(o => {
    if (o.kind === "pocket") {
      const next = edits.cutouts.find(c => c.id === o.cutout.id);
      return next && (pocketTransformChanged(o.cutout, next, "translate") || pocketTransformChanged(o.cutout, next, "rotate"));
    }
    const next = edits.fingerHoles.find(h => h.id === o.hole.id);
    return next && (Math.hypot(next.center.x - o.hole.center.x, next.center.y - o.hole.center.y) > 1e-5 ||
      Math.abs(effectiveFingerHoleDepthMm(next) - effectiveFingerHoleDepthMm(o.hole)) > 1e-5 ||
      Math.abs(Math.sin(((next.rotationDeg ?? 0) - (o.hole.rotationDeg ?? 0)) * Math.PI / 360)) > 1e-7);
  });
}

/** Align nominal visible opening bounds in the bin's fixed XY frame. */
export function arrangeObjects(objects: readonly EditableObject[], axis: ArrangementAxis,
  operation: "min" | "center" | "max" | "centers" | "gaps", reference: "selection" | "active" = "selection",
): ObjectEdits | null {
  if (objects.length < (operation === "centers" || operation === "gaps" ? 3 : 2)) return null;
  const low = axis === "x" ? "minX" : "minY", high = axis === "x" ? "maxX" : "maxY";
  const entries = objects.map(o => { const b = objectBounds(o); return { object: o, min: b[low], max: b[high], center: (b[low] + b[high]) / 2 }; });
  const result: ObjectEdits = { cutouts: [], fingerHoles: [] };
  const move = (object: EditableObject, distance: number) => {
    if (Math.abs(distance) < 1e-7) return;
    const p = objectPosition(object), next = { ...p, [axis]: tidy(p[axis] + distance) };
    if (object.kind === "pocket") result.cutouts.push({ ...surfaceAnchoredPocket(object.cutout), position: next });
    else result.fingerHoles.push({ ...object.hole, center: next });
  };
  if (operation === "centers" || operation === "gaps") {
    entries.sort((a, b) => a.center - b.center || objectKey(objectRef(a.object)).localeCompare(objectKey(objectRef(b.object))));
    const first = entries[0], last = entries.at(-1)!;
    const step = operation === "centers" ? (last.center - first.center) / (entries.length - 1)
      : (last.max - first.min - entries.reduce((sum, e) => sum + e.max - e.min, 0)) / (entries.length - 1);
    // Equal gaps cannot fit inside the fixed endpoints when the objects are too large.
    if (operation === "gaps" && step < -1e-7) return null;
    let edge = first.max + step;
    entries.slice(1, -1).forEach((entry, i) => {
      move(entry.object, operation === "centers" ? first.center + step * (i + 1) - entry.center : edge - entry.min);
      edge += entry.max - entry.min + step;
    });
  } else {
    const active = entries.at(-1)!;
    const min = reference === "active" ? active.min : Math.min(...entries.map(e => e.min));
    const max = reference === "active" ? active.max : Math.max(...entries.map(e => e.max));
    const target = operation === "min" ? min : operation === "max" ? max : (min + max) / 2;
    entries.forEach(e => move(e.object, target - (operation === "min" ? e.min : operation === "max" ? e.max : e.center)));
  }
  return result;
}
