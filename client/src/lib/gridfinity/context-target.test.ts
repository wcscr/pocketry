import { expect, it } from "vitest";
import { parseCutoutPlacement, fingerHoleSchema, type TracedShape } from "@shared/gridfinity/cutout";
import type { EditableObject } from "./object-arrangement";
import { pickBinContextTarget } from "./context-target";
const shape: TracedShape = { id: "shape", name: "Frame", sourceMmPerPx: 1, pointCount: 8,
  bboxMm: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, outlineMm: [{
    outer: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }],
    holes: [[{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: -2 }]],
  }] };
const pocket: EditableObject = { kind: "pocket", shape, cutout: parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 20, y: 10 }, rotationDeg: 90 }) };
it("targets a retained-material hole through its owner and preserves ordinary object picking", () => {
  expect(pickBinContextTarget([pocket], { x: 20, y: 10 })).toEqual({ kind: "hole", id: "p", shapeId: "shape", ref: { shapeIndex: 0, ringIndex: 0 } });
  expect(pickBinContextTarget([pocket], { x: 25, y: 10 })).toEqual({ kind: "pocket", id: "p" });
  expect(pickBinContextTarget([pocket], { x: -50, y: 10 })).toBeNull();
});
it("keeps an overlapping finger-access target above a retained-material hole", () => {
  const finger: EditableObject = { kind: "finger", hole: fingerHoleSchema.parse({ id: "f", center: { x: 20, y: 10 }, diameterMm: 6 }) };
  expect(pickBinContextTarget([pocket, finger], { x: 20, y: 10 })).toEqual({ kind: "finger", id: "f" });
});
