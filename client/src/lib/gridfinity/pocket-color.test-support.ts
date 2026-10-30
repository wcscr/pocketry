// Shared fixtures and lifecycle hooks for the matching test suites.
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { loadManifold, createKernel, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement, tracedShapeSchema, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { buildBinWithCutouts, PREVIEW_QUALITY } from "./bin";

let wasm: ManifoldToplevel, arena: Arena, k: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); k = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const spec = parseBinSpec({gridX:2,gridY:2,heightUnits:6,fill:"solid",lip:"none",flatBottom:true});
const shape = tracedShapeSchema.parse({id:"s",name:"Rectangle",sourceMmPerPx:1,pointCount:4,
  bboxMm:{minX:-10,maxX:10,minY:-15,maxY:15},
  outlineMm:[{outer:[[-10,-15],[10,-15],[10,15],[-10,15]].map(([x,y])=>({x,y})),holes:[]}]});
const pocket = parseCutoutPlacement({id:"p",shapeId:"s",position:{x:0,y:0},elevationMm:7,
  depth:{mode:"mm",value:12},cornerRoundMm:0,topFilletMm:0,bottomFilletMm:0,insertionMode:"vertical"});
function make(cutouts: CutoutPlacement[]) {
  return buildBinWithCutouts(k,spec,{shapesById:new Map([[shape.id,shape]]),cutouts,fingerHoles:[]},PREVIEW_QUALITY,{floorInsertThicknessMm:.6});
}
function sample(solid: NonNullable<ReturnType<typeof make>["materialParts"]>["body"], x: number, y: number, z: number) {
  const cube = arena.track(arena.track(k.Manifold.cube([.1,.1,.1],true)).translate([x,y,z]));
  return arena.track(solid.intersect(cube)).volume();
}

export { wasm, arena, k, spec, shape, pocket, make, sample };
