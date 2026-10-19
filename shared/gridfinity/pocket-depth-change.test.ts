import { describe, expect, it } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "./cutout";
import { parseBinSpec } from "./types";
import { pocketDepthChangePatch } from "./pocket-depth-change";
import { rigidPocket } from "./rigid-pocket";

const shape: TracedShape = { id: "shape", name: "Rectangle", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  outlineMm: [{ outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], holes: [] }] };
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, lip: "none" });
const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 7, y: 0 },
  depth: { mode: "remaining", floorThicknessMm: 2 } });

describe("pocket depth changes", () => {
  it("opens an ordinary surface pocket without freezing its former blind floor", () => {
    const changed = { ...pocket, ...pocketDepthChangePatch(spec, shape, pocket, { mode: "through" }) };
    expect(changed.depth).toEqual({ mode: "through" });
    expect(changed.elevationMm).toBeUndefined(); expect(changed.position).toEqual(pocket.position);
    const moved = rigidPocket(changed, shape, spec);
    expect(moved.elevationMm).toBe(0);
    expect(moved.depth).toEqual({ mode: "through", sourceDepthMm: 42 });
  });

  it("changes only the selected depth of a surface split pocket", () => {
    const split = { ...pocket, split: { boundary: [{ x: 0, y: -5 }, { x: 0, y: 5 }],
      depths: [{ mode: "mm" as const, value: 10 }, { mode: "remaining" as const, floorThicknessMm: 4 }] as [typeof pocket.depth, typeof pocket.depth] } };
    const changed = { ...split, ...pocketDepthChangePatch(spec, shape, split, { mode: "through" }, 1) };
    expect(changed.split!.depths).toEqual([{ mode: "mm", value: 10 }, { mode: "through" }]);
    expect(changed.elevationMm).toBeUndefined(); expect(split.split.depths[1].mode).toBe("remaining");
  });

  it.each([undefined, { xDeg: 20, yDeg: 0 }])("retains a positioned finite object when its protection mode changes, tilt=%j", tilt => {
    const placed = { ...pocket, elevationMm: 12, tilt, depth: { mode: "mm" as const, value: 16 } };
    const changed = { ...placed, ...pocketDepthChangePatch(spec, shape, placed, { mode: "through" }) };
    expect(changed.elevationMm).toBe(12); expect(changed.depth).toEqual({ mode: "through", sourceDepthMm: 16 });
    expect(changed.tilt).toEqual(tilt); expect(changed.position).toEqual(placed.position);
  });
});
