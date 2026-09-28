import { expect, it } from "vitest";
import { parseCutoutPlacement, resolvePlacedPocketDepth, resolvePocketDepth, type CutoutPlacement, type DepthSpec } from "./cutout";
import { adjustPocketsForFillHeight } from "./fill-height-edit";
import { pocketAxis } from "./pocket-orientation";
import { parseBinSpec } from "./types";

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6 });
const pocket = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 3, y: -4 }, depth: { mode: "mm", value: 20 } });
const shape = { outlineMm: [{ outer: [{ x: -2, y: -3 }, { x: 2, y: -3 }, { x: 2, y: 3 }, { x: -2, y: 3 }], holes: [] }] };

it.each(["standard", "none"] as const)("keeps the floor stationary with %s lip and restores depth without drift", lip => {
  const full = { ...spec, lip };
  const floor = resolvePocketDepth(full, pocket.depth).floorZ;
  let cutouts = [pocket], previous = full;
  for (let i = 0; i < 20; i++) for (const fillHeightPercent of [75, 62.5, 80, 100]) {
    const next = { ...full, fillHeightPercent };
    cutouts = adjustPocketsForFillHeight(cutouts, previous, next).cutouts!;
    expect(resolvePocketDepth(next, cutouts[0].depth).floorZ).toBeCloseTo(floor!, 9);
    previous = next;
  }
  expect(cutouts[0].depth).toEqual(pocket.depth);
  expect(cutouts[0].position).toEqual(pocket.position);
});

it("adjusts fixed split sections while retaining remaining-floor and through depths", () => {
  for (const other of [{ mode: "mm", value: 25 }, { mode: "remaining", floorThicknessMm: 7 }, { mode: "through" }] as DepthSpec[]) {
    const cutout = { ...pocket, split: { boundary: [{ x: 0, y: -3 }, { x: 0, y: 3 }], depths: [pocket.depth, other] as [DepthSpec, DepthSpec] } };
    const lowered = { ...spec, fillHeightPercent: 75 };
    const updated = adjustPocketsForFillHeight([cutout], spec, lowered).cutouts![0];
    cutout.split.depths.forEach((depth, index) => {
      const before = resolvePocketDepth(spec, depth).floorZ;
      const after = resolvePocketDepth(lowered, updated.split!.depths[index]).floorZ;
      if (before === null) expect(after).toBeNull();
      else expect(after).toBeCloseTo(before, 9);
    });
  }
});

it("leaves remaining-floor and through-only pockets unchanged", () => {
  const cutouts = [{ ...pocket, depth: { mode: "remaining" as const, floorThicknessMm: 7 } }, { ...pocket, id: "through", depth: { mode: "through" as const } }];
  expect(adjustPocketsForFillHeight(cutouts, spec, { ...spec, fillHeightPercent: 1 }).cutouts).toEqual(cutouts);
});

it("preserves tilted seat position in all axes, including legacy Z offsets", () => {
  const cutout = { ...pocket, tilt: { xDeg: -20, yDeg: 35 }, rotationDeg: 37, zOffsetMm: 2 };
  const lowered = { ...spec, fillHeightPercent: 75 };
  const updated = adjustPocketsForFillHeight([cutout], spec, lowered).cutouts![0];
  const before = resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout);
  const after = resolvePlacedPocketDepth(lowered, updated.depth, shape, updated);
  expect(after.floorZ).toBeCloseTo(before.floorZ!, 9);
  expect(after.highestFloorZ).toBeCloseTo(before.highestFloorZ!, 9);
  const axis = pocketAxis(cutout);
  for (const coordinate of ["x", "y"] as const) {
    expect(updated.position[coordinate] - axis[coordinate] * after.axialDepthMm!).toBeCloseTo(cutout.position[coordinate] - axis[coordinate] * before.axialDepthMm!, 9);
  }
});

it.each([50, 25])("rejects zero/negative depths atomically at %s percent", fillHeightPercent => {
  const original = { ...pocket, depth: { mode: "mm" as const, value: 16.9 } };
  const before = JSON.stringify(original);
  expect(adjustPocketsForFillHeight([pocket, original], spec, { ...spec, fillHeightPercent }).error).toContain("no depth");
  expect(JSON.stringify(original)).toBe(before);
});

it("preserves linked designs and rejects incompatible independent tilts", () => {
  const linked = { ...pocket, designLink: { id: "group", tilt: false } };
  const copies: CutoutPlacement[] = [linked, { ...linked, id: "copy", rotationDeg: 90 }];
  const lowered = { ...spec, fillHeightPercent: 75 };
  const result = adjustPocketsForFillHeight(copies, spec, lowered);
  expect(result.cutouts).toHaveLength(2);
  expect(result.cutouts![0].depth).toEqual(result.cutouts![1].depth);
  copies[1] = { ...copies[1], tilt: { xDeg: 0, yDeg: 30 } };
  expect(adjustPocketsForFillHeight(copies, spec, lowered).error).toContain("Linked pockets");
});
