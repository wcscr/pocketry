import { arena, kernel, shape, spec, pocket, layout, cutter } from "./pocket-surface-rounding.test-support";
import { expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";

it.each([false, true])("uses one real opening for a tilted split pocket with holes=%s", holed => {
  const s = holed ? { ...shape, pointCount: 8, outlineMm: [{ ...shape.outlineMm[0],
    holes: [[[-4,-4],[-4,4],[4,4],[4,-4]].map(([x,y]) => ({x,y}))] }] } : shape;
  const p = parseCutoutPlacement({ ...pocket, elevationMm: 10, tilt: { xDeg: 20, yDeg: 25 }, rotationDeg: 17,
    split: { boundary: [{ x: -15, y: 6 }, { x: 15, y: 6 }], depths: [{mode:"mm",value:10},{mode:"mm",value:16}] } });
  const top = resolvePocketDepth(spec, p.depth).infillTopZ;
  const rounded = cutter(p, spec, s), sharp = cutter({ ...p, topFilletMm: 0 }, spec, s);
  expect(rounded.status()).toBe("NoError");
  expect(arena.track(rounded.slice(top - 1e-7)).area()).toBeGreaterThan(arena.track(sharp.slice(top - 1e-7)).area());
  const lower = arena.track(kernel.Manifold.cube([100,100,top-p.topFilletMm-0.1]).translate([-50,-50,0]));
  expect(arena.track(arena.track(rounded.subtract(sharp)).intersect(lower)).volume()).toBeLessThan(1e-5);
  expect(arena.track(sharp.subtract(rounded)).volume()).toBeLessThan(1e-5);
  const built = buildBinWithCutouts(kernel, spec, layout(p,s), EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
  expect(built.solid.status()).toBe("NoError");
  expect(built.validationIssues).toEqual([]);
  expect(arena.track(built.materialParts!.body.intersect(built.materialParts!.pocketFloors!)).volume()).toBeLessThan(1e-5);
  expect(built.materialParts!.body.volume() + built.materialParts!.pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 4);
});
