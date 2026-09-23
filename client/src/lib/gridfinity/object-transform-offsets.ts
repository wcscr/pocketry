import { Euler, Quaternion, Vector3 } from "three";
import { effectiveFingerHoleDepthMm, resolvePlacedPocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { pocketAxis } from "@shared/gridfinity/pocket-orientation";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import type { TransformOrigins } from "@shared/gridfinity/transform-origins";
import type { BinSpec } from "@shared/gridfinity/types";
import { pocketQuaternion, surfaceAnchoredPocket, type PocketTransformMode } from "./pocket-transform";
import { applyObjectEdits, objectEditsChanged, expandLinkedObjectEdits, objectPosition, transformObjects, type EditableObject, type ObjectEdits, type RotationPivot } from "./object-arrangement";

const RAD = Math.PI / 180;
export type AxisValues = [number, number, number];
const orientation = (o: EditableObject) => o.kind === "pocket" ? pocketQuaternion(o.cutout)
  : new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (o.hole.rotationDeg ?? 0) * RAD);
const rotationFrom = (values: readonly number[]) => new Quaternion().setFromEuler(new Euler(values[0] * RAD, values[1] * RAD, values[2] * RAD, "ZYX"));
function axialDepth(o: EditableObject, spec: BinSpec): number | null {
  if (o.kind === "finger") return effectiveFingerHoleDepthMm(o.hole);
  const cutout = surfaceAnchoredPocket(o.cutout);
  const split = cutout.split ? resolvePocketSplit(o.shape.outlineMm, cutout.split.boundary) : null;
  for (const [i, depth] of (cutout.split?.depths ?? [cutout.depth]).entries()) {
    const seat = resolvePlacedPocketDepth(spec, depth, { outlineMm: split?.regions?.[i] ?? o.shape.outlineMm }, cutout);
    if (seat.axialDepthMm !== null) return seat.axialDepthMm;
  }
  return null;
}

/** Read actual, including live-preview, offsets from the persisted creation pose. */
export function objectTransformOffsets(object: EditableObject, spec: BinSpec, origins: TransformOrigins | undefined,
  mode: PocketTransformMode, shapes: readonly TracedShape[] = []): AxisValues {
  const pocket = object.kind === "pocket" ? origins?.pockets.find(p => p.cutout.id === object.cutout.id) : undefined;
  const hole = object.kind === "finger" ? origins?.fingerHoles.find(h => h.id === object.hole.id) : undefined;
  const original: EditableObject = pocket && object.kind === "pocket" ? { ...object, cutout: pocket.cutout,
    shape: shapes.find(s => s.id === pocket.cutout.shapeId) ?? object.shape }
    : hole ? { kind: "finger", hole } : object;
  if (mode === "rotate") {
    const relative = orientation(object).multiply(orientation(original).invert());
    const e = new Euler().setFromQuaternion(relative, "ZYX");
    return [e.x / RAD, e.y / RAD, e.z / RAD];
  }
  const start = objectPosition(original), current = objectPosition(object);
  const before = axialDepth(original, pocket?.spec ?? spec), after = axialDepth(object, spec);
  const nz = object.kind === "pocket" ? pocketAxis(object.cutout).z : 1;
  return [current.x - start.x, current.y - start.y, before === null || after === null ? 0 : (before - after) * nz];
}

/** Edit only explicitly entered axes. Mixed values preserve each member's other axes. */
export function setObjectTransformOffsets(selected: readonly EditableObject[], spec: BinSpec, origins: TransformOrigins | undefined,
  mode: PocketTransformMode, values: readonly (number | undefined)[], pivot: RotationPivot,
  allObjects: readonly EditableObject[], shapes: readonly TracedShape[] = []): ObjectEdits | null {
  const changes = selected.map(o => {
    const current = objectTransformOffsets(o, spec, origins, mode, shapes);
    const target = current.map((v, i) => values[i] ?? v);
    return mode === "translate" ? { delta: new Vector3(...target.map((v, i) => v - current[i])), rotation: new Quaternion() }
      : { delta: new Vector3(), rotation: rotationFrom(target).multiply(rotationFrom(current).invert()) };
  });
  if (!changes.length) return { cutouts: [], fingerHoles: [] };
  const common = changes.every(c => c.delta.distanceTo(changes[0].delta) < 1e-7 && 1 - Math.abs(c.rotation.dot(changes[0].rotation)) < 1e-12);
  if (common) return transformObjects(selected, spec, changes[0].delta, changes[0].rotation, pivot, allObjects);
  // A shared rotation requires one common delta; different starting offsets
  // can still be restored individually without pretending they are one rigid group.
  if (mode === "rotate" && pivot === "selection") return null;
  const result: ObjectEdits = { cutouts: [], fingerHoles: [] };
  for (const [i, object] of selected.entries()) {
    const edit = transformObjects([object], spec, changes[i].delta, changes[i].rotation, "individual", [object]);
    if (!edit) return null;
    result.cutouts.push(...edit.cutouts); result.fingerHoles.push(...edit.fingerHoles);
  }
  const expanded = expandLinkedObjectEdits(allObjects, spec, result);
  // Propagation must not override another selected member's requested reset,
  // including a member that was already at zero and needed no design change.
  return expanded && !objectEditsChanged(applyObjectEdits(selected, result), expanded) ? expanded : null;
}
