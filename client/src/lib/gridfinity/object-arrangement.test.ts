import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { fingerHoleSchema, parseCutoutPlacement, resolvePlacedPocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "./basic-shape";
import { pocketQuaternion, pocketTransformWires } from "./pocket-transform";
import { applyObjectEdits, arrangeObjects, objectBounds, objectEditsChanged, objectPosition, pickObject, selectionZRange, transformObjects, type EditableObject } from "./object-arrangement";
const spec = parseBinSpec({ gridX: 6, gridY: 4, heightUnits: 6, lip: "none" });
function pocket(id: string, x: number, y = 0, width = 10, height = 12): Extract<EditableObject, { kind: "pocket" }> {
  const basic = createBasicPocket("rectangle", { x: x - width / 2, y: y - height / 2 }, { x: x + width / 2, y: y + height / 2 }, id)!;
  return { kind: "pocket", shape: basic.shape, cutout: { ...basic.cutout, depth: { mode: "mm", value: 20 } } };
}
const finger: EditableObject = { kind: "finger", hole: fingerHoleSchema.parse({ id: "f", kind: "flat-ended-straight", center: { x: 40, y: 18 }, diameterMm: 8, lengthMm: 24, depthMm: 10, rotationDeg: 30 }) };
const mixed = [pocket("a", -40, -10, 8), pocket("b", -5, 8, 16), pocket("c", 25, 0, 5), finger];
const rotate = (axis: "x" | "y" | "z", degrees: number) => new Quaternion().setFromAxisAngle(new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0), degrees * Math.PI / 180);

