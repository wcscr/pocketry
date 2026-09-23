import { expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { createBasicPocket } from "./basic-shape";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { recordTransformOrigins } from "@shared/gridfinity/transform-origins";
import { applyObjectEdits, transformObjects, type EditableObject } from "./object-arrangement";
import { objectTransformOffsets, setObjectTransformOffsets } from "./object-transform-offsets";
import { pocketQuaternion } from "./pocket-transform";

const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 10, lip: "none" });
const basic = createBasicPocket("rectangle", { x: -3, y: -5 }, { x: 3, y: 5 }, "slot")!;
const original: EditableObject = { kind: "pocket", shape: basic.shape, cutout: parseCutoutPlacement({
  ...basic.cutout, depth: { mode: "mm", value: 30 }, tilt: { xDeg: 25, yDeg: 10 }, rotationDeg: 35,
}) };
const origins = recordTransformOrigins({ pockets: [], fingerHoles: [] }, [{ spec, cutouts: [original.cutout], fingerHoles: [] }]);

it("tracks clamped vertical depth changes and restores zero at a pre-existing tilt", () => {
  let current = applyObjectEdits([original], transformObjects([original], spec, new Vector3(7, 4, 100))!);
  const delta = objectTransformOffsets(current[0], spec, origins, "translate");
  expect(delta[0]).toBe(7); expect(delta[1]).toBe(4); expect(delta[2]).toBeGreaterThan(0); expect(delta[2]).toBeLessThan(30);
  const restored = setObjectTransformOffsets(current, spec, origins, "translate", [undefined, undefined, 0], "individual", current)!;
  expect(restored.cutouts[0].depth).toEqual(original.cutout.depth);
  expect(restored.cutouts[0].position).toEqual({ x: 7, y: 4 });
});

it("resets compounded fixed-axis rotation to the original orientation without losing translation", () => {
  const x = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 12 * Math.PI / 180);
  const z = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -18 * Math.PI / 180);
  let current = applyObjectEdits([original], transformObjects([original], spec, new Vector3(8, -2, 0), x)!);
  current = applyObjectEdits(current, transformObjects(current, spec, new Vector3(), z)!);
  const delta = objectTransformOffsets(current[0], spec, origins, "rotate");
  expect(delta[0]).toBeCloseTo(12); expect(delta[1]).toBeCloseTo(0); expect(delta[2]).toBeCloseTo(-18);
  const xReset = setObjectTransformOffsets(current, spec, origins, "rotate", [0, undefined, undefined], "individual", current)!;
  current = applyObjectEdits(current, xReset);
  expect(objectTransformOffsets(current[0], spec, origins, "rotate")[2]).toBeCloseTo(-18);
  const reset = setObjectTransformOffsets(current, spec, origins, "rotate", [0, 0, 0], "individual", current)!;
  expect(Math.abs(pocketQuaternion(reset.cutouts[0]).dot(pocketQuaternion(original.cutout)))).toBeCloseTo(1, 12);
  expect(reset.cutouts[0].position).toEqual({ x: 8, y: -2 });
});

it("keeps linked resets atomic when originals require conflicting depth changes", () => {
  const a = { ...original, cutout: { ...original.cutout, designLink: { id: "copies", tilt: false } } };
  const b = { ...a, cutout: { ...a.cutout, id: "copy", position: { x: 20, y: 0 } } };
  const refs = recordTransformOrigins({ pockets: [], fingerHoles: [] }, [{ spec,
    cutouts: [a.cutout, { ...b.cutout, depth: { mode: "mm", value: 20 } }], fingerHoles: [] }]);
  expect(setObjectTransformOffsets([a, b], spec, refs, "translate", [undefined, undefined, 0], "individual", [a, b])).toBeNull();
});
