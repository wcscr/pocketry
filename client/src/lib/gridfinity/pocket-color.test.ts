import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { loadManifold, createKernel, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement, tracedShapeSchema, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { extractMeshData, extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import fixture from "./fixtures/tilted-tape-color.json";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";

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
it("colors all walls and the floor while preserving the exact cavity and material partition", () => {
  const before = make([pocket]), after = make([{...pocket,colorCoverage:"interior"}]), parts = after.materialParts!;
  expect(arena.track(before.solid.subtract(after.solid)).volume()).toBeLessThan(1e-8);
  expect(arena.track(after.solid.subtract(before.solid)).volume()).toBeLessThan(1e-8);
  for (const point of [[-10.3,0,12],[10.3,0,12],[0,-15.3,12],[0,15.3,12],[0,0,6.7],[10.3,0,30]] as const)
    expect(sample(parts.pocketFloors!,point[0],point[1],point[2])).toBeCloseTo(.001,6);
  expect(sample(parts.pocketFloors!,0,0,6)).toBe(0);
  expect(arena.track(parts.body.intersect(parts.pocketFloors!)).volume()).toBeLessThan(1e-8);
  expect(parts.body.volume()+parts.pocketFloors!.volume()).toBeCloseTo(after.solid.volume(),5);
  for (const solid of [after.solid,parts.body,parts.pocketFloors!]) expectPrintableTopology(extractPrintableMeshData(k,solid));
});
it.each([
  {axis:"x" as const,x:-10.3,y:0},
  {axis:"y" as const,x:0,y:-15.3},
])("colors only the finite supporting local $axis wall without changing vertical insertion", ({axis,x,y}) => {
  const p = {...pocket,colorFloorAxis:axis}, before = make([pocket]), after = make([p]);
  expect(after.solid.volume()).toBeCloseTo(before.solid.volume(),6);
  expect(sample(after.materialParts!.pocketFloors!,x,y,12)).toBeCloseTo(.001,6);
  expect(sample(after.materialParts!.pocketFloors!,-x,-y,12)).toBe(0);
  expect(sample(after.solid,x,y,30)).toBeCloseTo(.001,6);
  expect(sample(after.materialParts!.pocketFloors!,x,y,30)).toBe(0);
  expect(sample(after.materialParts!.pocketFloors!,0,0,6.7)).toBe(0);
  expect(p.insertionMode).toBe("vertical");
});
it("keeps the color band against a shallow pocket instead of jumping below it", () => {
  const p = {...pocket,depth:{mode:"mm" as const,value:.1},insertionMode:undefined,colorFloorAxis:"insertion" as const};
  const built = make([p]);
  for (const z of [6.95,6.7,6.45]) expect(sample(built.materialParts!.pocketFloors!,0,0,z)).toBeCloseTo(.001,5);
});
it("does not coat a parallel floor from rounding noise after compound rotation", () => {
  const p = {...pocket,insertionMode:undefined,colorFloorAxis:"x" as const,tilt:{xDeg:30,yDeg:0},rotationDeg:17};
  const built = make([p]), heading=17*Math.PI/180;
  // Original bottom centre: local (0,0,-12), anchored by the lowest corner.
  const normal=[.5*Math.sin(heading),-.5*Math.cos(heading),Math.cos(Math.PI/6)];
  const centre=[-6*Math.sin(heading),6*Math.cos(heading),14.5];
  const point=centre.map((v,i)=>v-.3*normal[i]);
  expect(sample(built.materialParts!.pocketFloors!,point[0],point[1],point[2])).toBe(0);
});
it("keeps object-Z floor color on the tilted seat, not the vertical clearance wall above it", () => {
  const p = {...pocket,tilt:{xDeg:30,yDeg:0},colorFloorAxis:"z" as const};
  const built = make([p]);
  const floor = built.materialParts!.pocketFloors!;
  // The finite object's low face is tilted. Vertical drop-in clearance adds
  // a tall wall above its far edge; that wall is not the object's Z floor.
  expect(sample(floor,0,6.15,14.5-.3*Math.cos(Math.PI/6))).toBeCloseTo(.001,6);
  expect(sample(built.solid,0,15*Math.cos(Math.PI/6)+6+.1,30)).toBeCloseTo(.001,6);
  expect(sample(floor,0,15*Math.cos(Math.PI/6)+6+.1,30)).toBe(0);
});
it("keeps retained holes and through openings intact with interior lining", () => {
  const p = {...pocket,depth:{mode:"through" as const,sourceDepthMm:19},elevationMm:0,colorCoverage:"interior" as const};
  const hole = {...pocket,id:"hole",role:"hole" as const,scaleX:.2,scaleY:.2};
  const after = make([p,hole]), plain = make([{...p,colorCoverage:undefined},hole]);
  expect(after.solid.volume()).toBeCloseTo(plain.solid.volume(),5);
  expect(sample(after.materialParts!.pocketFloors!,10.3,0,12)).toBeCloseTo(.001,6);
  expect(sample(after.materialParts!.pocketFloors!,0,0,12)).toBe(0);
  expect(sample(after.solid,5,0,1)).toBe(0);
});
it.each([PREVIEW_QUALITY,EXPORT_QUALITY])("shades the reported tilted floor without amplifying microscopic seams at quality=$cutoutVertexBudget", quality => {
  const shapes = fixture.shapes.map(s=>tracedShapeSchema.parse(s));
  const cutouts = fixture.cutouts.map(c=>parseCutoutPlacement(c));
  const built = buildBinWithCutouts(k,parseBinSpec(fixture.spec),{shapesById:new Map(shapes.map(s=>[s.id,s])),cutouts,fingerHoles:[]},quality,{floorInsertThicknessMm:.6,rimInsertThicknessMm:1.25});
  // This source design really exceeds its bin height. Shading repair must
  // not hide that independently actionable geometric validation error.
  expect(built.validationIssues.some(i=>i.code==="vertical-seat-above-surface")).toBe(true);
  const mesh = extractMeshData(k,built.materialParts!.pocketFloors!,{normals:true});
  const theta = cutouts[0].tilt!.xDeg*Math.PI/180, n = [0,-Math.sin(theta),Math.cos(theta)], p = mesh.positions;
  const planes = new Map<number,{area:number;offsets:number[];ids:number[]}>();
  const realEdges = new Set<string>();
  const keyForVertex = (id: number) => `${p[id]},${p[id+1]},${p[id+2]}`;
  for (let i=0;i<mesh.indices.length;i+=3) {
    const ids=Array.from(mesh.indices.slice(i,i+3),v=>v*3), [a,b,c]=ids;
    const u=[0,1,2].map(j=>p[b+j]-p[a+j]), v=[0,1,2].map(j=>p[c+j]-p[a+j]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], length=Math.hypot(...normal);
    const alignment = normal.reduce((d,x,j)=>d+x*n[j],0)/length;
    // Meaningful adjacent faces form real edges (including material-band
    // boundaries). Their smoothing is intentional. Sub-micron seam slivers
    // are excluded from this classification, so the regression still catches
    // the false folds they caused across the broad seat.
    if (length > .1 && alignment < .99999) ids.forEach(id => realEdges.add(keyForVertex(id)));
    if (length<10 || alignment<.99999) continue;
    const offsets=ids.map(id=>n.reduce((d,x,j)=>d+x*p[id+j],0)), key=Math.round(offsets[0]*100);
    const plane=planes.get(key)??{area:0,offsets:[],ids:[]}; plane.area+=length/2; plane.offsets.push(...offsets);
    plane.ids.push(...ids);
    planes.set(key,plane);
  }
  const floor=[...planes.values()].sort((a,b)=>b.area-a.area)[0];
  expect(floor.area).toBeGreaterThan(500);
  // Existing clearance geometry has sub-micron seams. Preview normals must
  // not exaggerate them into folds; this fix does not alter that geometry.
  expect(Math.max(...floor.offsets)-Math.min(...floor.offsets)).toBeLessThan(.002);
  const interior = floor.ids.filter(id => !realEdges.has(keyForVertex(id)));
  expect(interior.length).toBeGreaterThan(20);
  const dots = interior.map(id => n.reduce((d,x,j)=>d+x*mesh.normals![id+j],0));
  expect(Math.min(...dots)).toBeGreaterThan(Math.cos(4*Math.PI/180));
  const original = arena.track(built.materialParts!.pocketFloors!.calculateNormals(0,60)).getMesh();
  const originalDots = interior.map(id => n.reduce((d,x,j)=>d+x*original.vertProperties[id/3*original.numProp+3+j],0));
  expect(Math.min(...originalDots)).toBeLessThan(Math.cos(20*Math.PI/180));
  const parts=[built.materialParts!.body,built.materialParts!.pocketFloors!,built.materialParts!.stackingRim!];
  const printable=parts.map(s=>extractPrintableMeshData(k,s));
  printable.forEach((m,i)=>expectPrintableTopology(m,`part ${i}`));
  expect(Math.abs(printable.reduce((v,m)=>v+signedMeshVolume(m),0)-built.solid.volume())).toBeLessThan(.05);
},120000);
it.each([
  { name: "interior lining", color: { colorCoverage: "interior" as const } },
  { name: "object-Z floor", color: { colorFloorAxis: "z" as const } },
])("exports the complex tilted $name as closed, exhaustive material parts", async ({color}) => {
  const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as
    (request: BuildBinRequest, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
  const {value} = await handler({spec:parseBinSpec({...fixture.spec,heightUnits:8}),quality:EXPORT_QUALITY,exportTopology:true,
    layout:{shapes:fixture.shapes.map(s=>tracedShapeSchema.parse(s)),
      cutouts:fixture.cutouts.map((c,i)=>parseCutoutPlacement({...c,...(i===0?color: {})})),fingerHoles:[]},
    pocketFloorMaterialThicknessMm:.6,stackingRimMaterialThicknessMm:1.25},
    {signal:new AbortController().signal,progress:()=>{}});
  expect(value.validationIssues?.filter(i=>i.severity==="error")).toEqual([]);
  expectPrintableTopology(value.mesh,"whole bin");
  const parts=Object.entries(value.materialMeshes!);
  for(const [name,mesh] of parts) {
    expectPrintableTopology(mesh,name);
  }
  expect(Math.abs(parts.reduce((volume,[,mesh])=>volume+signedMeshVolume(mesh),0)-signedMeshVolume(value.mesh))).toBeLessThan(.05);
// Exact 40-point trace, overlapping pocket, two fillet stacks and three
// exported materials: allow headroom on machines running other local suites.
},300000);
