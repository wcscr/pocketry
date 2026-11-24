import { describe, expect, it } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "./cutout";
import { parseBinSpec } from "./types";
import { shadowInlayGapSchema, shadowInlayUnavailableReason } from "./shadow-inlay";

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6 });
const shape: TracedShape = { id: "tool", name: "Tool", outlineMm: [],
  bboxMm: { minX: -10, maxX: 10, minY: -5, maxY: 5 }, pointCount: 0, sourceMmPerPx: 1 };
const cutout = parseCutoutPlacement({ id: "pocket", shapeId: "tool", position: { x: 0, y: 0 }, depth: { mode: "mm", value: 10 } });

describe("shadow inlay eligibility", () => {
  it("accepts a seated pocket and limits thickness to available tool depth", () => {
    expect(shadowInlayUnavailableReason(spec, shape, cutout, 0.6)).toBeNull();
    expect(shadowInlayUnavailableReason(spec, shape, cutout, 11)).toContain("below the fill surface");
  });
  it.each([
    { role: "hole" as const }, { depthPending: true as const },
    { depth: { mode: "through" as const } }, { tilt: { xDeg: 20, yDeg: 0 } },
    { elevationMm: 0 }, { split: { boundary: [{ x: 0, y: -5 }, { x: 0, y: 5 }] as [{ x: number; y: number }, { x: number; y: number }],
      depths: [cutout.depth, cutout.depth] as [typeof cutout.depth, typeof cutout.depth] } },
  ])("explains why an unsupported seat is unavailable: %j", patch => {
    expect(shadowInlayUnavailableReason(spec, shape, { ...cutout, ...patch }, 0.6)).toEqual(expect.any(String));
  });
  it("requires solid fill", () => {
    expect(shadowInlayUnavailableReason({ ...spec, fill: "none" }, shape, cutout, 0.6)).toContain("solid bin");
  });
  it.each([-0.1, 1.1, NaN, Infinity])("rejects an invalid edge gap %s", gap => {
    expect(shadowInlayGapSchema.safeParse(gap).success).toBe(false);
  });
});
