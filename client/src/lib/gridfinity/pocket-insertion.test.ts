import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, pocketOccupiedOutline, type TracedShape } from "@shared/gridfinity/cutout";
import { pocketInsertionAxis } from "@shared/gridfinity/pocket-insertion";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { outlineBounds } from "@/lib/geometry/outline";
import { buildCutoutCutters, buildRigidPocket } from "./cutouts";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { resolvedPocketGeometry } from "./pocket-geometry";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "s", name: "Tilted tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -10, maxX: 10, minY: -12, maxY: 12 },
  outlineMm: [{ outer: [[-10,-12],[10,-12],[10,12],[-10,12]].map(([x,y]) => ({x,y})), holes: [] }] };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 3, fill: "solid", lip: "none" });
const pocket = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 }, elevationMm: 7,
  tilt: { xDeg: 30, yDeg: 0 }, depth: { mode: "mm", value: 16 }, cornerRoundMm: 0, bottomFilletMm: 0, topFilletMm: 0 });
const map = new Map([[shape.id, shape]]);
function cutter(p = pocket, s = shape) {
  return arena.track(kernel.Manifold.union(buildCutoutCutters(kernel, new Map([[s.id,s]]), [p], spec, EXPORT_QUALITY).cutters));
}

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("clears the reported rounded pocket continuously at quality=%j", quality => {
  const p = {...pocket, position:{x:28.07,y:-6.55}, elevationMm:5.05, tilt:{xDeg:20,yDeg:25}, rotationDeg:17,
    bottomFilletMm:1, topFilletMm:2, insertionMode:"vertical" as const};
  const source = arena.track(kernel.Manifold.union(buildRigidPocket(kernel,shape,{...p,insertionMode:undefined,topFilletMm:0},spec,quality).cutters));
  const built = buildCutoutCutters(kernel,map,[p],spec,quality);
  const vertical = arena.track(kernel.Manifold.union(built.cutters));
  const top = resolvePocketDepth(spec,p.depth).infillTopZ;
  expect(built.validationIssues).toEqual([]);
  expect(arena.track(arena.track(source.project()).subtract(arena.track(vertical.slice(top-1e-7)))).area()).toBeLessThan(0.001);
  for (const travel of [0,0.1,0.3,1,3,7,12,20]) {
    const shifted = arena.track(arena.track(source.translate([0,0,travel])).trimByPlane([0,0,-1],-top));
    expect(arena.track(shifted.subtract(vertical)).volume(), `blocked volume after ${travel} mm travel`).toBeLessThan(0.001);
  }
});

it("extends the tilted bottom across the projected outline instead of retaining the tilted sidewall", () => {
  const vertical = cutter({...pocket,insertionMode:"vertical"});
  // At y=-7 the tilted sidewall used to rise through the opening. The bottom
  // plane extends below the requested lowest elevation here, so the remaining
  // floor limit stops it at z=7. Above that, the vertical path must be empty.
  const probe = (z:number) => arena.track(arena.track(kernel.Manifold.cube([2,1,0.2],true)).translate([0,-7,z]));
  expect(arena.track(vertical.intersect(probe(9))).volume()).toBeCloseTo(0.4,7);
  expect(arena.track(vertical.intersect(probe(6.5))).volume()).toBeLessThan(1e-7);
});

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("opens the full top-down perimeter even when the tool extends above the surface at quality=%j", quality => {
  const p = { ...pocket, elevationMm:12, tilt:{xDeg:20,yDeg:25}, rotationDeg:17 };
  const taller = {...spec,heightUnits:5};
  const top = resolvePocketDepth(taller,p.depth).infillTopZ;
  const source = arena.track(kernel.Manifold.union(buildRigidPocket(kernel,shape,p,taller,quality).cutters));
  expect(source.boundingBox().max[2]).toBeGreaterThan(top);
  const projected = arena.track(source.project());
  const built = buildCutoutCutters(kernel,map,[{...p,insertionMode:"vertical"}],taller,quality);
  const vertical = arena.track(kernel.Manifold.union(built.cutters));
  // Sample at the actual surface. A sloped seat meeting it naturally excludes
  // an infinitesimal strip if sampled below that plane.
  const opening = arena.track(vertical.slice(top-1e-8));
  expect(arena.track(projected.subtract(opening)).area()).toBeLessThan(1e-5);
  expect(arena.track(opening.subtract(projected)).area()).toBeLessThan(1e-5);
});

