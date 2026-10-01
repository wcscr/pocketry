import { modelPlacementDefaults } from "@shared/gridfinity/model-placement";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseCutoutPlacement, resolvePocketDepth, pocketOccupiedOutline, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { importedModelSchema, MODEL_MAX_TRIANGLES, modelDimensions, modelInsertionAxis, modelFootprint, placedModelVertices } from "@shared/gridfinity/model-pocket";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { validateLayout } from "@shared/gridfinity/validate";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { extractMeshData, preparePrintableSolid, type MeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { toCrossSection } from "@/lib/geometry/offset";
import { importModelShape, modelSolid, parseStl } from "./model-import";
import { buildBinWithCutouts } from "./bin";
import * as binBuilders from "./bin";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { modelStorageEnvelope, smoothStorageBoundary } from "./model-storage-envelope";
import { buildModelPocket } from "./model-pocket";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { createModelWorkerHandlers } from "./model-worker-handlers";
import { autoPlaceFresh, autoPlaceIncremental } from "./autoplace";
import { BUILD_BIN_METHOD, type BuildBinResult } from "./worker-api";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, lip: "none", fill: "solid" });
let shape: TracedShape, p: CutoutPlacement, stl: ArrayBuffer;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => {
  arena = new Arena(); kernel = createKernel(wasm, arena);
  // Two different heights in one connected solid; a silhouette extrusion would lose the step.
  const left = arena.track(kernel.Manifold.cube([10, 16, 20]).translate([-10, -8, 0]));
  const right = arena.track(kernel.Manifold.cube([10, 16, 10]).translate([0, -8, 0]));
  const source = arena.track(left.add(right));
  stl = writeBinarySTL(extractMeshData(kernel, source));
  shape = importModelShape(kernel, stl, "mm", "Stepped tool", "tool");
  p = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 0, y: 0 }, ...modelPlacementDefaults(shape.model!, spec), clearanceMm: 0, modelSmoothingMm: 0, elevationMm: 30 });
});
afterEach(() => arena.dispose());
const context = () => ({ signal: new AbortController().signal, progress: () => {} });

