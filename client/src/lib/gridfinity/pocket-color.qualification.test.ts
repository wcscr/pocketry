import { arena, k, spec } from "./pocket-color.test-support";
import { expect, it } from "vitest";
import { loadManifold } from "@/lib/manifold/runtime";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement, tracedShapeSchema } from "@shared/gridfinity/cutout";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { extractMeshData, extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import fixture from "./fixtures/tilted-tape-color.json";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";

it.each([PREVIEW_QUALITY,EXPORT_QUALITY])("shades the reported tilted floor without amplifying microscopic seams at quality=$cutoutVertexBudget", quality => {
  const shapes = fixture.shapes.map(s=>tracedShapeSchema.parse(s));
  const cutouts = fixture.cutouts.map(c=>parseCutoutPlacement(c));
  const built = buildBinWithCutouts(k,parseBinSpec(fixture.spec),{shapesById:new Map(shapes.map(s=>[s.id,s])),cutouts,fingerHoles:[]},quality,{floorInsertThicknessMm:.6,rimInsertThicknessMm:1.25});
  // The tilted object intentionally protrudes above the bin; that does not
  // obstruct its insertion or require a taller bin for export.
  expect(built.validationIssues.filter(i=>i.severity==="error")).toEqual([]);
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