describe("mixed object arrangement", () => {
  it("moves pockets and access slots by the same XYZ delta without moving mouths off the surface", () => {
    const edits = transformObjects(mixed, spec, new Vector3(7, -9, 2))!;
    const next = applyObjectEdits(mixed, edits);
    next.forEach((o, i) => {
      expect(objectPosition(o).x - objectPosition(mixed[i]).x).toBeCloseTo(7);
      expect(objectPosition(o).y - objectPosition(mixed[i]).y).toBeCloseTo(-9);
    });
    expect(edits.cutouts[0].depth).toEqual({ mode: "mm", value: 18 });
    expect(edits.fingerHoles[0].depthMm).toBe(8);
    expect(edits.cutouts.every(c => !c.zOffsetMm)).toBe(true);
  });
  it("uses a common Z limit instead of moving some members farther than others", () => {
    const [low, high] = selectionZRange(mixed, spec);
    for (const dz of [-1000, 1000]) {
      const edits = transformObjects(mixed, spec, new Vector3(0, 0, dz))!;
      const expected = dz < 0 ? low : high;
      expect(20 - (edits.cutouts[0].depth as { value: number }).value).toBeCloseTo(expected);
      expect(10 - edits.fingerHoles[0].depthMm).toBeCloseTo(expected);
      edits.cutouts.forEach(c => expect(parseCutoutPlacement(c)).toEqual(c));
      expect(fingerHoleSchema.safeParse(edits.fingerHoles[0]).success).toBe(true);
    }
  });
  it("rotates each member in place by default and supports a shared pivot", () => {
    const own = applyObjectEdits(mixed, transformObjects(mixed, spec, new Vector3(), rotate("z", 90))!);
    own.forEach((o, i) => expect(objectPosition(o)).toEqual(objectPosition(mixed[i])));
    expect(own[0].kind === "pocket" && own[0].cutout.rotationDeg).toBeCloseTo(90);
    const pair = [pocket("a", -20), pocket("b", 20)];
    const group = applyObjectEdits(pair, transformObjects(pair, spec, new Vector3(), rotate("z", 90), "selection")!);
    expect(objectPosition(group[0]).x).toBeCloseTo(0); expect(objectPosition(group[0]).y).toBeCloseTo(-20);
    expect(objectPosition(group[1]).y).toBeCloseTo(20);
  });
  it.each(["x", "y"] as const)("rotates pocket seats rigidly about a shared %s axis and reanchors the mouths", axis => {
    const pair = [pocket("a", -10, -5), pocket("b", 10, 5)];
    const rotation = rotate(axis, 5);
    const edits = transformObjects(pair, spec, new Vector3(), rotation, "selection")!;
    expect(edits).not.toBeNull();
    pair.forEach((p, i) => {
      const before = pocketTransformWires(p, spec)[1];
      const after = pocketTransformWires({ ...p, cutout: edits.cutouts[i] }, spec)[1];
      before.forEach((v, n) => {
        const expected = new Vector3(...v).sub(new Vector3(0, 0, 42)).applyQuaternion(rotation).add(new Vector3(0, 0, 42));
        expect(new Vector3(...after[n]).distanceTo(expected)).toBeLessThan(1e-7);
      });
    });
  });
  it("rejects a whole rotation when one pocket hits a floor limit, and rejects mixed XY tilts", () => {
    const shallow = pocket("shallow", 10); shallow.cutout.depth = { mode: "mm", value: 1 };
    expect(transformObjects([pocket("deep", -20), shallow], spec, new Vector3(), rotate("x", 30))).toBeNull();
    expect(transformObjects(mixed, spec, new Vector3(), rotate("y", 10))).toBeNull();
  });
  it.each(["x", "y"] as const)("aligns all three opening features on %s, including tilted and mirrored outlines", axis => {
    const tilted = pocket("tilt", -12, 14); tilted.cutout.tilt = { xDeg: 12, yDeg: 28 }; tilted.cutout.rotationDeg = 31; tilted.cutout.mirrored = true;
    for (const op of ["min", "center", "max"] as const) {
      const objects = [tilted, ...mixed];
      const edits = arrangeObjects(objects, axis, op)!;
      const bounds = applyObjectEdits(objects, edits).map(objectBounds);
      const values = bounds.map(b => axis === "x" ? op === "min" ? b.minX : op === "max" ? b.maxX : (b.minX + b.maxX) / 2
        : op === "min" ? b.minY : op === "max" ? b.maxY : (b.minY + b.maxY) / 2);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(1e-5);
      expect(edits.cutouts.every(c => c.depth.mode === "mm" && c.depth.value === 20)).toBe(true);
    }
  });
  it("aligns to the last selected object without moving the reference", () => {
    const edits = arrangeObjects(mixed, "y", "center", "active")!;
    expect(edits.fingerHoles).toHaveLength(0);
    const target = objectBounds(finger);
    applyObjectEdits(mixed, edits).forEach(o => {
      const b = objectBounds(o); expect((b.minY + b.maxY) / 2).toBeCloseTo((target.minY + target.maxY) / 2, 5);
    });
  });
  it("distributes unequal widths by equal gaps while keeping both endpoints fixed", () => {
    const edits = arrangeObjects(mixed, "x", "gaps")!;
    const bounds = applyObjectEdits(mixed, edits).map(objectBounds);
    const gaps = bounds.slice(1).map((b, i) => b.minX - bounds[i].maxX);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-5);
    expect(edits.cutouts.some(c => c.id === "cutout-a")).toBe(false);
    expect(edits.fingerHoles).toHaveLength(0);
  });
  it("equal centers differs from equal gaps and sorting is independent of selection order", () => {
    const edits = arrangeObjects([...mixed].reverse(), "x", "centers")!;
    const centers = applyObjectEdits(mixed, edits).map(objectBounds).map(b => (b.minX + b.maxX) / 2);
    const distances = centers.slice(1).map((x, i) => x - centers[i]);
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(1e-5);
  });
  it("rejects impossible non-overlapping gaps, insufficient selections and nonfinite transforms", () => {
    expect(arrangeObjects([pocket("a", 0, 0, 20), pocket("b", 2, 0, 20), pocket("c", 4, 0, 20)], "x", "gaps")).toBeNull();
    expect(arrangeObjects(mixed.slice(0, 2), "x", "centers")).toBeNull();
    expect(transformObjects(mixed, spec, new Vector3(NaN, 0, 0))).toBeNull();
    expect(objectEditsChanged(mixed, transformObjects(mixed, spec, new Vector3())!)).toBe(false);
    expect(objectEditsChanged(mixed, { cutouts: [], fingerHoles: [] })).toBe(false);
  });
  it("picks access slots before overlapping pocket mouths, respecting holes", () => {
    const p = pocket("big", 40, 18, 60, 60);
    expect(pickObject([p, finger], { x: 40, y: 18 })).toEqual({ kind: "finger", id: "f" });
    const holed: TracedShape = { ...p.shape, outlineMm: [{ ...p.shape.outlineMm[0], holes: [[{ x: -4, y: -4 }, { x: -4, y: 4 }, { x: 4, y: 4 }, { x: 4, y: -4 }]] }] };
    expect(pickObject([{ ...p, shape: holed }], { x: 40, y: 18 })).toBeNull();
  });
  it("retains schema-valid seats and orientation through 1000 deterministic group moves and Z turns", () => {
    const a = pocket("tilted", -30); a.cutout.tilt = { xDeg: 12, yDeg: -22 };
    let objects: EditableObject[] = [a, pocket("upright", 0), finger];
    for (let i = 0; i < 1000; i++) {
      const delta = new Vector3(Math.sin(i) / 3, Math.cos(i) / 3, Math.sin(i * 7) * 100);
      const moved = transformObjects(objects, spec, delta)!;
      expect(moved).not.toBeNull(); objects = applyObjectEdits(objects, moved);
      const turned = transformObjects(objects, spec, new Vector3(), rotate("z", 5))!;
      expect(turned).not.toBeNull(); objects = applyObjectEdits(objects, turned);
      objects.forEach(o => {
        if (o.kind === "finger") expect(fingerHoleSchema.safeParse(o.hole).success).toBe(true);
        else { expect(parseCutoutPlacement(o.cutout)).toEqual(o.cutout);
          const seat = resolvePlacedPocketDepth(spec, o.cutout.depth, o.shape, o.cutout);
          expect(seat.floorZ!).toBeGreaterThanOrEqual(-1e-8); expect(seat.highestFloorZ!).toBeLessThanOrEqual(41.5 + 1e-8);
          expect(pocketQuaternion(o.cutout).length()).toBeCloseTo(1);
        }
      });
    }
  });
});

