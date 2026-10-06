import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { Manifold } from "manifold-3d";
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

it.each([
  {xDeg:30,yDeg:0}, {xDeg:20,yDeg:25}, {xDeg:180,yDeg:25},
])("bounds a through drop-in opening by the true underside and fill surface: %j", tilt => {
  const p = {...pocket,depth:{mode:"through" as const},elevationMm:0,tilt,rotationDeg:17,
    insertionMode:"vertical" as const};
  const top = resolvePocketDepth(spec,p.depth).infillTopZ;
  for (const quality of [PREVIEW_QUALITY,EXPORT_QUALITY]) {
    const source = buildRigidPocket(kernel,shape,{...p,insertionMode:undefined},spec,quality).cutters[0];
    const bounded = arena.track(arena.track(source.trimByPlane([0,0,1],0)).trimByPlane([0,0,-1],-top));
    const expected = arena.track(bounded.project());
    const solid = buildCutoutCutters(kernel,map,[p],spec,quality).cutters[0];
    const opening = arena.track(solid.slice(top-1e-7));
    expect(arena.track(expected.subtract(opening)).area()).toBeLessThan(0.001);
    expect(arena.track(opening.subtract(expected)).area()).toBeLessThan(0.001);
    expect(solid.boundingBox().min[2]).toBeCloseTo(0,6);
    expect(solid.boundingBox().max[0]-solid.boundingBox().min[0]).toBeLessThan(60);
    // The bottom intersection remains open, while the tilted sides are retained.
    const bottom = arena.track(source.slice(0.001));
    expect(arena.track(bottom.subtract(arena.track(solid.slice(0.001)))).area()).toBeLessThan(0.001);
    const bounds = outlineBounds(pocketOccupiedOutline(shape,p,spec))!;
    expect(bounds.minX).toBeCloseTo(solid.boundingBox().min[0],3);
    expect(bounds.maxY).toBeCloseTo(solid.boundingBox().max[1],3);
    // Arbitrary Boolean-helper length must not influence the footprint.
    const wide = buildCutoutCutters(kernel,map,[p],{...spec,gridX:8},quality).cutters[0];
    expect(arena.track(wide.subtract(solid)).volume()).toBeLessThan(0.001);
    expect(arena.track(solid.subtract(wide)).volume()).toBeLessThan(0.001);
  }
});

it("limits only the through half of a split pocket, retaining the finite raised seat", () => {
  const p = parseCutoutPlacement({...pocket,tilt:{xDeg:0,yDeg:25},elevationMm:12,insertionMode:"vertical",
    split:{boundary:[{x:-15,y:0},{x:15,y:0}],depths:[{mode:"through"},{mode:"mm",value:16}]}});
  const through = buildCutoutCutters(kernel,map,[p],spec,EXPORT_QUALITY).cutters[0];
  const source = buildRigidPocket(kernel,shape,{...p,insertionMode:undefined},spec,EXPORT_QUALITY).cutters[0];
  // Negative Y is the blind half; its underside rises above the fill at one end.
  // The through half's clipping must not truncate its complete finite footprint.
  let samples = 0;
  for (const x of [-12,-8,-4,0,4]) {
    const seat = undersideAt(source,x,-6);
    if (seat !== undefined && seat < 21) {
      expect(undersideAt(through,x,-6)).toBeCloseTo(seat,2);
      samples++;
    }
  }
  expect(samples).toBeGreaterThanOrEqual(3);
  expect(undersideAt(through,-14,6)).toBeCloseTo(0,4);
});

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("clears the reported rounded pocket continuously at quality=%j", quality => {
  const p = {...pocket, position:{x:28.07,y:-6.55}, elevationMm:5.05, tilt:{xDeg:20,yDeg:25}, rotationDeg:17,
    bottomFilletMm:1, topFilletMm:2, insertionMode:"vertical" as const};
  const taller = {...spec,heightUnits:4};
  const source = arena.track(kernel.Manifold.union(buildRigidPocket(kernel,shape,{...p,insertionMode:undefined,topFilletMm:0},taller,quality).cutters));
  const built = buildCutoutCutters(kernel,map,[p],taller,quality);
  const vertical = arena.track(kernel.Manifold.union(built.cutters));
  const top = resolvePocketDepth(taller,p.depth).infillTopZ;
  expect(built.validationIssues).toEqual([]);
  expect(arena.track(arena.track(source.project()).subtract(arena.track(vertical.slice(top-1e-7)))).area()).toBeLessThan(0.001);
  for (const travel of [0,0.1,0.3,1,3,7,12,20]) {
    const shifted = arena.track(arena.track(source.translate([0,0,travel])).trimByPlane([0,0,-1],-top));
    expect(arena.track(shifted.subtract(vertical)).volume(), `blocked volume after ${travel} mm travel`).toBeLessThan(0.001);
  }
});

