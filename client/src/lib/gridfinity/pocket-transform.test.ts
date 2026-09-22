import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { parseCutoutPlacement, resolvePlacedPocketDepth, transformPointPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { rotatePocketVector } from "@shared/gridfinity/pocket-orientation";
import { pickPocketAtTop, pocketQuaternion, pocketTransformPatch, pocketTransformWires } from "./pocket-transform";

const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6, lip: "none", fill: "solid" });
const shape: TracedShape = { id: "s", name: "Slot", source: "basic-shape", sourceMmPerPx: null, pointCount: 4,
  bboxMm: { minX: -3, maxX: 3, minY: -10, maxY: 10 }, outlineMm: [{ outer: [{ x: -3, y: -10 }, { x: 3, y: -10 }, { x: 3, y: 10 }, { x: -3, y: 10 }], holes: [] }] };
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 5, y: -4 }, zOffsetMm: 2, rotationDeg: 32,
  tilt: { xDeg: 15, yDeg: -25 }, depth: { mode: "remaining", floorThicknessMm: 9 } });

describe("CAD pocket transforms", () => {
  it("uses the same combined orientation as the kernel", () => {
    const point = new Vector3(3, 4, 12);
    const actual = point.clone().applyQuaternion(pocketQuaternion(pocket));
    const expected = rotatePocketVector(point, pocket);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
    expect(actual.z).toBeCloseTo(expected.z, 9);
  });
  it("moves all three axes without changing depth mode, orientation or other pocket settings", () => {
    const patch = pocketTransformPatch(pocket, shape, spec, new Vector3(9, -12, 47), pocketQuaternion(pocket), "translate")!;
    expect(patch).toMatchObject({ position: { x: 9, y: -12 }, zOffsetMm: 5, depth: pocket.depth, tilt: pocket.tilt, rotationDeg: 32 });
    expect(resolvePlacedPocketDepth(spec, pocket.depth, shape, { ...pocket, ...patch }).floorZ).toBeCloseTo(14);
  });
  it("rotates around world or local axes with a fixed pivot and rigid seat depth", () => {
    const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 18);
    const before = resolvePlacedPocketDepth(spec, pocket.depth, shape, pocket);
    for (const rotation of [pocketQuaternion(pocket).premultiply(delta), pocketQuaternion(pocket).multiply(delta)]) {
      const patch = pocketTransformPatch(pocket, shape, spec, new Vector3(5, -4, 44), rotation, "rotate")!;
      expect(patch.depth.mode).toBe("mm");
      expect(patch.position).toEqual(pocket.position);
      expect(patch.zOffsetMm).toBe(2);
      expect(resolvePlacedPocketDepth(spec, patch.depth, shape, { ...pocket, ...patch }).axialDepthMm).toBeCloseTo(before.axialDepthMm!);
      expect(Math.abs(pocketQuaternion({ ...pocket, ...patch }).dot(rotation))).toBeCloseTo(1, 10);
    }
  });
  it("preserves the ordering and geometry of split seats during rotation", () => {
    const split = { ...pocket, tilt: undefined, split: { boundary: [{ x: -3, y: 0 }, { x: 3, y: 0 }], depths: [{ mode: "remaining" as const, floorThicknessMm: 20 }, { mode: "remaining" as const, floorThicknessMm: 8 }] as [{ mode: "remaining"; floorThicknessMm: number }, { mode: "remaining"; floorThicknessMm: number }] } };
    const patch = pocketTransformPatch(split, shape, spec, new Vector3(5, -4, 44), pocketQuaternion(pocket), "rotate")!;
    expect(patch.split?.depths).toEqual([{ mode: "mm", value: 22 }, { mode: "mm", value: 34 }]);
    expect(patch.depth).toEqual(split.depth);
    expect(patch.split?.boundary).toEqual(split.split.boundary);
  });
  it("refuses downward, near-horizontal or unbounded transforms", () => {
    for (const [x, y] of [[90, 0], [0, 90], [89, 89], [180, 0]]) {
      const q = new Quaternion().setFromEuler(new Euler(x * Math.PI / 180, y * Math.PI / 180, 0, "ZYX"));
      expect(pocketTransformPatch(pocket, shape, spec, new Vector3(5, -4, 44), q, "rotate")).toBeNull();
    }
    expect(pocketTransformPatch(pocket, shape, spec, new Vector3(5, -4, 500), pocketQuaternion(pocket), "translate")).toBeNull();
  });
  it("picks the translated mouth and excludes holes, and previews the true seat elevation", () => {
    const centre = transformPointPlacement({ x: 0, y: 0 }, pocket);
    const item = { cutout: pocket, shape };
    expect(pickPocketAtTop([item], centre)).toBe(pocket.id);
    expect(pickPocketAtTop([item], { x: 100, y: 100 })).toBeNull();
    const withHole = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [[{ x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }]] }] };
    expect(pickPocketAtTop([{ ...item, shape: withHole }], centre)).toBeNull();
    const wires = pocketTransformWires(item, spec);
    expect(wires[0].every(p => Math.abs(p[2] - 42) < 1e-8)).toBe(true);
    expect(Math.min(...wires[1].map(p => p[2]))).toBeCloseTo(11, 6);
  });
});