it("propagates linked Z depth and optional tilt to unselected copies without moving them", () => {
  const a = pocket("a", -20), b = pocket("b", 20);
  a.cutout.designLink = { id: "group", tilt: true };
  b.cutout = { ...a.cutout, id: b.cutout.id, position: b.cutout.position, rotationDeg: 90 };
  b.shape = a.shape;
  const all = [a, b];
  const move = transformObjects([a], spec, new Vector3(3, 0, 2), undefined, "individual", all)!;
  expect(move.cutouts[1].depth).toEqual({ mode: "mm", value: 18 });
  expect(move.cutouts[1].position).toEqual(b.cutout.position);
  const turn = transformObjects([a], spec, new Vector3(), rotate("y", 15), "individual", all)!;
  expect(turn.cutouts[1].tilt).toEqual(turn.cutouts[0].tilt);
  expect(turn.cutouts[1].rotationDeg).toBe(90);
});

it("rejects a linked depth change that would move an unselected seat through the surface", () => {
  const a = pocket("a", -20, 0, 8, 60), b = pocket("b", 20);
  a.cutout.designLink = { id: "group", tilt: false };
  b.cutout = { ...a.cutout, id: b.cutout.id, position: b.cutout.position, tilt: { xDeg: 25, yDeg: 0 } };
  b.shape = a.shape;
  expect(transformObjects([a], spec, new Vector3(0, 0, 15), undefined, "individual", [a, b])).toBeNull();
});