it("produces a wider vertical opening without changing the seated depth or elevation", () => {
  const top = resolvePocketDepth(spec, pocket.depth).infillTopZ;
  const axis = cutter({ ...pocket, insertionMode: "axis" });
  const vertical = cutter({ ...pocket, insertionMode: "vertical" });
  const source = cutter();
  expect(arena.track(vertical.slice(top - 1e-6)).area()).toBeGreaterThan(arena.track(axis.slice(top - 1e-6)).area());
  expect(axis.boundingBox().min[2]).toBeCloseTo(source.boundingBox().min[2], 7);
  expect(vertical.boundingBox().min[2]).toBeCloseTo(source.boundingBox().min[2], 7);
  expect(arena.track(source.subtract(axis)).volume()).toBeLessThan(1e-6);
  // The seat prisms use Float32 mesh positions at 0.0001 mm tolerance.
  expect(arena.track(source.subtract(vertical)).volume()).toBeLessThan(0.001);
});

it.each(["vertical"] as const)("clears all translated copies continuously along %s and reserves their bounds", insertionMode => {
  const p = { ...pocket, insertionMode };
  const source = cutter(), swept = cutter(p), axis = pocketInsertionAxis(p);
  const top = resolvePocketDepth(spec, p.depth).cutterTopZ;
  for (const travel of [0.3, 2.75, 9, 30]) {
    const translated = arena.track(source.translate([axis.x * travel, axis.y * travel, axis.z * travel]));
    const clipped = arena.track(translated.trimByPlane([0,0,-1], -top));
    // Float32 facet coordinates and 0.0001 mm Boolean tolerance can leave
    // sub-micron residuals; a blocking region would have substantial volume.
    expect(arena.track(clipped.subtract(swept)).volume()).toBeLessThan(0.001);
  }
  const bounds = outlineBounds(pocketOccupiedOutline(shape, p, spec))!;
  expect(swept.boundingBox().min[0]).toBeGreaterThan(bounds.minX - 0.001);
  expect(swept.boundingBox().max[1]).toBeLessThan(bounds.maxY + 0.001);
  expect(resolvedPocketGeometry(kernel, shape, p, spec).opening.length).toBeGreaterThan(0);
});

it.each([
  { tilt:{xDeg:30,yDeg:0}, rotationDeg:0, mirrored:false },
  { tilt:{xDeg:20,yDeg:25}, rotationDeg:17, mirrored:true },
])("preserves the original tilted opening exactly with pose=%j", pose => {
  const p = { ...pocket, ...pose, topFilletMm:2, bottomFilletMm:1 };
  const original = cutter(p), angled = cutter({ ...p, insertionMode:"axis" });
  expect(arena.track(original.subtract(angled)).volume()).toBeLessThan(1e-8);
  expect(arena.track(angled.subtract(original)).volume()).toBeLessThan(1e-8);
});

it("retains the tilted seat at different heights beneath a complete vertical mouth", () => {
  const vertical = cutter({ ...pocket, insertionMode:"vertical" });
  // The authored bottom cap is [-10,10] × [-12,12] at local Z=-16.
  // After 30° pitch and lowest-point anchoring, its center is (0,8,13).
  for (const y of [-6,6]) {
    const worldY = 8 + y*Math.cos(Math.PI/6), seatZ = 13 + y*0.5;
    const probe = (z: number) => arena.track(arena.track(kernel.Manifold.cube([1,0.2,0.1],true)).translate([0,worldY,z]));
    expect(arena.track(vertical.intersect(probe(seatZ-0.3))).volume()).toBeLessThan(1e-7);
    expect(arena.track(vertical.intersect(probe(seatZ+0.3))).volume()).toBeCloseTo(0.02,7);
  }
});