/** Independent vertical-ray oracle: read the lowest triangle intersection at XY. */
function undersideAt(solid: Manifold, x: number, y: number): number | undefined {
  const mesh = solid.getMesh(), hits: number[] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const [a,b,c] = Array.from(mesh.triVerts.subarray(i,i+3), index =>
      Array.from(mesh.vertProperties.subarray(index*mesh.numProp,index*mesh.numProp+3)));
    const det = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
    const v = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;
    if (u >= -1e-8 && v >= -1e-8 && u+v <= 1+1e-8) hits.push(u*a[2]+v*b[2]+(1-u-v)*c[2]);
  }
  return hits.length ? Math.min(...hits) : undefined;
}

it("preserves the object's lower side face instead of flattening it to the lowest point", () => {
  const vertical = cutter({...pocket,insertionMode:"vertical"});
  const source = cutter();
  // At y=-7, the original side face becomes part of the rotated underside.
  // Extending the bottom cap alone wrongly flattened this region to z=7.
  const expected = 7 + (-12*Math.cos(Math.PI/6)+8-(-7))/Math.tan(Math.PI/6);
  expect(undersideAt(source,0,-7)).toBeCloseTo(expected,5);
  expect(undersideAt(vertical,0,-7)).toBeCloseTo(expected,2);
  expect(expected).toBeGreaterThan(14);
});

