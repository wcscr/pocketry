import { describe, expect, it } from "vitest";
import { createBasicPocket } from "./basic-shape";
import { objectRef, type EditableObject } from "./object-arrangement";
import { commonSelectionValue, selectionPropertyEdits } from "./selection-properties";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

const spec = parseBinSpec({ gridX: 6, gridY: 4, heightUnits: 6 });
const pockets: EditableObject[] = [10, 20].map((depth, i) => {
  const pocket = createBasicPocket("rectangle", { x: i * 20 - 5, y: -5 }, { x: i * 20 + 5, y: 5 }, `p${i}`)!;
  return { kind: "pocket", ...pocket, cutout: { ...pocket.cutout, depth: { mode: "mm", value: depth }, clearanceMm: i * 0.2 } };
});
const finger: EditableObject = { kind: "finger", hole: fingerHoleSchema.parse({ id: "f", center: { x: 0, y: 15 }, diameterMm: 10, depthMm: 8 }) };

describe("selection property edits", () => {
  it("shows mixed values and edits only the requested property and object type", () => {
    const all = [...pockets, finger];
    expect(commonSelectionValue(pockets, "depth")).toBeNull();
    const edits = selectionPropertyEdits(all, all.map(objectRef), "pocket", "depth", 16, spec);
    expect(edits.cutouts.map(c => c.depth)).toEqual([{ mode: "mm", value: 16 }, { mode: "mm", value: 16 }]);
    expect(edits.cutouts.map(c => c.clearanceMm)).toEqual([0, 0.2]);
    expect(edits.fingerHoles).toEqual([finger.hole]);
  });
  it("updates both split sections while preserving their boundary", () => {
    const first = pockets[0]; if (first.kind !== "pocket") throw new Error("Expected pocket");
    const cutout = { ...first.cutout, split: { boundary: [{ x: 0, y: -5 }, { x: 0, y: 5 }], depths: [
      { mode: "mm" as const, value: 10 }, { mode: "mm" as const, value: 12 },
    ] as [{ mode: "mm"; value: number }, { mode: "mm"; value: number }] } };
    const objects: EditableObject[] = [{ ...first, cutout }, pockets[1]];
    const edits = selectionPropertyEdits(objects, objects.map(objectRef), "pocket", "depth", 14, spec);
    expect(edits.cutouts[0].split).toEqual({ ...cutout.split, depths: [{ mode: "mm", value: 14 }, { mode: "mm", value: 14 }] });
  });
  it("propagates to linked copies and validates unselected tilted copies atomically", () => {
    const source = pockets[0]; if (source.kind !== "pocket") throw new Error("Expected pocket");
    const first: EditableObject = { ...source, cutout: { ...source.cutout, designLink: { id: "link", tilt: false } } };
    const second: EditableObject = { ...source, cutout: { ...first.cutout, id: "linked", tilt: { xDeg: 45, yDeg: 0 } } };
    const all = [first, second];
    expect(selectionPropertyEdits(all, [objectRef(first)], "pocket", "depth", 15, spec).cutouts[1].depth).toEqual({ mode: "mm", value: 15 });
    // A shallow cut fits the flat source but leaves the tilted copy above the surface.
    expect(selectionPropertyEdits([first], [objectRef(first)], "pocket", "depth", 1, spec).cutouts[0].depth).toEqual({ mode: "mm", value: 1 });
    expect(() => selectionPropertyEdits(all, [objectRef(first)], "pocket", "depth", 1, spec)).toThrow("does not fit");
    expect(first.cutout.depth).toEqual({ mode: "mm", value: 10 });
  });
  it("rejects invalid values and excessive finger-access depth without changing the document", () => {
    expect(() => selectionPropertyEdits([finger], [objectRef(finger)], "finger", "depth", 80, spec)).toThrow("limit");
    expect(() => selectionPropertyEdits(pockets, pockets.map(objectRef), "pocket", "topFilletMm", NaN, spec)).toThrow("finite");
    expect(() => selectionPropertyEdits(pockets, pockets.map(objectRef), "pocket", "clearanceMm", 3, spec)).toThrow("Clearance");
    expect(finger.hole.depthMm).toBe(8);
  });
});