it.each(["axis", "vertical"] as const)("keeps %s openings rounded at the surface and split floor colors nonoverlapping", insertionMode => {
  const s = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [[[-3,-3],[-3,3],[3,3],[3,-3]].map(([x,y]) => ({x,y}))] }] };
  const p = parseCutoutPlacement({ ...pocket, insertionMode, topFilletMm: 2, bottomFilletMm: 1,
    split: { boundary: [{ x: -15, y: 5 }, { x: 15, y: 5 }], depths: [{mode:"mm",value:10},{mode:"mm",value:16}] } });
  const rounded = cutter(p, s), sharp = cutter({ ...p, topFilletMm: 0 }, s);
  const top = resolvePocketDepth(spec, p.depth).infillTopZ;
  expect(arena.track(rounded.slice(top-1e-6)).area()).toBeGreaterThan(arena.track(sharp.slice(top-1e-6)).area());
  const layout = { shapesById: new Map([[s.id,s]]), cutouts: [p], fingerHoles: [] };
  const built = buildBinWithCutouts(kernel, { ...spec,heightUnits:4 }, layout, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
  expect(built.validationIssues).toEqual([]);
  expect(built.solid.status()).toBe("NoError");
  expect(arena.track(built.materialParts!.body.intersect(built.materialParts!.pocketFloors!)).volume()).toBeLessThan(1e-5);
  expect(built.materialParts!.body.volume() + built.materialParts!.pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 4);
}, 30_000); // Three export-quality builds of a rounded, holed, split seat.

it("opens submerged pockets only when clearance is explicitly enabled", () => {
  const p = { ...pocket, tilt: undefined, elevationMm: 7, depth: { mode: "mm" as const, value: 8 } };
  const top = resolvePocketDepth(spec, p.depth).infillTopZ;
  expect(arena.track(cutter(p).slice(top-1e-6)).isEmpty()).toBe(true);
  expect(arena.track(cutter({ ...p, insertionMode: "vertical" }).slice(top-1e-6)).area()).toBeGreaterThan(0);
});

it("preserves a concave silhouette and its interior hole during upright insertion", () => {
  const s = { ...shape, outlineMm: [{ outer: [[-10,-12],[10,-12],[10,0],[0,0],[0,12],[-10,12]].map(([x,y]) => ({x,y})),
    holes: [[[-7,-7],[-7,-3],[-3,-3],[-3,-7]].map(([x,y]) => ({x,y}))] }] };
  const p = { ...pocket, tilt: undefined, depth: {mode:"mm" as const,value:8}, insertionMode: "vertical" as const };
  const solid = cutter(p,s), top = resolvePocketDepth(spec, p.depth).infillTopZ;
  const section = arena.track(solid.slice(top-1e-6));
  expect(section.area()).toBeCloseTo(344, 3);
  expect(resolvedPocketGeometry(kernel,s,p,spec).opening[0].holes).toHaveLength(1);
});

it("reserves the full insertion envelope when depth is defined by remaining floor", () => {
  const p = { ...pocket, depth: {mode:"remaining" as const,floorThicknessMm:7}, insertionMode: "axis" as const };
  const solid = cutter(p), bounds = outlineBounds(pocketOccupiedOutline(shape,p,spec))!;
  expect(solid.boundingBox().min[1]).toBeGreaterThan(bounds.minY-0.001);
  expect(solid.boundingBox().max[1]).toBeLessThan(bounds.maxY+0.001);
});

it("isolates an invalid axial pocket in preview while retaining the other cavity", () => {
  const invalid = { ...pocket, insertionMode: "axis" as const, tilt: { xDeg: 90, yDeg: 0 } };
  const other = { ...pocket, id: "other", position: {x:25,y:0}, tilt: undefined };
  const built = buildBinWithCutouts(kernel, spec, { shapesById: map, cutouts: [invalid,other], fingerHoles: [] }, EXPORT_QUALITY);
  const reference = buildBinWithCutouts(kernel, spec, { shapesById: map, cutouts: [other], fingerHoles: [] }, EXPORT_QUALITY);
  expect(built.validationIssues).toContainEqual(expect.objectContaining({ code: "invalid-pocket-insertion", severity: "error" }));
  expect(built.solid.volume()).toBeCloseTo(reference.solid.volume(), 5);
});

it("reports a tilted seat above the surface instead of adding deep projection trenches", () => {
  const p = {...pocket,elevationMm:12,tilt:{xDeg:20,yDeg:25},insertionMode:"vertical" as const};
  const built = buildBinWithCutouts(kernel,spec,{shapesById:map,cutouts:[p],fingerHoles:[]},EXPORT_QUALITY);
  expect(built.validationIssues).toContainEqual(expect.objectContaining({code:"vertical-seat-above-surface",severity:"error",cutoutIds:[p.id]}));
});
