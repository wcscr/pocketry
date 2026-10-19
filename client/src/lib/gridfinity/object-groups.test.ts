import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { parseBinSpec } from "@shared/gridfinity/types";
import { fingerHoleSchema, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { applyLinkedEdits, designLinkErrors } from "@shared/gridfinity/design-links";
import { expandGroupSelection, objectGroupErrors } from "@shared/gridfinity/object-groups";
import { rigidPocket, rigidPocketVertices } from "@shared/gridfinity/rigid-pocket";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { createBasicPocket } from "./basic-shape";
import { applyObjectEdits, createPlacementGroup, objectRef, transformObjects, type EditableObject } from "./object-arrangement";
import { pocketQuaternion } from "./pocket-transform";
import { objectTransformOffsets, setObjectTransformOffsets } from "./object-transform-offsets";

const spec = parseBinSpec({ gridX: 6, gridY: 6, heightUnits: 10, lip: "none" });
const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
function pocket(id: string, x: number, y: number, angle = 0): Extract<EditableObject, { kind: "pocket" }> {
  const basic = createBasicPocket("rectangle", { x: x - 5, y: y - 8 }, { x: x + 5, y: y + 8 }, id)!;
  return { kind: "pocket", shape: basic.shape, cutout: { ...basic.cutout, depth: { mode: "mm", value: 12 }, rotationDeg: angle } };
}
function grouped() {
  const pair = [pocket("a", -15, -8), pocket("b", 15, 8, 20)];
  const group = createPlacementGroup(pair, spec, "g");
  return pair.map(o => ({ ...o, cutout: { ...o.cutout, placementGroup: group } }));
}
const doc = (objects: readonly EditableObject[]) => ({ spec,
  cutouts: objects.flatMap(o => o.kind === "pocket" ? [o.cutout] : []),
  fingerHoles: objects.flatMap(o => o.kind === "finger" ? [o.hole] : []),
});
const vertices = (object: Extract<EditableObject, { kind: "pocket" }>) => rigidPocketVertices(object.shape.outlineMm, rigidPocket(object.cutout, object.shape, spec), top).map(p => new Vector3(p.x, p.y, p.z));

describe("persistent placement groups", () => {
  it("does not materialize or move members for a zero transform", () => {
    const pair = grouped();
    expect(transformObjects(pair, spec, new Vector3())!.cutouts).toEqual(pair.map(o => o.cutout));
  });
  it("uses the gesture baseline when allObjects contains the previous live preview", () => {
    const pair = grouped();
    const first = transformObjects(pair, spec, new Vector3(4, 0, 0))!;
    const preview = applyObjectEdits(pair, first);
    const next = transformObjects(pair, spec, new Vector3(7, 0, 0), new Quaternion(), "individual", preview)!;
    expect(next.cutouts.map(c => c.position.x)).toEqual(pair.map(o => o.cutout.position.x + 7));
    expect(next.cutouts[0].placementGroup!.pivot.x).toBeCloseTo(pair[0].cutout.placementGroup.pivot.x + 7);
  });
  it.each(["x", "y", "z"] as const)("rotates every vertex and orientation about the same fixed %s pivot", axis => {
    const pair = grouped(), frame = pair[0].cutout.placementGroup;
    const pivot = new Vector3(frame.pivot.x, frame.pivot.y, frame.pivot.z);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0), Math.PI / 2);
    const edits = transformObjects(pair, spec, new Vector3(), rotation)!;
    expect(edits).not.toBeNull();
    pair.forEach((before, index) => {
      const after = { ...before, cutout: edits.cutouts[index] };
      vertices(before).forEach((v, i) => expect(vertices(after)[i].distanceTo(v.sub(pivot).applyQuaternion(rotation).add(pivot))).toBeLessThan(1e-5));
      expect(Math.abs(pocketQuaternion(after.cutout).dot(rotation.clone().multiply(pocketQuaternion(before.cutout))))).toBeCloseTo(1, 10);
      expect(after.cutout.placementGroup!.pivot).toEqual(frame.pivot);
    });
    expect(objectGroupErrors(edits)).toEqual([]);
  });

  it("keeps the pivot fixed through repeated compound rotations and geometry edits", () => {
    let objects: EditableObject[] = grouped();
    const original = objects, rotation = new Quaternion().setFromEuler(new Euler(0.2, -0.3, 0.5));
    for (let i = 0; i < 10; i++) objects = applyObjectEdits(objects, transformObjects(objects, spec, new Vector3(), rotation)!);
    for (let i = 0; i < 10; i++) objects = applyObjectEdits(objects, transformObjects(objects, spec, new Vector3(), rotation.clone().invert())!);
    original.forEach((before, i) => {
      if (before.kind !== "pocket" || objects[i].kind !== "pocket") throw new Error("pocket fixture");
      const after = objects[i] as Extract<EditableObject, { kind: "pocket" }>;
      vertices(before).forEach((v, index) => expect(v.distanceTo(vertices(after)[index])).toBeLessThan(1e-4));
    });
    const pair = grouped(), frame = pair[0].cutout.placementGroup;
    pair[0].cutout.scaleX = 2;
    const edits = transformObjects(pair, spec, new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.8))!;
    expect(edits.cutouts[0].placementGroup!.pivot).toEqual(frame.pivot);
  });

  it("uses a shared rotation offset instead of erasing members' relative angles", () => {
    const pair = grouped();
    const edits = setObjectTransformOffsets(pair, spec, undefined, "rotate", [undefined, undefined, 90], "individual", pair)!;
    expect(edits.cutouts.map(c => Math.round(c.rotationDeg))).toEqual([90, 110]);
    const rotated = applyObjectEdits(pair, edits);
    expect(objectTransformOffsets(rotated[1], spec, undefined, "rotate")[2]).toBeCloseTo(90);
    const back = setObjectTransformOffsets(rotated, spec, undefined, "rotate", [undefined, undefined, 0], "individual", rotated)!;
    expect(back.cutouts.map(c => Math.round(c.rotationDeg))).toEqual([0, 20]);
  });

  it("moves grouped members in XYZ without moving an external linked copy", () => {
    const pair = grouped(), outside = pocket("outside", 65, 0);
    outside.shape = pair[0].shape;
    outside.cutout.shapeId = pair[0].shape.id;
    pair[0].cutout.designLink = outside.cutout.designLink = { id: "link", tilt: true };
    const all = [...pair, outside], edits = transformObjects(pair, spec, new Vector3(4, -3, 2), new Quaternion(), "individual", all)!;
    const applied = applyLinkedEdits(doc(all), edits, { placementOnly: edits.placementOnly })!;
    expect(applied.cutouts[2]).toEqual(outside.cutout);
    expect(designLinkErrors(applied)).toEqual([]);
    expect(applied.cutouts[0].elevationMm! - (top - 12)).toBeCloseTo(2);
    expect(applied.cutouts[0].placementGroup!.pivot.z - pair[0].cutout.placementGroup.pivot.z).toBeCloseTo(2);
    const changed = applyLinkedEdits(applied, { cutouts: [{ ...applied.cutouts[0], depth: { mode: "mm", value: 9 } }], fingerHoles: [] })!;
    expect(changed.cutouts[2].depth).toEqual({ mode: "mm", value: 9 });
    expect(changed.cutouts[2].position).toEqual(outside.cutout.position);
    expect(changed.cutouts[1].depth).toEqual(pair[1].cutout.depth);
  });

  it("leaves elevation and tilt independent for geometry links", () => {
    const a = pocket("a", -10, 0), b = { ...a.cutout, id: "b", position: { x: 20, y: 0 } };
    a.cutout.designLink = b.designLink = { id: "l", tilt: true };
    const result = applyLinkedEdits({ cutouts: [a.cutout, b], fingerHoles: [] }, { cutouts: [{ ...a.cutout, elevationMm: 22, tilt: { xDeg: 20, yDeg: 0 } }], fingerHoles: [] })!;
    expect(result.cutouts[1]).toEqual(b);
    expect(designLinkErrors(result)).toEqual([]);
    const finger = fingerHoleSchema.parse({ id: "linked-access", center: { x: 0, y: 0 }, designLink: { id: "access" } });
    expect(transformObjects([{ kind: "finger", hole: finger }], spec, new Vector3(0, 0, 1))).toBeNull();
    const moved = transformObjects([{ kind: "finger", hole: finger }], spec, new Vector3(1, 2, 0))!;
    expect(moved.fingerHoles[0].depthMm).toBe(finger.depthMm);
  });

  it("rejects an entire invalid move and keeps surface-bound finger access upright", () => {
    const pair = grouped();
    expect(transformObjects(pair, spec, new Vector3(0, 0, -100))).toBeNull();
    const hole = fingerHoleSchema.parse({ id: "finger", center: { x: 30, y: 10 }, diameterMm: 8, depthMm: 8 });
    const group = createPlacementGroup([...pair, { kind: "finger", hole }], spec, "mixed");
    const mixed: EditableObject[] = [...pair.map(o => ({ ...o, cutout: { ...o.cutout, placementGroup: group } })), { kind: "finger", hole: { ...hole, placementGroup: group } }];
    expect(transformObjects(mixed, spec, new Vector3(0, 0, 1))).toBeNull();
    expect(transformObjects(mixed, spec, new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.1))).toBeNull();
    expect(transformObjects(mixed, spec, new Vector3(1, 2, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.1))).not.toBeNull();
  });

  it("round-trips groups and history, migrates old poses, and rejects inconsistent frames", () => {
    const pair = grouped(), material = doc(pair), shapes = pair.map(o => o.shape);
    const project = { schemaVersion: PROJECT_SCHEMA_VERSION, ...material, shapes, history: { stack: [{ doc: material, label: "Group objects" }], index: 0 } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))?.cutouts).toEqual(material.cutouts);
    const mismatch = { ...project, cutouts: [pair[0].cutout, { ...pair[1].cutout, placementGroup: { ...pair[1].cutout.placementGroup, pivot: { x: 99, y: 0, z: 10 } } }] };
    expect(parseProjectDoc(mismatch)).toBeNull();
    const legacy = { schemaVersion: 47, ...doc(pair.map(o => ({ ...o, cutout: { ...o.cutout, placementGroup: undefined } }))), shapes };
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.cutouts).toEqual(legacy.cutouts);
    expect(expandGroupSelection(material, [objectRef(pair[0])])).toHaveLength(2);
  });
});
