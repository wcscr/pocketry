import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { fingerHoleSchema, maximumFingerAccessDepth } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "./basic-shape";
import { createPlacementGroup, transformObjects, type EditableObject } from "./object-arrangement";

const spec = parseBinSpec({ gridX: 6, gridY: 6, heightUnits: 10, lip: "none" });
function pocket(id: string, elevationMm: number, x = 0): Extract<EditableObject, { kind: "pocket" }> {
  const basic = createBasicPocket("rectangle", { x: x - 5, y: -5 }, { x: x + 5, y: 5 }, id)!;
  return { kind: "pocket", shape: basic.shape,
    cutout: { ...basic.cutout, depth: { mode: "mm", value: 10 }, elevationMm } };
}
function group(id: string, elevationMm: number) {
  const members = [pocket(`${id}-a`, elevationMm, -15), pocket(`${id}-b`, elevationMm, 15)];
  const placementGroup = createPlacementGroup(members, spec, id);
  return members.map(o => ({ ...o, cutout: { ...o.cutout, placementGroup } }));
}
function finger(depthMm: number): Extract<EditableObject, { kind: "finger" }> {
  return { kind: "finger", hole: fingerHoleSchema.parse({ id: "finger", center: { x: 30, y: 0 },
    kind: "flat-ended-straight", diameterMm: 8, lengthMm: 20, depthMm }) };
}

describe("atomic Z movement with placement groups", () => {
  it.each([{ elevation: 1, delta: -2 }, { elevation: 299, delta: 2 }])(
    "rejects the whole mixed move when an independent pocket at $elevation would clamp", ({ elevation, delta }) => {
      const objects = [...group("group", 10), pocket("independent", elevation)];
      const original = structuredClone(objects);
      expect(transformObjects(objects, spec, new Vector3(3, -4, delta))).toBeNull();
      expect(objects).toEqual(original);
    });

  it.each([{ elevation: 1, delta: -2 }, { elevation: 299, delta: 2 }])(
    "rejects the whole mixed move when the group at $elevation reaches its limit", ({ elevation, delta }) => {
      const objects = [...group("group", elevation), pocket("independent", 10)];
      expect(transformObjects(objects, spec, new Vector3(3, -4, delta))).toBeNull();
    });

  it.each([{ elevation: 1, delta: -1 }, { elevation: 299, delta: 1 }])(
    "moves every member by the same delta up to an independent pocket's $elevation boundary", ({ elevation, delta }) => {
      const objects = [...group("group", 10), pocket("independent", elevation)];
      const edits = transformObjects(objects, spec, new Vector3(3, -4, delta))!;
      expect(edits).not.toBeNull();
      expect(edits.cutouts).toHaveLength(objects.length);
      objects.forEach(({ cutout }) => {
        const next = edits.cutouts.find(c => c.id === cutout.id)!;
        expect(next.elevationMm! - cutout.elevationMm!).toBeCloseTo(delta);
        expect(next.position.x - cutout.position.x).toBeCloseTo(3);
        expect(next.position.y - cutout.position.y).toBeCloseTo(-4);
        if (cutout.placementGroup) {
          expect(next.placementGroup!.pivot.z - cutout.placementGroup.pivot.z).toBeCloseTo(delta);
          expect(next.placementGroup!.origin).toEqual(cutout.placementGroup.origin);
        }
      });
    });

  it.each([{ elevation: 1, delta: -2 }, { elevation: 299, delta: 2 }])(
    "rejects all selected groups if one group at $elevation cannot move", ({ elevation, delta }) => {
      expect(transformObjects([...group("first", 10), ...group("second", elevation)], spec,
        new Vector3(0, 0, delta))).toBeNull();
    });

  it("checks omitted group members from the full document before moving", () => {
    const members = group("group", 10);
    members[1].cutout.elevationMm = 1;
    const independent = pocket("independent", 10);
    expect(transformObjects([members[0], independent], spec, new Vector3(0, 0, -2), new Quaternion(),
      "individual", [...members, independent])).toBeNull();
  });

  it.each([{ depth: 2, delta: 2 }, { depth: maximumFingerAccessDepth(spec) - 1, delta: -2 }])(
    "rejects the mixed move if independent finger access at depth $depth would clamp", ({ depth, delta }) => {
      expect(transformObjects([...group("group", 10), finger(depth)], spec, new Vector3(0, 0, delta))).toBeNull();
    });

  it("retains independent finger depth movement when the entire mixed move fits", () => {
    const members = group("group", 10), hole = finger(2);
    const edits = transformObjects([...members, hole], spec, new Vector3(0, 0, 1))!;
    expect(edits.cutouts.map(c => c.elevationMm)).toEqual([11, 11]);
    expect(edits.fingerHoles[0].depthMm).toBe(1);
  });

  it("keeps groups containing finger access bound to the top surface", () => {
    const objects: EditableObject[] = [pocket("pocket", 10), finger(8)];
    const placementGroup = createPlacementGroup(objects, spec, "mixed");
    const members = objects.map(o => o.kind === "pocket" ? { ...o, cutout: { ...o.cutout, placementGroup } }
      : { ...o, hole: { ...o.hole, placementGroup } });
    expect(transformObjects(members, spec, new Vector3(0, 0, 1))).toBeNull();
    expect(transformObjects(members, spec, new Vector3(3, -4, 0))).not.toBeNull();
  });
});
