import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { toCrossSection } from "@/lib/geometry/offset";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildCutoutCutters } from "./cutouts";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { buildSurfaceFitCheckSolid } from "./fit-check";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "tool", name: "Raised tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -10, maxX: 10, minY: -12, maxY: 12 },
  outlineMm: [{ outer: [[-10,-12],[10,-12],[10,12],[-10,12]].map(([x,y]) => ({x,y})), holes: [] }] };
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, fill: "solid", lip: "none" });
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 0, y: 0 },
  elevationMm: 12, depth: { mode: "mm", value: 16 }, clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 2, bottomFilletMm: 1 });
const layout = (p = pocket, s = shape) => ({ shapesById: new Map([[s.id,s]]), cutouts: [p], fingerHoles: [] });
function cutter(p = pocket, bin = spec, s = shape, quality = EXPORT_QUALITY) {
  return arena.track(kernel.Manifold.union(buildCutoutCutters(kernel, new Map([[s.id,s]]), [p], bin, quality).cutters));
}

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("rounds a raised opening at the bin surface at quality %j", quality => {
  const top = resolvePocketDepth(spec, pocket.depth).infillTopZ;
  const rounded = buildBinWithCutouts(kernel, spec, layout(), quality).solid;
  const sharp = buildBinWithCutouts(kernel, spec, layout({ ...pocket, topFilletMm: 0 }), quality).solid;
  const probe = arena.track(kernel.Manifold.cube([0.1,0.1,0.1]).translate([10.7,-0.05,top-0.15]));
  expect(arena.track(sharp.intersect(probe)).volume()).toBeCloseTo(0.001, 7);
  expect(arena.track(rounded.intersect(probe)).volume()).toBeCloseTo(0, 7);
  expect(rounded.status()).toBe("NoError");
  expect(rounded.volume()).toBeLessThan(sharp.volume());
  const lower = arena.track(kernel.Manifold.cube([100,100,top-pocket.topFilletMm-0.1]).translate([-50,-50,0]));
  expect(arena.track(arena.track(sharp.subtract(rounded)).intersect(lower)).volume()).toBeLessThan(1e-6);
  expect(arena.track(rounded.subtract(sharp)).volume()).toBeLessThan(1e-6);
});

it("keeps a flush rigid pocket equivalent to the existing upright rounded bin", () => {
  const top = resolvePocketDepth(spec, pocket.depth).infillTopZ;
  const p = { ...pocket, elevationMm: top - 10, depth: { mode: "mm" as const, value: 10 } };
  const rigid = buildBinWithCutouts(kernel, spec, layout(p), EXPORT_QUALITY).solid;
  const legacy = buildBinWithCutouts(kernel, spec, layout({ ...p, elevationMm: undefined }), EXPORT_QUALITY).solid;
  expect(arena.track(rigid.subtract(legacy)).volume()).toBeLessThan(1e-5);
  expect(arena.track(legacy.subtract(rigid)).volume()).toBeLessThan(1e-5);
});

it.each([100, 50])("follows the actual fill surface at %s percent and shares its outline with inspection and fit tests", fillHeightPercent => {
  const bin = { ...spec, fillHeightPercent };
  const p = { ...pocket, elevationMm: 7 };
  const top = resolvePocketDepth(bin, p.depth).infillTopZ;
  const rounded = cutter(p, bin), sharp = cutter({ ...p, topFilletMm: 0 }, bin);
  const mouth = arena.track(rounded.slice(top - 1e-7));
  expect(mouth.bounds().max[0]).toBeCloseTo(12, 5);
  expect(mouth.area()).toBeGreaterThan(arena.track(sharp.slice(top - 1e-7)).area());
  const view = resolvedPocketGeometry(kernel, shape, p, bin);
  const outline = toCrossSection(kernel, view.opening);
  expect(arena.track(outline.subtract(mouth)).area()).toBeLessThan(1e-5);
  expect(arena.track(mouth.subtract(outline)).area()).toBeLessThan(1e-5);
  const fit = buildSurfaceFitCheckSolid(kernel, bin, layout(p), 0.8, EXPORT_QUALITY, "full");
  const openingProbe = arena.track(kernel.Manifold.cube([0.1,0.1,0.1]).translate([10.7,-0.05,0.65]));
  expect(arena.track(fit.intersect(openingProbe)).volume()).toBeCloseTo(0, 7);
});

it("does not create a rim or change the tool cap when the whole pocket is submerged", () => {
  const p = { ...pocket, elevationMm: 8, depth: { mode: "mm" as const, value: 10 } };
  const rounded = cutter(p), sharp = cutter({ ...p, topFilletMm: 0 });
  expect(arena.track(rounded.subtract(sharp)).volume()).toBeLessThan(1e-6);
  expect(arena.track(sharp.subtract(rounded)).volume()).toBeLessThan(1e-6);
  expect(resolvedPocketGeometry(kernel, shape, p, spec).opening).toEqual([]);
});

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