describe("model input", () => {
  it("reads binary STL with a solid header, welds vertices, and confirms source units", () => {
    new Uint8Array(stl).set(new TextEncoder().encode("solid binary"));
    const model = parseStl(stl, "in");
    modelDimensions(model).forEach((n, i) => expect(n).toBeCloseTo([508, 406.4, 508][i], 3));
    expect(model.units).toBe("in");
    expect(model.positions.length).toBeLessThan(model.indices.length * 3);
  });
  it("reads ASCII STL and preserves the same solid", () => {
    const model = shape.model!;
    const facets = Array.from({length: model.indices.length / 3}, (_, i) =>
      `facet normal 0 0 0\nouter loop\n${model.indices.slice(i*3,i*3+3).map(n => `vertex ${model.positions.slice(n*3,n*3+3).join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n");
    const parsed = parseStl(new TextEncoder().encode(`solid fixture\n${facets}\nendsolid fixture\n`).buffer, "mm");
    expect(modelSolid(kernel, parsed).volume()).toBeCloseTo(4800, 4);
  });
  it("rejects incomplete, nonfinite, open, reversed and excessive meshes with useful errors", () => {
    expect(() => parseStl(stl.slice(0,-1), "mm")).toThrow(/complete/);
    const nan = stl.slice(0); new DataView(nan).setFloat32(96, NaN, true);
    expect(() => parseStl(nan,"mm")).toThrow(/invalid coordinates/);
    const open = stl.slice(0,-50); new DataView(open).setUint32(80,(open.byteLength-84)/50,true);
    expect(() => parseStl(open,"mm")).toThrow(/watertight/);
    const reversed = {...shape.model!, indices: shape.model!.indices.toReversed()};
    expect(() => modelSolid(kernel, reversed)).toThrow(/positive solid volume/);
    const large = new ArrayBuffer(84 + (MODEL_MAX_TRIANGLES + 1) * 50);
    new DataView(large).setUint32(80, MODEL_MAX_TRIANGLES+1, true);
    expect(() => parseStl(large,"mm")).toThrow(/Simplify/);
    expect(importedModelSchema.safeParse({...shape.model, indices:[0,1,999999,0,1,2,0,1,2,0,1,2]}).success).toBe(false);
  });
  it("accepts nonzero microscopic faces without mistaking them for collapsed triangles", () => {
    const offset = shape.model!.positions.length / 3;
    const tiny = [15,0,0, 15.000001,0,0, 15,0.000001,0, 15,0,1];
    const tetra = [0,2,1,0,1,3,1,2,3,2,0,3].map(i=>i+offset);
    const buffer = writeBinarySTL({positions:new Float32Array([...shape.model!.positions,...tiny]),indices:new Uint32Array([...shape.model!.indices,...tetra])});
    expect(()=>modelSolid(kernel,parseStl(buffer,"mm"))).not.toThrow();
    const collapsed = buffer.slice(0);
    const triangle = shape.model!.indices.length / 3;
    // Collapse one corner of the tiny tetrahedron to another, making zero area.
    new Uint8Array(collapsed,84+triangle*50+24,12).set(new Uint8Array(collapsed,84+triangle*50+12,12));
    expect(()=>parseStl(collapsed,"mm")).toThrow(/collapsed/);
  });
  it("uses the same import handler and cancels before kernel work", async () => {
    const importHandler = createModelWorkerHandlers(async () => wasm).importStl as (payload: unknown, context: HandlerContext) => Promise<TransferableResult<TracedShape>>;
    const request = {buffer:stl,units:"mm",name:"From worker",id:"worker-tool"};
    const result = await importHandler(request, context()) as TransferableResult<TracedShape>;
    expect(result.value.model).toEqual(shape.model);
    const abort = new AbortController(); abort.abort();
    await expect(importHandler(request, {...context(),signal:abort.signal})).rejects.toThrow(/cancel/i);
  });
});

function seatedModel(placed: CutoutPlacement, input = shape) {
  const original = modelSolid(kernel, input.model!);
  const scaled = arena.track(original.scale([placed.scaleX * (placed.mirrored ? -1 : 1), placed.scaleY, placed.modelScaleZ ?? 1]));
  const rotated = arena.track(scaled.rotate([placed.tilt?.xDeg ?? 0, placed.tilt?.yDeg ?? 0, placed.rotationDeg]));
  return arena.track(rotated.translate([placed.position.x, placed.position.y, placed.elevationMm! - rotated.boundingBox().min[2]]));
}

function expectClearInsertion(placed: CutoutPlacement, input = shape) {
  const cutter = buildModelPocket(kernel, input, placed, spec).cutters[0];
  const original = seatedModel(placed, input), direction = modelInsertionAxis(placed);
  const top = resolvePocketDepth(spec, placed.depth).cutterTopZ;
  const travel = (top - placed.elevationMm! + 1) / direction.z;
  for (let step = 0; step <= 12; step++) {
    const distance = travel * step / 12;
    const shifted = arena.track(original.translate([direction.x * distance, direction.y * distance, direction.z * distance]));
    const inBin = arena.track(shifted.trimByPlane([0, 0, -1], -top));
    expect(arena.track(inBin.subtract(cutter)).volume(), JSON.stringify({step,cutter:cutter.boundingBox(),original:original.boundingBox()})).toBeLessThan(1e-4);
  }
  return cutter;
}

describe("model insertion cavities", () => {
  it("migrates schema-27 model geometry, history and transform references alongside schema-28 text", () => {
    const {surfaceTexts:_texts,textColor:_color,...legacySpec} = spec;
    const doc = {spec:legacySpec,cutouts:[p],fingerHoles:[]};
    const input = {schemaVersion:27,...doc,shapes:[shape],history:{index:0,stack:[{doc,label:"Import model"}]},
      transformOrigins:{pockets:[{cutout:p,spec:legacySpec}],fingerHoles:[]}};
    const before = structuredClone(input);
    const migrated = parseProjectDoc(input)!;
    expect(migrated.schemaVersion).toBe(28);
    expect(migrated.shapes[0].model).toEqual(shape.model);
    expect(migrated.cutouts).toEqual([p]);
    expect(migrated.history!.stack[0].doc.cutouts).toEqual([p]);
    expect(migrated.transformOrigins!.pockets[0].cutout).toEqual(p);
    expect(migrated.spec.surfaceTexts).toEqual([]);
    expect(migrated.history!.stack[0].doc.spec.surfaceTexts).toEqual([]);
    const label = surfaceTextSchema.parse({id:"label",text:"TOOL",position:{x:0,y:25}});
    const mixedDoc = {spec:{...migrated.spec,surfaceTexts:[label]},cutouts:[p],fingerHoles:[]};
    const mixed = {...migrated,...mixedDoc,
      history:{index:1,stack:[...migrated.history!.stack,{doc:mixedDoc,label:"Add text"}]}};
    expect(parseProjectDoc(JSON.parse(JSON.stringify(mixed)))).toEqual(mixed);
    expect(input).toEqual(before);
  });

  it("preserves model linings and separate text parts through cached inspection, edits and export", async () => {
    const handler = createBinWorkerHandlers(async () => wasm)[BUILD_BIN_METHOD] as (payload: unknown, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
    const label = surfaceTextSchema.parse({id:"label",text:"TOOL",position:{x:0,y:25}});
    const request = {spec:{...spec,surfaceTexts:[label]},quality:{circularSegments:16},
      layout:{shapes:[shape],cutouts:[{...p,modelSmoothingMm:1,clearanceMm:0.3}],fingerHoles:[]},
      pocketFloorMaterialThicknessMm:0.6,stackingRimMaterialThicknessMm:0.6};
    const spy = vi.spyOn(binBuilders,"buildBinWithCutouts");
    try {
      const full = await handler(request,context());
      const volume = full.value.stats.volumeMm3;
      structuredClone(full.value,{transfer:full.transfer});
      const clipped = (await handler({...request,section:{axis:"x",offsetMm:0}},context())).value;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(clipped.stats.volumeMm3).toBe(volume);
      expect(clipped.textMeshes?.[0].label).toEqual(label);
      expect(clipped.materialMeshes?.pocketFloors).toBeDefined();
      expect(Math.max(...clipped.textMeshes![0].mesh.positions.filter((_,i)=>i%3===0))).toBeLessThanOrEqual(0.0001);
      const edited = {...request,spec:{...request.spec,surfaceTexts:[{...label,text:"DRIVER"}]}};
      const changed = (await handler(edited,context())).value;
      expect(spy).toHaveBeenCalledTimes(2);
      expect(changed.textMeshes?.[0].label.text).toBe("DRIVER");
      const exported = (await handler({...edited,exportTopology:true},context())).value;
      expect(spy).toHaveBeenCalledTimes(3);
      const parts = [
        {name:"Body",mesh:exported.materialMeshes!.body},
        {name:"Pocket lining",mesh:exported.materialMeshes!.pocketFloors!},
        {name:"Rim",mesh:exported.materialMeshes!.stackingRim!},
        ...exported.textMeshes!.map(part=>({name:`Text: ${part.label.text}`,mesh:part.mesh})),
      ];
      for (const mesh of [exported.mesh,exported.bodyMesh!,...parts.map(part=>part.mesh)]) {
        expect(()=>parseStl(writeBinarySTL(mesh),"mm")).not.toThrow();
      }
      const model = strFromU8(unzipSync(writeThreeMf(parts,{assemble:true}))["3D/3dmodel.model"]);
      expect(model).toContain('name="Text: DRIVER"');
      expect(model.match(/<component /g)).toHaveLength(4);
      expect(exported.validationIssues?.filter(issue=>issue.severity==="error")).toEqual([]);
      await expect(handler({...edited,spec:{...edited.spec,surfaceTexts:[{...label,position:{x:0,y:0}}]},exportTopology:true},context())).rejects.toThrow("clear of pockets");
    } finally {spy.mockRestore();}
  });
  it.each([{xDeg:-90,yDeg:0}, {xDeg:90,yDeg:0}, {xDeg:0,yDeg:-90}, {xDeg:0,yDeg:90}])("keeps previews and resizing live for an invalid horizontal path %o, but blocks export", async tilt => {
    const handler = createBinWorkerHandlers(async () => wasm)[BUILD_BIN_METHOD] as (payload: unknown, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
    const invalid = {...p, tilt, modelSmoothingMm:1};
    const valid = {...p, id:"other-pocket", position:{x:25,y:0}};
    const layout = {shapes:[shape],cutouts:[invalid,valid],fingerHoles:[]};
    const original = structuredClone(layout);
    const request = {spec,quality:{circularSegments:16},layout};
    const first = (await handler(request,context())).value;
    expect(first.validationIssues).toContainEqual(expect.objectContaining({code:"invalid-model-pocket",severity:"error",cutoutIds:[p.id]}));
    expect(first.cutoutReports?.map(report=>report.id)).toEqual([valid.id]);
    const withoutInvalid = (await handler({...request,layout:{...layout,cutouts:[valid]}},context())).value;
    expect(first.stats.volumeMm3).toBeCloseTo(withoutInvalid.stats.volumeMm3,4);
    const largerSpec = {...spec,gridX:3,heightUnits:7};
    const enlarged = (await handler({...request,spec:largerSpec},context())).value;
    expect(enlarged.stats.volumeMm3).toBeGreaterThan(first.stats.volumeMm3);
    expect(Math.max(...enlarged.mesh.positions.filter((_,i)=>i%3===0))).toBeGreaterThan(Math.max(...first.mesh.positions.filter((_,i)=>i%3===0)));
    const cached = (await handler({...request,spec:largerSpec,section:{axis:"y",offsetMm:0}},context())).value;
    expect(cached.validationIssues).toEqual(enlarged.validationIssues);
    await expect(handler({...request,exportTopology:true},context())).rejects.toThrow(/Vertical drop-in/);
    const corrected = {...invalid,modelInsertionMode:"vertical" as const};
    const repaired = (await handler({...request,exportTopology:true,layout:{...layout,cutouts:[corrected,valid]}},context())).value;
    expect(repaired.validationIssues?.filter(i=>i.severity==="error")).toEqual([]);
    expect(repaired.stats.volumeMm3).toBeLessThan(first.stats.volumeMm3);
    expect(()=>parseStl(writeBinarySTL(repaired.mesh),"mm")).not.toThrow();
    expect(layout).toEqual(original);
    // Picking/packing must not inflate an invalid sideways model by hundreds of mm.
    const footprint = modelFootprint(shape.model!,invalid,42)[0].outer;
    const vertices = placedModelVertices(shape.model!,invalid);
    for (const axis of ["x","y"] as const) {
      const span = Math.max(...footprint.map(v=>v[axis]))-Math.min(...footprint.map(v=>v[axis]));
      const sourceSpan = Math.max(...vertices.map(v=>v[axis]))-Math.min(...vertices.map(v=>v[axis]));
      expect(span-sourceSpan).toBeLessThan(10);
    }
  });
  it.each([[0,0,0,false],[35,20,17,false],[125,-24,20,false],[0,60,0,true]])("clears the entire rotated-axis path at %s/%s/%s with mirror %s", (xDeg,yDeg,rotationDeg,mirrored) => {
    const placed = {...p, tilt:{xDeg,yDeg},rotationDeg,mirrored,scaleX:1.2,scaleY:0.8,modelScaleZ:1.5};
    const solid = expectClearInsertion(placed);
    expect(solid.boundingBox().min[2]).toBeCloseTo(30,4);
    const geometry = resolvedPocketGeometry(kernel,shape,placed,spec);
    const actual = toCrossSection(kernel,geometry.opening), expected = arena.track(solid.slice(42-1e-7));
    expect(arena.track(actual.subtract(expected)).area()).toBeCloseTo(0,4);
    expect(arena.track(expected.subtract(actual)).area()).toBeCloseTo(0,4);
  });
  it("opens a submerged model and removes overhangs while preserving a stepped seat", () => {
    const solid = expectClearInsertion(p);
    expect(arena.track(solid.slice(35)).area()).toBeCloseTo(320,1);
    expect(toCrossSection(kernel,resolvedPocketGeometry(kernel,shape,p,spec).opening).area()).toBeCloseTo(320,1);
    expect(toCrossSection(kernel,resolvedPocketGeometry(kernel,shape,{...p,elevationMm:8},spec).opening).area()).toBeCloseTo(320,1);
    const inverted = expectClearInsertion({...p,tilt:{xDeg:180,yDeg:0}});
    expect(arena.track(inverted.slice(35)).area()).toBeCloseTo(160,1);
    expect(arena.track(inverted.slice(41)).area()).toBeCloseTo(320,1);
    const expanded = buildModelPocket(kernel,shape,{...p,clearanceMm:0.5},spec).cutters[0];
    expanded.boundingBox().min.forEach((n,i)=>expect(n).toBeCloseTo([-10.5,-8.5,30][i],3));
    expanded.boundingBox().max.slice(0,2).forEach((n,i)=>expect(n).toBeCloseTo([10.5,8.5][i],3));
  });
  it("supports vertical drop-in independently of the model angle, including sideways poses", () => {
    const angled = {...p,tilt:{xDeg:35,yDeg:15},rotationDeg:25};
    const vertical = {...angled,modelInsertionMode:"vertical" as const};
    const axisCutter = expectClearInsertion(angled), verticalCutter = expectClearInsertion(vertical);
    expect(seatedModel(angled).volume()).toBeCloseTo(seatedModel(vertical).volume(),5);
    expect(arena.track(verticalCutter.subtract(axisCutter)).volume()).toBeGreaterThan(10);
    expect(arena.track(axisCutter.subtract(verticalCutter)).volume()).toBeGreaterThan(10);
    expectClearInsertion({...vertical,tilt:{xDeg:90,yDeg:0}});
    expect(()=>buildModelPocket(kernel,shape,{...angled,tilt:{xDeg:90,yDeg:0}},spec)).toThrow(/Vertical drop-in/);
    expect(pocketOccupiedOutline(shape,angled,spec)).not.toEqual(pocketOccupiedOutline(shape,vertical,spec));
  });
  it.each(["axis", "vertical"] as const)("keeps fit clearance throughout the %s insertion path", modelInsertionMode => {
    const placed = {...p,tilt:{xDeg:30,yDeg:20},rotationDeg:17,clearanceMm:0.2,modelInsertionMode};
    const box = arena.track(kernel.Manifold.cube([0.4,0.4,0.4],true));
    const expanded = arena.track(modelSolid(kernel,shape.model!).minkowskiSum(box));
    const rotated = arena.track(expanded.rotate([30,20,17]));
    const seated = arena.track(rotated.translate([0,0,placed.elevationMm!-rotated.boundingBox().min[2]]));
    const cutter = buildModelPocket(kernel,shape,placed,spec).cutters[0];
    const direction = modelInsertionAxis(placed), top = resolvePocketDepth(spec,placed.depth).cutterTopZ;
    for (const fraction of [0,0.25,0.5,0.75,1]) {
      const t = (top-placed.elevationMm!+1)*fraction/direction.z;
      const moved = arena.track(seated.translate([t*direction.x,t*direction.y,t*direction.z]));
      const clipped = arena.track(moved.trimByPlane([0,0,-1],-top));
      expect(arena.track(clipped.subtract(cutter)).volume()).toBeLessThan(1e-4);
    }
  });
  it("clears enclosed voids without replacing a concave model by its convex hull", () => {
    const box = arena.track(kernel.Manifold.cube([20,20,20],true));
    const inside = arena.track(kernel.Manifold.cube([12,12,12],true));
    const shell = arena.track(box.subtract(inside));
    const hollow = importModelShape(kernel,writeBinarySTL(extractMeshData(kernel,shell)),"mm","Hollow model","hollow");
    const cavity = expectClearInsertion({...p,shapeId:hollow.id,elevationMm:10},hollow);
    expect(arena.track(cavity.slice(20)).area()).toBeCloseTo(400,1);
    const notch = arena.track(kernel.Manifold.cube([15,15,30]).translate([0,0,-15]));
    const concave = arena.track(box.subtract(notch));
    const lShape = importModelShape(kernel,writeBinarySTL(extractMeshData(kernel,concave)),"mm","L model","l");
    const lCavity = expectClearInsertion({...p,shapeId:lShape.id,elevationMm:10},lShape);
    expect(arena.track(lCavity.slice(20)).area()).toBeCloseTo(300,1);
  });
  it("validates walls against the angled insertion path above the seated model", () => {
    const tool = arena.track(kernel.Manifold.cube([4,4,8],true));
    const small = importModelShape(kernel,writeBinarySTL(extractMeshData(kernel,tool)),"mm","Small model","small");
    const placed = {...p,shapeId:small.id,position:{x:25,y:0},elevationMm:10,tilt:{xDeg:0,yDeg:40}};
    expect(seatedModel(placed,small).boundingBox().max[0]).toBeLessThan(32);
    const layout = {shapesById:new Map([[small.id,small]]),cutouts:[placed],fingerHoles:[]};
    const angled = buildBinWithCutouts(kernel,spec,layout,{circularSegments:16});
    expect(angled.validationIssues.some(i=>i.code==="tilted-pocket-wall")).toBe(true);
    const vertical = buildBinWithCutouts(kernel,spec,{...layout,cutouts:[{...placed,modelInsertionMode:"vertical"}]},{circularSegments:16});
    expect(vertical.validationIssues.filter(i=>i.severity==="error")).toEqual([]);
  });
  it("persists mesh and transforms through project export, history and old-schema migration", () => {
    const savedPlacement = {...p,modelInsertionMode:"vertical" as const};
    const doc = {spec,cutouts:[savedPlacement],fingerHoles:[]};
    const json = JSON.stringify({...doc,schemaVersion:PROJECT_SCHEMA_VERSION,shapes:[shape],history:{stack:[{doc,label:"Import model"}],index:0}});
    const saved = parseProjectDoc(JSON.parse(json));
    expect(saved?.shapes[0].model).toEqual(shape.model);
    expect(saved?.history?.stack[0].doc.cutouts[0]).toEqual(savedPlacement);
    expect(parseProjectDoc({...doc,schemaVersion:26,shapes:[shape]})?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const layout = autoPlaceFresh([shape],"none","full",spec);
    const incremental = autoPlaceIncremental([shape],{spec,lip:"none",gridX:2,gridY:2,existing:[],shapesById:new Map(),keepBinSize:true});
    for (const c of [layout.cutouts[0],incremental.cutouts[0]]) {
      expect(c.modelScaleZ).toBe(1); expect(c.elevationMm).toBe(27);
      expect(validateLayout(spec,[c],new Map([[shape.id,shape]])).filter(i=>i.severity==="error")).toEqual([]);
    }
  });
  it.each(["axis", "vertical"] as const)("lines steep model faces without changing the %s cavity or leaving material gaps", modelInsertionMode => {
    // The fixture has a 10 mm vertical riser between its two seating levels.
    // Translating the cavity downward colors each tread but leaves this face bare.
    const underside = arena.track(modelSolid(kernel,shape.model!).scale([1,1,-1]));
    shape = importModelShape(kernel,writeBinarySTL(extractMeshData(kernel,underside)),"mm","Stepped underside",shape.id);
    const placed = {...p, modelInsertionMode};
    const cavity = buildModelPocket(kernel, shape, placed, spec).cutters[0];
    const lined = buildModelPocket(kernel, shape, placed, spec, 0.6);
    const probe = arena.track(kernel.Manifold.cube([0.2, 1, 1]).translate([0.1, -0.5, 34]));
    expect(arena.track(lined.floorInserts[0].intersect(probe)).volume()).toBeCloseTo(probe.volume(), 5);
    expect(arena.track(lined.cutters[0].subtract(cavity)).volume()).toBeLessThan(1e-6);
    expect(arena.track(cavity.subtract(lined.cutters[0])).volume()).toBeLessThan(1e-6);
    const built = buildBinWithCutouts(kernel, spec,
      {shapesById:new Map([[shape.id,shape]]),cutouts:[placed],fingerHoles:[]},
      {circularSegments:16}, {floorInsertThicknessMm:0.6});
    const {body, pocketFloors} = built.materialParts!;
    expect(arena.track(body.intersect(probe)).volume()).toBeLessThan(1e-6);
    expect(arena.track(body.intersect(pocketFloors!)).volume()).toBeLessThan(1e-6);
    const joined = arena.track(body.add(pocketFloors!));
    expect(arena.track(built.solid.subtract(joined)).volume()).toBeLessThan(1e-6);
    expect(arena.track(joined.subtract(built.solid)).volume()).toBeLessThan(1e-6);
    for (const part of [built.solid,body,pocketFloors!]) {
      expect(() => modelSolid(kernel,parseStl(writeBinarySTL(extractMeshData(kernel,preparePrintableSolid(kernel,part))),"mm"))).not.toThrow();
    }
  });
  it("exports closed STL and 3MF with material floors, rejects unsafe placement and legacy contour edits", async () => {
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (payload: unknown, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
    const request = {spec,quality:{circularSegments:16},exportTopology:true,pocketFloorMaterialThicknessMm:0.6,
      layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}};
    const built = (await handler(request,context()) as TransferableResult<BuildBinResult>).value;
    const mesh = parseStl(writeBinarySTL(built.mesh),"mm");
    expect(modelSolid(kernel,mesh).volume()).toBeCloseTo(built.stats.volumeMm3,1);
    expect(built.materialMeshes?.pocketFloors).toBeDefined();
    for (const part of Object.values(built.materialMeshes!)) expect(() => parseStl(writeBinarySTL(part),"mm")).not.toThrow();
    const xml = strFromU8(unzipSync(writeThreeMf([{name:"Model bin",mesh:built.mesh}]))["3D/3dmodel.model"]);
    expect(xml.match(/<triangle /g)?.length).toBe(built.mesh.indices.length/3);
    for (const patch of [{elevationMm:1},{position:{x:35,y:0}},{topFilletMm:1},{depth:{mode:"through"}}]) {
      await expect(handler({...request,layout:{...request.layout,cutouts:[{...p,...patch}]}},context())).rejects.toThrow();
    }
  });
  it("keeps cavity lining and configurable top borders closed and disjoint in export", async () => {
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (payload: unknown, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
    const built = (await handler({ spec, quality: { circularSegments: 16 }, exportTopology: true,
      pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 1.25, borderWidthMm: 4,
      layout: { shapes: [shape], cutouts: [{ ...p, clearanceMm: 0.3, modelSmoothingMm: 1 }], fingerHoles: [] },
    }, context())).value;
    expect(built.materialMeshes?.pocketFloors).toBeDefined();
    expect(built.materialMeshes?.stackingRim).toBeDefined();
    const inBinCoordinates = (mesh: MeshData) => {
      // Validate serialized topology, but keep the original shared coordinates:
      // the model importer recenters each incoming object independently.
      expect(() => parseStl(writeBinarySTL(mesh), "mm")).not.toThrow();
      const input = new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
      input.merge();
      const solid = arena.track(new kernel.Manifold(input));
      expect(solid.status()).toBe("NoError");
      return solid;
    };
    const combined = inBinCoordinates(built.mesh);
    const parts = Object.values(built.materialMeshes!).map(inBinCoordinates);
    const joined = arena.track(kernel.Manifold.union(parts));
    expect(arena.track(combined.subtract(joined)).volume()).toBeLessThan(0.01);
    expect(arena.track(joined.subtract(combined)).volume()).toBeLessThan(0.01);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      expect(arena.track(parts[i].intersect(parts[j])).volume()).toBeLessThan(0.01);
    }
  });
});

describe("practical storage shape", () => {
  it("starts with an adjustable 0.3 mm margin and 1 mm smoothing radius", () => {
    expect(modelPlacementDefaults(shape.model!, spec)).toMatchObject({ clearanceMm: 0.3, modelSmoothingMm: 1 });
  });
  it.each(["axis", "vertical"] as const)("clears the original tool throughout %s insertion after smoothing, scale and mirror", modelInsertionMode => {
    for (const [xDeg,yDeg] of [[0,0],[35,20],[125,-24],[0,80]]) {
      const placed = {...p, modelInsertionMode, modelSmoothingMm:1, clearanceMm:0.3,
        tilt:{xDeg,yDeg},rotationDeg:17,scaleX:1.2,scaleY:0.8,modelScaleZ:1.5,mirrored:true};
      const cutter = expectClearInsertion(placed);
      expect(cutter.boundingBox().min[2]).toBeCloseTo(p.elevationMm!,4);
    }
  }, 15_000);
  it("clears narrow grooves into a rounded cradle while keeping a broad recess", () => {
    const base = arena.track(kernel.Manifold.cube([20,16,10],true));
    const narrow = arena.track(kernel.Manifold.cube([0.8,20,6]).translate([-5.4,-10,-5]));
    const broad = arena.track(kernel.Manifold.cube([6,20,6]).translate([1,-10,-5]));
    const tool = arena.track(kernel.Manifold.difference([base,narrow,broad]));
    const raw = modelStorageEnvelope(kernel,tool,25,0,0);
    const cradle = modelStorageEnvelope(kernel,tool,25,1,0.3);
    expect(arena.track(tool.subtract(cradle)).volume()).toBeLessThan(1e-5);
    const rib = arena.track(kernel.Manifold.cube([0.4,8,2]).translate([-5.2,-4,-4]));
    expect(arena.track(rib.subtract(raw)).volume()).toBeGreaterThan(5);
    expect(arena.track(rib.subtract(cradle)).volume()).toBeLessThan(1e-5);
    const wideRecess = arena.track(kernel.Manifold.cube([2,8,2]).translate([3,-4,-4]));
    expect(arena.track(wideRecess.subtract(cradle)).volume()).toBeGreaterThan(25);
    expect(cradle.status()).toBe("NoError");
  });
  it("does not lose thin features between sampling points or disconnected components", () => {
    const thin = arena.track(kernel.Manifold.cube([0.03,8,6],true).rotate([13,9,27]));
    const second = arena.track(kernel.Manifold.cube([2,2,4],true).translate([5,0,2]));
    const tool = arena.track(thin.add(second));
    const cavity = modelStorageEnvelope(kernel,tool,25,1,0);
    expect(arena.track(tool.subtract(cavity)).volume()).toBeLessThan(1e-5);
    expect(cavity.status()).toBe("NoError");
  });
});

it("replaces raster staircase edges with clean spans without tightening the cavity", () => {
  const ring: [number,number][] = [[0,0],[20,0],[20,20]];
  for (let n=39; n>=0; n--) ring.push([n/2,(n+1)/2],[n/2,n/2]);
  ring.pop();
  const section = arena.track(new kernel.CrossSection([ring]));
  const staircase = arena.track(kernel.Manifold.extrude(section,10));
  const smoothed = smoothStorageBoundary(kernel,staircase,0.5);
  expect(arena.track(staircase.subtract(smoothed)).volume()).toBeLessThan(1e-4);
  const before = arena.track(arena.track(staircase.slice(5)).simplify(0.0001)).toPolygons().flat().length;
  expect(before).toBeGreaterThan(70);
  // Rounded corners have more vertices; each is a gradual turn, not a new notch.
  const outline = arena.track(arena.track(smoothed.slice(5)).simplify(0.0001)).toPolygons()[0];
  let sharpTurns = 0;
  for (let i=0; i<outline.length; i++) {
    const a=outline[(i+outline.length-1)%outline.length], b=outline[i], c=outline[(i+1)%outline.length];
    const u=[b[0]-a[0],b[1]-a[1]], v=[c[0]-b[0],c[1]-b[1]];
    const turn=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))));
    if(turn>Math.PI/2-0.01) sharpTurns++;
  }
  expect(sharpTurns).toBe(0);
  // The cleanup is local: it cannot become a loose bounding box.
  const untouched = arena.track(kernel.Manifold.cube([2,2,8]).translate([0,16,1]));
  expect(arena.track(untouched.intersect(smoothed)).volume()).toBeLessThan(1e-5);
  const originalBounds = staircase.boundingBox(), bounds = smoothed.boundingBox();
  for (let axis=0; axis<2; axis++) {
    expect(bounds.min[axis]).toBeGreaterThanOrEqual(originalBounds.min[axis]-1.5);
    expect(bounds.max[axis]).toBeLessThanOrEqual(originalBounds.max[axis]+1.5);
  }
});

it("keeps inward and outward contour turns gradual through the depth of the cradle", () => {
  const section = arena.track(new kernel.CrossSection([[[0,0],[20,0],[20,8],[8,8],[8,20],[0,20]]]));
  const source = arena.track(kernel.Manifold.extrude(section,10));
  const cavity = modelStorageEnvelope(kernel,source,25,1,0.3);
  expect(arena.track(source.subtract(cavity)).volume()).toBeLessThan(1e-4);
  for (const height of [1,5,15]) {
    const rings = arena.track(arena.track(cavity.slice(height)).simplify(0.001)).toPolygons();
    for (const ring of rings) for (let i=0; i<ring.length; i++) {
      const a=ring[(i+ring.length-1)%ring.length], b=ring[i], c=ring[(i+1)%ring.length];
      const u=[b[0]-a[0],b[1]-a[1]], v=[c[0]-b[0],c[1]-b[1]];
      const cosine=(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v));
      expect(cosine,JSON.stringify({height,corner:b})).toBeGreaterThan(0.01);
    }
  }
});
