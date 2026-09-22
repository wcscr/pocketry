import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { parseCutoutPlacement, resolvePlacedPocketDepth, transformPointPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { rotatePocketVector } from "@shared/gridfinity/pocket-orientation";
import { pickPocketAtTop, pocketQuaternion, pocketTransformPatch, pocketTransformWires, surfaceAnchoredPocket, pocketTransformChanged, pocketVerticalDepthMm } from "./pocket-transform";

const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6, lip: "none", fill: "solid" });
const shape: TracedShape = { id: "s", name: "Slot", source: "basic-shape", sourceMmPerPx: null, pointCount: 4,
  bboxMm: { minX: -3, maxX: 3, minY: -10, maxY: 10 }, outlineMm: [{ outer: [{ x: -3, y: -10 }, { x: 3, y: -10 }, { x: 3, y: 10 }, { x: -3, y: 10 }], holes: [] }] };
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 5, y: -4 }, rotationDeg: 32,
  tilt: { xDeg: 15, yDeg: -25 }, depth: { mode: "remaining", floorThicknessMm: 9 } });
const origin = new Vector3(5, -4, 42);
const identity = new Quaternion();

describe("surface-anchored pocket controls", () => {
  it("uses the same combined orientation as the kernel", () => {
    const point = new Vector3(3, 4, 12);
    const actual = point.clone().applyQuaternion(pocketQuaternion(pocket));
    const expected = rotatePocketVector(point, pocket);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
    expect(actual.z).toBeCloseTo(expected.z, 9);
  });
  it("moves XY across the surface and uses Z to resize depth without moving the opening", () => {
    const patch = pocketTransformPatch(pocket, shape, spec, new Vector3(9, -12, 47), identity, "translate")!;
    expect(patch).toMatchObject({ position: { x: 9, y: -12 }, zOffsetMm: undefined, depth: { mode: "remaining", floorThicknessMm: 14 }, tilt: pocket.tilt, rotationDeg: 32 });
    const updated = { ...pocket, ...patch };
    expect(resolvePlacedPocketDepth(spec, patch.depth, shape, updated).floorZ).toBeCloseTo(14);
    const before = transformPointPlacement({ x: 2, y: 3 }, pocket), after = transformPointPlacement({ x: 2, y: 3 }, updated);
    expect(after.x - before.x).toBeCloseTo(4); expect(after.y - before.y).toBeCloseTo(-8);
  });
  it.each([5, -5, 100, -100])("keeps every seat between the surface and underside when moving Z by %s", dz => {
    const fixed = { ...pocket, depth: { mode: "mm" as const, value: 30 } };
    const patch = pocketTransformPatch(fixed, shape, spec, new Vector3(5, -4, 42 + dz), identity, "translate")!;
    const updated = { ...fixed, ...patch };
    const resolved = resolvePlacedPocketDepth(spec, patch.depth, shape, updated);
    expect(resolved.floorZ).toBeGreaterThanOrEqual(-1e-8);
    expect(resolved.highestFloorZ).toBeLessThanOrEqual(41.5 + 1e-8);
    expect(patch.position).toEqual(pocket.position);
    expect(patch.zOffsetMm).toBeUndefined();
    expect(pocketTransformWires({ cutout: updated, shape }, spec).flat().every(p => p[2] <= 42 + 1e-8)).toBe(true);
    if (Math.abs(dz) === 5) {
      const originalFloor = resolvePlacedPocketDepth(spec, fixed.depth, shape, fixed).floorZ!;
      expect(resolved.floorZ! - originalFloor).toBeCloseTo(dz);
    }
  });
  it.each([[1, 0, 0], [0, 1, 0], [0, 0, 1]])("rotates rigidly around fixed bin axis %j without changing local edge lengths", (x, y, z) => {
    const delta = new Quaternion().setFromAxisAngle(new Vector3(x, y, z), Math.PI / 18);
    const patch = pocketTransformPatch(pocket, shape, spec, origin, delta, "rotate")!;
    const expected = pocketQuaternion(pocket).premultiply(delta);
    const updated = { ...pocket, ...patch };
    expect(patch.depth.mode).toBe("mm");
    expect(patch.position).toEqual(pocket.position);
    expect(patch.zOffsetMm).toBeUndefined();
    expect(resolvePlacedPocketDepth(spec, patch.depth, shape, updated).axialDepthMm).toBeCloseTo(resolvePlacedPocketDepth(spec, pocket.depth, shape, pocket).axialDepthMm!);
    expect(Math.abs(pocketQuaternion(updated).dot(expected))).toBeCloseTo(1, 10);
    const seat = pocketTransformWires({ cutout: updated, shape }, spec)[1];
    expect(new Vector3(...seat[0]).distanceTo(new Vector3(...seat[1]))).toBeCloseTo(6, 8);
    expect(new Vector3(...seat[1]).distanceTo(new Vector3(...seat[2]))).toBeCloseTo(20, 8);
  });
  it("re-anchors legacy offsets without changing their openings or seats, including a no-op drag", () => {
    const old = { ...pocket, zOffsetMm: 2 };
    const anchored = surfaceAnchoredPocket(old);
    const before = pocketTransformWires({ cutout: old, shape }, spec);
    const after = pocketTransformWires({ cutout: anchored, shape }, spec);
    after.flat().forEach((point, i) => point.forEach((value, axis) => expect(value).toBeCloseTo(before.flat()[i][axis], 8)));
    const patch = pocketTransformPatch(old, shape, spec, { ...anchored.position, z: 42 }, identity, "translate")!;
    expect(pocketTransformChanged(old, patch, "translate")).toBe(false);
  });
  it("preserves the order and difference of split depths and leaves through cuts alone", () => {
    const split = { ...pocket, tilt: undefined, split: { boundary: [{ x: -3, y: 0 }, { x: 3, y: 0 }], depths: [{ mode: "remaining" as const, floorThicknessMm: 20 }, { mode: "remaining" as const, floorThicknessMm: 8 }] as [{ mode: "remaining"; floorThicknessMm: number }, { mode: "remaining"; floorThicknessMm: number }] } };
    const resized = pocketTransformPatch(split, shape, spec, new Vector3(5, -4, 45), identity, "translate")!;
    expect(pocketVerticalDepthMm({ cutout: { ...split, ...resized }, shape }, spec)).toBeCloseTo(31);
    expect(resized.split?.depths).toEqual([{ mode: "remaining", floorThicknessMm: 23 }, { mode: "remaining", floorThicknessMm: 11 }]);
    const rotated = pocketTransformPatch(split, shape, spec, origin, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 18), "rotate")!;
    expect(rotated.split?.depths).toEqual([{ mode: "mm", value: 22 }, { mode: "mm", value: 34 }]);
    expect(rotated.depth).toEqual(split.depth);
    expect(rotated.split?.boundary).toEqual(split.split.boundary);
    const through = { ...pocket, depth: { mode: "through" as const } };
    const unchanged = pocketTransformPatch(through, shape, spec, new Vector3(5, -4, 200), identity, "translate")!;
    expect(unchanged.depth).toEqual(through.depth);
    expect(pocketTransformChanged(through, unchanged, "translate")).toBe(false);
  });
  it("refuses downward or near-horizontal rotations", () => {
    const upright = { ...pocket, tilt: undefined, rotationDeg: 0 };
    for (const degrees of [90, 180]) {
      expect(pocketTransformPatch(upright, shape, spec, origin, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), degrees * Math.PI / 180), "rotate")).toBeNull();
    }
  });
  it.each([-60, -10, 10, 60])("stops the shallow board rack's X rotation before its seat crosses the opening (%s degrees)", degrees => {
    const rackSpec = { ...spec, heightUnits: 2 };
    const board = { ...shape, outlineMm: [{ outer: [{ x: -1.1, y: -33.75 }, { x: 1.1, y: -33.75 }, { x: 1.1, y: 33.75 }, { x: -1.1, y: 33.75 }], holes: [] }] };
    const slot = { ...pocket, rotationDeg: 0, tilt: { xDeg: 0, yDeg: 45 } };
    const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), degrees * Math.PI / 180);
    expect(pocketTransformPatch(slot, board, rackSpec, new Vector3(5, -4, 14), delta, "rotate")).toBeNull();
  });
  it("keeps the board rack's valid X rotation rigid, planar, and entirely beneath its opening", () => {
    const rackSpec = { ...spec, heightUnits: 2 };
    const board = { ...shape, outlineMm: [{ outer: [{ x: -1.1, y: -33.75 }, { x: 1.1, y: -33.75 }, { x: 1.1, y: 33.75 }, { x: -1.1, y: 33.75 }], holes: [] }] };
    const slot = { ...pocket, rotationDeg: 0, tilt: { xDeg: 0, yDeg: 45 } };
    const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 4 * Math.PI / 180);
    const patch = pocketTransformPatch(slot, board, rackSpec, new Vector3(5, -4, 14), delta, "rotate")!;
    expect(patch).not.toBeNull();
    const [mouth, seat, ...struts] = pocketTransformWires({ shape: board, cutout: { ...slot, ...patch } }, rackSpec);
    expect(mouth.every(p => Math.abs(p[2] - 14) < 1e-8)).toBe(true);
    expect(seat.every(p => p[2] >= 0 && p[2] <= 13.5)).toBe(true);
    expect(struts.every(([top, bottom]) => top[2] > bottom[2])).toBe(true);
    const vertices = seat.map(p => new Vector3(...p));
    const ab = vertices[1].clone().sub(vertices[0]), ad = vertices[3].clone().sub(vertices[0]);
    expect(ab.length()).toBeCloseTo(2.2, 8);
    expect(ad.length()).toBeCloseTo(67.5, 8);
    expect(ab.dot(ad)).toBeCloseTo(0, 8);
    expect(ab.cross(ad).normalize().dot(vertices[2].clone().sub(vertices[0]))).toBeCloseTo(0, 8);
  });
  it("stops a fixed-depth seat from rotating through the underside", () => {
    const deep = { ...pocket, rotationDeg: 0, tilt: undefined, depth: { mode: "mm" as const, value: 41 } };
    const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 18);
    expect(pocketTransformPatch(deep, shape, spec, origin, delta, "rotate")).toBeNull();
  });
  it("checks each split seat but allows through pockets to rotate without a floor limit", () => {
    const split = { ...pocket, rotationDeg: 0, tilt: undefined, split: { boundary: [{ x: -3, y: 0 }, { x: 3, y: 0 }], depths: [{ mode: "mm" as const, value: 1 }, { mode: "mm" as const, value: 1 }] as const } };
    for (const degrees of [-15, 15]) {
      const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), degrees * Math.PI / 180);
      expect(pocketTransformPatch(parseCutoutPlacement(split), shape, spec, origin, delta, "rotate")).toBeNull();
    }
    const through = { ...pocket, depth: { mode: "through" as const } };
    const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3);
    expect(pocketTransformPatch(through, shape, spec, origin, delta, "rotate")).not.toBeNull();
  });
  it("picks the mouth and excludes holes", () => {
    const centre = transformPointPlacement({ x: 0, y: 0 }, pocket);
    const item = { cutout: pocket, shape };
    expect(pickPocketAtTop([item], centre)).toBe(pocket.id);
    expect(pickPocketAtTop([item], { x: 100, y: 100 })).toBeNull();
    const withHole = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [[{ x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }]] }] };
    expect(pickPocketAtTop([{ ...item, shape: withHole }], centre)).toBeNull();
  });
});


it("moving XY does not silently resize a pocket whose tilted seat needs correction", () => {
  const shallow = { ...pocket, depth: { mode: "mm" as const, value: 1 } };
  const patch = pocketTransformPatch(shallow, shape, spec, new Vector3(10, 0, 42), identity, "translate")!;
  expect(patch.position).toEqual({ x: 10, y: 0 });
  expect(patch.depth).toEqual(shallow.depth);
});
