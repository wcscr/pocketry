import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { resolvePocketDepth, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { objectGroupErrors } from "@shared/gridfinity/object-groups";
import { hasRigidPocket, rigidPocket, rigidPocketVertices } from "@shared/gridfinity/rigid-pocket";
import { parseBinSpec, type BinSpec } from "@shared/gridfinity/types";
import { validateLayout } from "@shared/gridfinity/validate";
import { loadLabeledSample } from "@/lib/project/sample-labels.test-support";
import { createBasicPocket } from "./basic-shape";
import { applyObjectEdits, createPlacementGroup, selectionCenter, transformObjects, type EditableObject } from "./object-arrangement";
import { setObjectTransformOffsets } from "./object-transform-offsets";
import { pocketQuaternion } from "./pocket-transform";

// An XY move or a turn about the bin's Z axis changes no height. These checks
// keep surface-anchored pockets surface-anchored, so an unchanged floor is not
// held to the stricter minimum for rigid (elevation) pockets.

type Pocket = Extract<EditableObject, { kind: "pocket" }>;
const Z = new Vector3(0, 0, 1);
const turn = (deg: number) => new Quaternion().setFromAxisAngle(Z, deg * Math.PI / 180);

const floorCodes = new Set(["too-deep", "too-shallow", "floor-too-thin", "floor-in-base"]);
/** Floor and depth findings. A rotation may also move an object past the
 * footprint; those wall/bounds checks are unrelated to the pocket floor. */
function floorIssues(spec: BinSpec, objects: readonly EditableObject[]): string[] {
  const shapes = new Map(objects.flatMap(o => o.kind === "pocket" ? [[o.shape.id, o.shape] as const] : []));
  return validateLayout(spec, objects.flatMap(o => o.kind === "pocket" ? [o.cutout] : []), shapes,
    objects.flatMap(o => o.kind === "finger" ? [o.hole] : [])).filter(issue => floorCodes.has(issue.code)).map(issue => issue.message);
}
function group(objects: readonly EditableObject[], spec: BinSpec): EditableObject[] {
  const frame = createPlacementGroup(objects, spec, "group");
  return objects.map(o => o.kind === "pocket" ? { ...o, cutout: { ...o.cutout, placementGroup: frame } } : { ...o, hole: { ...o.hole, placementGroup: frame } });
}
/** Everything except the planar pose: depth model, anchor, elevation, tilt and links. */
const depthModel = ({ position, rotationDeg, placementGroup, ...rest }: CutoutPlacement) => rest;
function expectDepthModelsKept(before: readonly EditableObject[], after: readonly EditableObject[]): void {
  after.forEach((moved, i) => {
    const original = before[i];
    if (moved.kind !== "pocket" || original.kind !== "pocket") return;
    expect(hasRigidPocket(moved.cutout)).toBe(hasRigidPocket(original.cutout));
    expect(depthModel(moved.cutout)).toEqual(depthModel(original.cutout));
  });
}

// Wiha floors sit at 6.99 mm and DeWalt at 6.3 mm: valid surface-anchored
// pockets, but below the 7 mm minimum enforced on rigid pockets.
describe.each(["wiha-40mm-drivers", "dewalt-right-angle-tools"])("%s sample", slug => {
  const { project } = loadLabeledSample(slug);
  const shapes = new Map(project.shapes.map(shape => [shape.id, shape]));
  const pockets: EditableObject[] = project.cutouts.map(cutout => ({ kind: "pocket", cutout, shape: shapes.get(cutout.shapeId)! }));
  const fingers: EditableObject[] = project.fingerHoles.map(hole => ({ kind: "finger", hole }));
  const groupCases = [
    { mode: "translate", values: [undefined, -5, undefined] },
    { mode: "translate", values: [undefined, -3, undefined] },
    { mode: "rotate", values: [undefined, undefined, 15] },
    { mode: "rotate", values: [undefined, undefined, 180] },
  ] as const;
  for (const withFingers of [false, true]) {
    it.each(groupCases)(`keeps floors valid after a group $mode of $values (finger access grouped: ${withFingers})`, ({ mode, values }) => {
      const grouped = group(withFingers ? [...pockets, ...fingers] : pockets, project.spec);
      const others = withFingers ? [] : fingers;
      expect(floorIssues(project.spec, [...grouped, ...others])).toEqual([]);
      const edits = setObjectTransformOffsets(grouped, project.spec, project.transformOrigins, mode, values, "individual", grouped, project.shapes);
      expect(edits).not.toBeNull();
      const moved = applyObjectEdits(grouped, edits!);
      expect(floorIssues(project.spec, [...moved, ...others])).toEqual([]);
      expect(objectGroupErrors({ cutouts: edits!.cutouts, fingerHoles: edits!.fingerHoles })).toEqual([]);
      expectDepthModelsKept(grouped, moved);
    });
  }

  it.each([15, 180].flatMap(angle => [
    { angle, pivot: "individual", all: false },
    { angle, pivot: "individual", all: true },
    { angle, pivot: "selection", all: true },
  ] as const))("keeps floors valid after an ungrouped Rotate Z by $angle (all pockets: $all, pivot: $pivot)", ({ angle, pivot, all }) => {
    const objects = [...pockets, ...fingers], selected = all ? pockets : pockets.slice(0, 1);
    expect(floorIssues(project.spec, objects)).toEqual([]);
    const edits = setObjectTransformOffsets(selected, project.spec, project.transformOrigins, "rotate", [undefined, undefined, angle], pivot, objects, project.shapes);
    expect(edits).not.toBeNull();
    expect(edits!.cutouts).toHaveLength(selected.length);
    const moved = applyObjectEdits(objects, edits!);
    expect(floorIssues(project.spec, moved)).toEqual([]);
    expectDepthModelsKept(objects, moved);
  });
});

const spec = parseBinSpec({ gridX: 6, gridY: 6, heightUnits: 4, lip: "none" });
const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
function pocket(id: string, x: number, patch: Partial<CutoutPlacement> = {}): Pocket {
  const basic = createBasicPocket("rectangle", { x: x - 5, y: -8 }, { x: x + 5, y: 8 }, id)!;
  return { kind: "pocket", shape: basic.shape, cutout: { ...basic.cutout, depth: { mode: "mm", value: top - 6.5 }, ...patch } };
}
/** Legacy floors 6.5 mm above the underside, plus an established rigid pocket. */
const pockets = () => [
  pocket("plain", -15),
  pocket("tilted", 15, { rotationDeg: 20, tilt: { xDeg: 10, yDeg: -5 }, zOffsetMm: -1 }),
  pocket("rigid", 0, { rotationDeg: -30, tilt: { xDeg: 15, yDeg: 5 }, elevationMm: 9, insertionMode: "axis" }),
];
const vertices = (o: Pocket) => rigidPocketVertices(o.shape.outlineMm, rigidPocket(o.cutout, o.shape, spec), top).map(p => new Vector3(p.x, p.y, p.z));
/** Surface-anchored and rigid solids follow one rigid transform about a vertical axis. */
function expectRigidTurn(before: Pocket, after: Pocket, pivot: Vector3, rotation: Quaternion, delta: Vector3): void {
  vertices(before).forEach((v, j) => expect(vertices(after)[j].distanceTo(v.sub(pivot).applyQuaternion(rotation).add(pivot).add(delta))).toBeLessThan(1e-5));
  expect(Math.abs(pocketQuaternion(after.cutout).dot(rotation.clone().multiply(pocketQuaternion(before.cutout))))).toBeCloseTo(1, 10);
}
const planarCases = [
  { name: "XY move", delta: new Vector3(4, -5, 0), angle: 0 },
  { name: "15° Z rotation", delta: new Vector3(), angle: 15 },
  { name: "180° Z rotation", delta: new Vector3(), angle: 180 },
  { name: "XY move with Z rotation", delta: new Vector3(-3, 2, 0), angle: -70 },
];

describe("planar group transforms keep each pocket's depth model", () => {
  it.each(planarCases)("keeps elevation and depth and moves the solid rigidly for a $name", ({ delta, angle }) => {
    const before = group(pockets(), spec) as Pocket[], frame = before[0].cutout.placementGroup!;
    const rotation = turn(angle), pivot = new Vector3(frame.pivot.x, frame.pivot.y, frame.pivot.z);
    expect(floorIssues(spec, before)).toEqual([]);
    const edits = transformObjects(before, spec, delta, rotation)!;
    expect(edits).not.toBeNull();
    const after = applyObjectEdits(before, edits) as Pocket[];
    expect(floorIssues(spec, after)).toEqual([]);
    expectDepthModelsKept(before, after);
    after.forEach((moved, i) => {
      expectRigidTurn(before[i], moved, pivot, rotation, delta);
      expect(moved.cutout.placementGroup!.pivot.x).toBeCloseTo(frame.pivot.x + delta.x, 6);
      expect(moved.cutout.placementGroup!.pivot.y).toBeCloseTo(frame.pivot.y + delta.y, 6);
      expect(moved.cutout.placementGroup!.pivot.z).toBe(frame.pivot.z);
      expect(Math.abs(new Quaternion(...moved.cutout.placementGroup!.rotation).dot(rotation))).toBeCloseTo(1, 10);
    });
    expect(objectGroupErrors({ cutouts: after.map(o => o.cutout), fingerHoles: [] })).toEqual([]);
  });

  it("still materializes elevation for Z moves and X/Y rotations", () => {
    const before = group(pockets(), spec) as Pocket[];
    const raised = transformObjects(before, spec, new Vector3(0, 0, 1))!;
    expect(raised.cutouts.map(c => c.elevationMm)).toEqual(before.map(o => expect.closeTo(rigidPocket(o.cutout, o.shape, spec).elevationMm! + 1, 6)));
    const tilted = transformObjects(before, spec, new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.1))!;
    expect(tilted.cutouts.every(hasRigidPocket)).toBe(true);
  });
});

describe("ungrouped Z rotations keep each pocket's depth model", () => {
  it.each(planarCases.filter(c => c.angle !== 0).flatMap(c => (["individual", "selection"] as const).map(pivot => ({ ...c, pivot }))))(
    "keeps elevation and depth and turns the solid rigidly for a $name about the $pivot pivot", ({ delta, angle, pivot }) => {
      const before = pockets(), rotation = turn(angle), center = selectionCenter(before);
      expect(floorIssues(spec, before)).toEqual([]);
      const edits = transformObjects(before, spec, delta, rotation, pivot)!;
      expect(edits).not.toBeNull();
      const after = applyObjectEdits(before, edits) as Pocket[];
      expect(floorIssues(spec, after)).toEqual([]);
      expectDepthModelsKept(before, after);
      after.forEach((moved, i) => {
        const origin = pivot === "individual" ? before[i].cutout.position : center;
        expectRigidTurn(before[i], moved, new Vector3(origin.x, origin.y, 0), rotation, delta);
      });
    });

  it("still materializes elevation for X/Y rotations", () => {
    const tilted = transformObjects(pockets(), spec, new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1))!;
    expect(tilted.cutouts.every(hasRigidPocket)).toBe(true);
  });
});
