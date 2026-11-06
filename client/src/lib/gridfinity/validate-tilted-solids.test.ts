import { afterEach, beforeEach, expect, it } from "vitest";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { validateTiltedSolids } from "./validate-tilted-solids";

let arena: Arena, kernel: Kernel;
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 });
beforeEach(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterEach(() => arena.dispose());

it.each([
  { name: "Z move", elevationMm: 7, tilt: undefined, rotationDeg: 0, tilted: false },
  { name: "zero tilt and Z rotation", elevationMm: 8, tilt: { xDeg: 0, yDeg: 0 }, rotationDeg: 180, tilted: false },
  { name: "actual tilt", elevationMm: 7, tilt: { xDeg: 10, yDeg: 0 }, rotationDeg: 0, tilted: true },
])("keeps exact wall errors but describes $name accurately", ({ elevationMm, tilt, rotationDeg, tilted }) => {
  const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", name: "Driver", position: { x: 0, y: 0 }, elevationMm, tilt, rotationDeg });
  const solid = arena.track(kernel.Manifold.cube([10, 10, 10]));
  const wall = arena.track(arena.track(kernel.Manifold.cube([2, 10, 10])).translate([9, 0, 0]));
  const issues = validateTiltedSolids(kernel, spec, [cutout], new Map(), [{ id: "p", cutters: [solid] }], wall, null, solid);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ code: "tilted-pocket-wall", severity: "error", cutoutIds: ["p"] });
  expect(issues[0].message.includes("tilted pocket")).toBe(tilted);
  expect(issues[0].message.includes("reduce tilt")).toBe(tilted);
  expect(issues[0].message.includes("adjust its height")).toBe(!tilted);
});

it("does not call an untilted shaft tilted in its thin-material warning", () => {
  const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 }, elevationMm: 7 });
  const solid = arena.track(kernel.Manifold.cube([10, 10, 10]));
  const wall = arena.track(arena.track(kernel.Manifold.cube([2, 10, 10])).translate([10.2, 0, 0]));
  const issues = validateTiltedSolids(kernel, spec, [cutout], new Map(), [{ id: "p", cutters: [solid] }], wall, null, solid);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ code: "tilted-pocket-thin-material", severity: "warning" });
  expect(issues[0].message).toContain("pocket shaft");
  expect(issues[0].message).not.toContain("tilted");
});

it("uses neutral wording when an untilted pocket meets a slanted bin wall", () => {
  const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 } });
  const solid = arena.track(kernel.Manifold.cube([10, 10, 10]));
  const issues = validateTiltedSolids(kernel, { ...spec, wallSlant: { axis: "x", angleDeg: 30 } },
    [cutout], new Map(), [{ id: "p", cutters: [solid] }], solid, null, solid);
  expect(issues[0].message).toContain("The pocket cuts");
  expect(issues[0].message).not.toContain("tilt");
  expect(issues[0].severity).toBe("error");
});