it.each([
  {tilt:{xDeg:20,yDeg:25},rotationDeg:17,mirrored:false,bottomFilletMm:0,split:false},
  {tilt:{xDeg:-25,yDeg:30},rotationDeg:53,mirrored:true,bottomFilletMm:1,split:true},
  {tilt:{xDeg:90,yDeg:0},rotationDeg:17,mirrored:false,bottomFilletMm:1,split:false},
  {tilt:{xDeg:180,yDeg:0},rotationDeg:0,mirrored:false,bottomFilletMm:1,split:false},
])("matches the actual rotated underside throughout the footprint with %j", variant => {
  const s = {...shape,outlineMm:[{outer:[[-10,-12],[10,-12],[10,0],[3,0],[3,12],[-10,12]].map(([x,y])=>({x,y})),
    holes:[[[-7,-7],[-7,-3],[-3,-3],[-3,-7]].map(([x,y])=>({x,y}))]}]};
  const p = parseCutoutPlacement({...pocket,...variant,position:{x:24.82,y:-20.51},elevationMm:16.87,
    split:variant.split ? {boundary:[{x:-15,y:5},{x:15,y:5}],depths:[{mode:"mm",value:10},{mode:"mm",value:16}]} : undefined});
  const tall = {...spec,heightUnits:8};
  for (const quality of [PREVIEW_QUALITY,EXPORT_QUALITY]) {
    const source = arena.track(kernel.Manifold.union(buildRigidPocket(kernel,s,p,tall,quality).cutters));
    const built = buildRigidPocket(kernel,s,{...p,insertionMode:"vertical"},tall,quality);
    const vertical = arena.track(kernel.Manifold.union(built.cutters));
    expect(built.validationIssues).toEqual([]);
    const bounds = source.boundingBox();
    let samples = 0;
    for (let ix=0;ix<11;ix++) for(let iy=0;iy<11;iy++) {
      const x=bounds.min[0]+(ix+0.37)/11*(bounds.max[0]-bounds.min[0]);
      const y=bounds.min[1]+(iy+0.43)/11*(bounds.max[1]-bounds.min[1]);
      const expected=undersideAt(source,x,y);
      const actual=undersideAt(vertical,x,y);
      if (expected === undefined) expect(actual).toBeUndefined();
      else {
        expect(actual,`underside at ${x}, ${y}`).toBeDefined();
        expect(Math.abs(actual!-expected),`seat height at ${x}, ${y}`).toBeLessThan(0.01);
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(30);
  }
},30_000);

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

it.each(["mm","through"] as const)("preserves a concave silhouette and its interior hole during upright insertion: %s", mode => {
  const s = { ...shape, outlineMm: [{ outer: [[-10,-12],[10,-12],[10,0],[0,0],[0,12],[-10,12]].map(([x,y]) => ({x,y})),
    holes: [[[-7,-7],[-7,-3],[-3,-3],[-3,-7]].map(([x,y]) => ({x,y}))] }] };
  const p = { ...pocket, tilt: undefined, depth: mode === "through" ? {mode} : {mode,value:8}, insertionMode: "vertical" as const };
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

it.each([undefined,"axis","vertical"] as const)("clips only the requested minimum floor and restores the source when raised: %s", insertionMode => {
  const tall = {...spec,heightUnits:8};
  const low = {...pocket,elevationMm:3,insertionMode,tilt:{xDeg:20,yDeg:25},rotationDeg:17,
    depth:{mode:"remaining" as const,floorThicknessMm:9,sourceDepthMm:16}};
  const original = structuredClone(low);
  const make = (p: typeof low | typeof pocket) => arena.track(kernel.Manifold.union(buildRigidPocket(kernel,shape,p,tall,EXPORT_QUALITY).cutters));
  const source = make({...low,depth:{mode:"mm",value:16}});
  const limited = make(low);
  const expected = arena.track(source.trimByPlane([0,0,1],9));
  expect(source.boundingBox().min[2]).toBeCloseTo(3,5);
  expect(limited.boundingBox().min[2]).toBeCloseTo(9,5);
  expect(arena.track(limited.subtract(expected)).volume()).toBeLessThan(0.001);
  expect(arena.track(expected.subtract(limited)).volume()).toBeLessThan(0.001);
  expect(limited.volume()).toBeLessThan(source.volume());
  const raised = make({...low,elevationMm:12});
  const restored = make({...low,elevationMm:12,depth:{mode:"mm",value:16}});
  expect(arena.track(raised.subtract(restored)).volume()).toBeLessThan(0.001);
  expect(arena.track(restored.subtract(raised)).volume()).toBeLessThan(0.001);
  expect(make(low).volume()).toBeCloseTo(limited.volume(),5);
  expect(low).toEqual(original);
});

it("keeps each split section's floor constraint separate from the original seat", () => {
  const tall = {...spec,heightUnits:8};
  const p = parseCutoutPlacement({...pocket,elevationMm:3,insertionMode:"vertical",tilt:undefined,
    split:{boundary:[{x:-15,y:0},{x:15,y:0}],depths:[
      {mode:"remaining",floorThicknessMm:9,sourceDepthMm:16},{mode:"mm",value:16}]}});
  const solid = buildRigidPocket(kernel,shape,p,tall,EXPORT_QUALITY).cutters[0];
  expect(undersideAt(solid,0,6)).toBeCloseTo(9,4);
  expect(undersideAt(solid,0,-6)).toBeCloseTo(3,4);
  const raised = buildRigidPocket(kernel,shape,{...p,elevationMm:12},tall,EXPORT_QUALITY).cutters[0];
  expect(undersideAt(raised,0,6)).toBeCloseTo(12,4);
  expect(undersideAt(raised,0,-6)).toBeCloseTo(12,4);
});
