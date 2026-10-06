import { validateLayout } from "@shared/gridfinity/validate";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import { fingerHoleSchema, parseCutoutPlacement, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { pocketDepthChangePatch } from "@shared/gridfinity/pocket-depth-change";
import { pegBottomExtensionMm } from "@shared/gridfinity/peg-bottom";
import { binTotalHeightMm } from "@shared/gridfinity/standard";
import { parseBinSpec } from "@shared/gridfinity/types";
import { loadManifold } from "@/lib/manifold/runtime";
import type { HandlerContext } from "@/lib/worker/host";
import type { TransferableResult } from "@/lib/worker/host";
import { WorkerCancelledError } from "@/lib/worker/protocol";

import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { partitionPocketFloorTriangles } from "./pocket-floor-mesh";
import { createBasicPocket } from "./basic-shape";
import { EXPORT_QUALITY } from "./bin";
import {
  BUILD_BIN_METHOD,
  BUILD_FIT_CHECK_METHOD,
  BUILD_SURFACE_FIT_CHECK_METHOD,
  type BuildBinRequest,
  type BuildBinResult,
  type BuildFitCheckRequest,
  type BuildFitCheckResult,
  type BuildSurfaceFitCheckRequest,
  type BuildSurfaceFitCheckResult,
} from "./worker-api";

/**
 * The handlers are exercised directly with the real WASM — the RPC transport
 * (supersede, cancel wire format, transferables in flight) already has its
 * own suite in lib/worker/client.test.ts.
 */

type BuildHandler = (
  payload: BuildBinRequest,
  context: HandlerContext,
) => Promise<TransferableResult<BuildBinResult>>;

function getHandler(): BuildHandler {
  return createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as BuildHandler;
}

type FitCheckHandler = (
  payload: BuildFitCheckRequest,
  context: HandlerContext,
) => Promise<TransferableResult<BuildFitCheckResult>>;

function getFitCheckHandler(): FitCheckHandler {
  return createBinWorkerHandlers(loadManifold)[
    BUILD_FIT_CHECK_METHOD
  ] as unknown as FitCheckHandler;
}

type SurfaceFitCheckHandler = (
  payload: BuildSurfaceFitCheckRequest,
  context: HandlerContext,
) => Promise<TransferableResult<BuildSurfaceFitCheckResult>>;

function getSurfaceFitCheckHandler(): SurfaceFitCheckHandler {
  return createBinWorkerHandlers(loadManifold)[
    BUILD_SURFACE_FIT_CHECK_METHOD
  ] as unknown as SurfaceFitCheckHandler;
}

function context(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    signal: new AbortController().signal,
    progress: () => {},
    ...overrides,
  };
}

function nonManifoldEdgeCount(mesh: BuildBinResult["mesh"], weldPositions = false): number {
  // Render normals duplicate vertices along sharp edges. STL uses positions,
  // so join those copies when checking a mesh extracted with normals enabled.
  const vertexKey = (index: number) => weldPositions
    ? mesh.positions.subarray(index * 3, index * 3 + 3).join(",")
    : String(index);
  const edgeCounts = new Map<string, number>();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.subarray(offset, offset + 3);
    for (const [a, b] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ]) {
      const start = vertexKey(a);
      const end = vertexKey(b);
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  return [...edgeCounts.values()].filter((count) => count !== 2).length;
}

function printableMeshVolume(mesh: BuildBinResult["mesh"]): number {
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = Array.from(mesh.indices.subarray(i, i + 3), n => mesh.positions.subarray(n * 3, n * 3 + 3));
    const u = Array.from(b, (v, j) => v - a[j]), v = Array.from(c, (n, j) => n - a[j]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    expect(Math.hypot(...cross), `triangle ${JSON.stringify([Array.from(a),Array.from(b),Array.from(c)])}`).toBeGreaterThan(0);
    total += (a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2]) / 6;
  }
  expect(nonManifoldEdgeCount(mesh, true)).toBe(0);
  return total;
}

const REQUEST: BuildBinRequest = {
  spec: { gridX: 1, gridY: 1, heightUnits: 2 },
  quality: { circularSegments: 16 },
};

it.each(["axis","vertical"] as const)("exports a submerged tilted pocket with %s clearance as closed colored STL/3MF", async insertionMode => {
  const {shape,cutout} = createBasicPocket("rectangle",{x:-10,y:-12},{x:10,y:12},"submerged")!;
  const p = parseCutoutPlacement({...cutout,elevationMm:7,tilt:{xDeg:20,yDeg:25},rotationDeg:17,
    depth:{mode:"mm",value:16},insertionMode,topFilletMm:2,bottomFilletMm:1});
  const request: BuildBinRequest = {spec:{gridX:3,gridY:3,heightUnits:8,fill:"solid",lip:"none"},
    quality:EXPORT_QUALITY,exportTopology:true,pocketFloorMaterialThicknessMm:0.6,stackingRimMaterialThicknessMm:1.25,
    borderWidthMm:2,layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}};
  const result = (await getHandler()(request,context())).value;
  const closed = (await getHandler()({...request,layout:{...request.layout!,cutouts:[{...p,insertionMode:undefined}]}},context())).value;
  expect(result.validationIssues?.filter(issue=>issue.severity === "error")).toEqual([]);
  expect(printableMeshVolume(closed.mesh)-printableMeshVolume(result.mesh)).toBeGreaterThan(5000);
  const sum = Object.values(result.materialMeshes!).reduce((total,mesh)=>total+printableMeshVolume(mesh),0);
  expect(Math.abs(sum-printableMeshVolume(result.mesh))).toBeLessThan(0.1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84+result.mesh.indices.length/3*50);
  const parts = Object.entries(result.materialMeshes!).map(([name,mesh])=>({name,mesh}));
  const model = strFromU8(unzipSync(writeThreeMf(parts))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(parts.reduce((sum,part)=>sum+part.mesh.indices.length/3,0));
});

it("restores the full colored bin when the finite through object is raised above it", async () => {
  const {shape,cutout} = createBasicPocket("rectangle",{x:-10,y:-12},{x:10,y:12},"raised-through")!;
  const p = parseCutoutPlacement({...cutout,elevationMm:87,tilt:{xDeg:20,yDeg:25},rotationDeg:17,
    depth:{mode:"through",sourceDepthMm:16},insertionMode:"vertical",topFilletMm:2,bottomFilletMm:1});
  const request: BuildBinRequest = {spec:{gridX:3,gridY:3,heightUnits:8,fill:"solid",lip:"none"},
    quality:EXPORT_QUALITY,exportTopology:true,pocketFloorMaterialThicknessMm:0.6,stackingRimMaterialThicknessMm:1.25,
    borderWidthMm:2,layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}};
  const result = (await getHandler()(request,context())).value;
  const uncut = (await getHandler()({...request,layout:{shapes:[],cutouts:[],fingerHoles:[]}},context())).value;
  expect(printableMeshVolume(result.mesh)).toBeCloseTo(printableMeshVolume(uncut.mesh),4);
  for (const part of Object.values(result.materialMeshes!)) expect(printableMeshVolume(part)).toBeGreaterThan(0);
});

it.each([false,true])("exports a bounded vertical through pocket with an open underside, flat bottom=%s", async flatBottom => {
  const {shape,cutout} = createBasicPocket("rectangle",{x:-10,y:-12},{x:10,y:12},"bounded-through")!;
  const p = parseCutoutPlacement({...cutout,elevationMm:0,tilt:{xDeg:20,yDeg:25},rotationDeg:17,
    depth:{mode:"through"},insertionMode:"vertical",topFilletMm:2,bottomFilletMm:0,cornerRoundMm:1});
  const request: BuildBinRequest = {spec:{gridX:3,gridY:3,heightUnits:3,fill:"solid",lip:"none",flatBottom},
    quality:EXPORT_QUALITY,exportTopology:true,layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}};
  const result = (await getHandler()(request,context())).value;
  expect(result.validationIssues?.filter(issue=>issue.severity === "error")).toEqual([]);
  expect(printableMeshVolume(result.mesh)).toBeGreaterThan(200_000);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84+result.mesh.indices.length/3*50);
  const model = strFromU8(unzipSync(writeThreeMf([{name:"Through pocket",mesh:result.mesh}]))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(result.mesh.indices.length/3);
});

it.each([
  { tilt: undefined, insertionMode: undefined },
  { tilt: { xDeg: 20, yDeg: 25 }, insertionMode: undefined },
  { tilt: { xDeg: 20, yDeg: 25 }, insertionMode: "axis" as const },
  { tilt: { xDeg: 20, yDeg: 25 }, insertionMode: "vertical" as const },
])("exports the raised surface rim to closed STL/3MF and nonoverlapping colors with %j", async ({tilt,insertionMode}) => {
  const { shape, cutout } = createBasicPocket("rectangle", { x: -10, y: -12 }, { x: 10, y: 12 }, "raised-rim")!;
  const p = parseCutoutPlacement({ ...cutout, elevationMm: 12, tilt, insertionMode,
    depth: { mode: "mm", value: 16 }, topFilletMm: 2, bottomFilletMm: 1 });
  const request: BuildBinRequest = { spec: { gridX: 2, gridY: 2, heightUnits: insertionMode === "vertical" ? 5 : 3, fill: "solid", lip: "none" },
    quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6,
    stackingRimMaterialThicknessMm: 1.25, borderWidthMm: 2,
    layout: { shapes: [shape], cutouts: [p], fingerHoles: [] } };
  const original = structuredClone(request);
  const result = (await getHandler()(request, context())).value;
  const sharp = (await getHandler()({ ...request, layout: { ...request.layout!, cutouts: [{ ...p, topFilletMm: 0 }] } }, context())).value;
  expect(result.validationIssues).toEqual([]);
  expect(result.stats.volumeMm3).toBeLessThan(sharp.stats.volumeMm3);
  const whole = printableMeshVolume(result.mesh);
  const sum = Object.values(result.materialMeshes!).reduce((total, mesh) => total + printableMeshVolume(mesh), 0);
  expect(Math.abs(sum - whole)).toBeLessThan(0.1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84 + result.mesh.indices.length / 3 * 50);
  const parts = Object.entries(result.materialMeshes!).map(([name, mesh]) => ({ name, mesh }));
  const model = strFromU8(unzipSync(writeThreeMf(parts))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(parts.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0));
  expect(request).toEqual(original);
});

it("blocks horizontal axial exports and exports a closed vertical recovery", async () => {
  const { shape, cutout } = createBasicPocket("rectangle", {x:-10,y:-12}, {x:10,y:12}, "path-recovery")!;
  const p = parseCutoutPlacement({ ...cutout, elevationMm: 7, tilt: {xDeg:90,yDeg:0},
    depth: {mode:"mm",value:12}, insertionMode: "axis" });
  const request: BuildBinRequest = { spec: { gridX: 3, gridY: 3, heightUnits: 6, fill: "solid", lip: "none" },
    quality: EXPORT_QUALITY, exportTopology: true, layout: { shapes: [shape], cutouts: [p], fingerHoles: [] } };
  await expect(getHandler()(request, context())).rejects.toThrow("vertical drop-in");
  const recovered = (await getHandler()({ ...request, layout: { ...request.layout!, cutouts: [{ ...p, insertionMode: "vertical" }] } }, context())).value;
  expect(printableMeshVolume(recovered.mesh)).toBeGreaterThan(0);
  expect(recovered.validationIssues).toEqual([]);
});

it.each([
  {elevationMm:5.05,heightUnits:4,flatBottom:true},
  {elevationMm:7,heightUnits:4,flatBottom:false},
  {elevationMm:16.87,heightUnits:6,flatBottom:false},
])("exports the reported compound tilt with the actual rotated seat and closed color parts: %j", async ({elevationMm,heightUnits,flatBottom}) => {
  const {shape,cutout}=createBasicPocket("rectangle",{x:-10,y:-12},{x:10,y:12},"vertical-regression")!;
  const p=parseCutoutPlacement({...cutout,position:{x:28.07,y:-6.55},elevationMm,
    tilt:{xDeg:20,yDeg:25},rotationDeg:17,depth:{mode:"mm",value:16},
    insertionMode:"vertical",topFilletMm:2,bottomFilletMm:1});
  const result=(await getHandler()({spec:{gridX:3,gridY:3,heightUnits,flatBottom,fill:"solid",lip:"none"},
    quality:EXPORT_QUALITY,exportTopology:true,pocketFloorMaterialThicknessMm:0.6,
    layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}},context())).value;
  expect(result.validationIssues).toEqual([]);
  const whole=printableMeshVolume(result.mesh);
  const parts=Object.entries(result.materialMeshes!).map(([name,mesh])=>({name,mesh}));
  expect(Math.abs(parts.reduce((sum,part)=>sum+printableMeshVolume(part.mesh),0)-whole)).toBeLessThan(0.1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84+result.mesh.indices.length/3*50);
  expect(strFromU8(unzipSync(writeThreeMf(parts))["3D/3dmodel.model"]).match(/<triangle /g)?.length)
    .toBe(parts.reduce((sum,part)=>sum+part.mesh.indices.length/3,0));
});

it.each(["axis","vertical"] as const)("exports a floor-clipped %s pocket with closed material parts and retained source depth", async insertionMode => {
  const {shape,cutout}=createBasicPocket("rectangle",{x:-10,y:-12},{x:10,y:12},"floor-limit")!;
  const p=parseCutoutPlacement({...cutout,elevationMm:3,tilt:{xDeg:20,yDeg:25},rotationDeg:17,
    depth:{mode:"remaining",floorThicknessMm:9,sourceDepthMm:16},insertionMode,topFilletMm:2,bottomFilletMm:1});
  const result=(await getHandler()({spec:{gridX:3,gridY:3,heightUnits:5,fill:"solid",lip:"none"},
    quality:EXPORT_QUALITY,exportTopology:true,pocketFloorMaterialThicknessMm:0.6,
    layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}},context())).value;
  expect(result.validationIssues).toEqual([]);
  const whole=printableMeshVolume(result.mesh);
  const parts=Object.values(result.materialMeshes!);
  expect(printableMeshVolume(result.materialMeshes!.pocketFloors!)).toBeGreaterThan(0);
  expect(Math.abs(parts.reduce((sum,mesh)=>sum+printableMeshVolume(mesh),0)-whole)).toBeLessThan(0.1);
  expect(p.depth).toEqual({mode:"remaining",floorThicknessMm:9,sourceDepthMm:16});
});

it("blocks a vertical export when the tilted floor prevents a full opening", async () => {
  const {shape,cutout}=createBasicPocket("rectangle",{x:-10,y:-12},{x:10,y:12},"high-seat")!;
  const p=parseCutoutPlacement({...cutout,elevationMm:12,tilt:{xDeg:20,yDeg:25},depth:{mode:"mm",value:16},insertionMode:"vertical"});
  await expect(getHandler()({spec:{gridX:3,gridY:3,heightUnits:3,fill:"solid",lip:"none"},
    quality:EXPORT_QUALITY,exportTopology:true,layout:{shapes:[shape],cutouts:[p],fingerHoles:[]}},context()))
    .rejects.toThrow("preventing a full vertical opening");
});

it.each(["standard", "none"] as const)("exports thick hollow walls with floor and rim colors, %s lip", async lip => {
  const request: BuildBinRequest = {
    spec: { gridX: 1, gridY: 1, heightUnits: 3, fill: "none", wallThicknessMm: 3, lip },
    quality: EXPORT_QUALITY, exportTopology: true,
    pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 1.25, borderWidthMm: 3,
  };
  const result = (await getHandler()(request, context())).value;
  const whole = printableMeshVolume(result.mesh);
  expect(whole).toBeCloseTo(result.stats.volumeMm3, 1);
  expect(result.materialMeshes?.pocketFloors).toBeDefined();
  expect(result.materialMeshes?.stackingRim).toBeDefined();
  const partsVolume = Object.values(result.materialMeshes!).reduce((sum, mesh) => sum + printableMeshVolume(mesh), 0);
  expect(partsVolume).toBeCloseTo(whole, 1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84 + result.mesh.indices.length / 3 * 50);
  const model = strFromU8(unzipSync(writeThreeMf([{ name: "Thick hollow bin", mesh: result.mesh }]))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(result.mesh.indices.length / 3);
});

it.each([undefined, {xDeg:32,yDeg:-24}, {xDeg:90,yDeg:0}, {xDeg:180,yDeg:0}, {xDeg:0,yDeg:90}, {xDeg:-30,yDeg:70}])("exports a profile floor with rotation %s alongside an ordinary pocket to closed STL/3MF meshes and protects the base", async profileRotation => {
  const basic=createBasicPocket("rectangle",{x:-20,y:-10},{x:20,y:10},"profile-export")!;
  const shape={...basic.shape,outlineMm:[{outer:[[-20,-10],[0,-10],[0,0],[20,0],[20,10],[-20,10]].map(([x,y])=>({x,y})),holes:[]}]};
  const cutout=parseCutoutPlacement({...basic.cutout,profileBottom:{edge:"bottom",widthMm:9,elevationMm:12},rotationDeg:17,profileRotation});
  const ordinary=createBasicPocket("rectangle",{x:26,y:26},{x:34,y:34},"ordinary-export")!;
  const request:BuildBinRequest={spec:{gridX:2,gridY:2,heightUnits:6,fill:"solid",lip:"none"},quality:EXPORT_QUALITY,
    exportTopology:true,pocketFloorMaterialThicknessMm:0.6,layout:{shapes:[shape,ordinary.shape],cutouts:[cutout,ordinary.cutout],fingerHoles:[]}};
  const result=(await getHandler()(request,context())).value;
  const whole=printableMeshVolume(result.mesh);
  expect(Math.abs(whole-result.stats.volumeMm3)).toBeLessThan(0.1);
  expect(result.materialMeshes?.pocketFloors).toBeDefined();
  const sum=Object.values(result.materialMeshes!).reduce((total,mesh)=>total+printableMeshVolume(mesh),0);
  expect(Math.abs(sum-whole)).toBeLessThan(0.1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84+result.mesh.indices.length/3*50);
  const model=strFromU8(unzipSync(writeThreeMf([{name:"Profile bin",mesh:result.mesh}]))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(result.mesh.indices.length/3);
  await expect(getHandler()({...request,layout:{...request.layout!,cutouts:[{...cutout,profileBottom:{...cutout.profileBottom!,elevationMm:1}}]}},context())).rejects.toThrow(/at least 7 mm/);
});

it.each([undefined, {xDeg:32,yDeg:-24}, {xDeg:90,yDeg:0}, {xDeg:180,yDeg:0}, {xDeg:0,yDeg:90}, {xDeg:-30,yDeg:70}])("exports a rigid generated pocket with rotation %s alongside an ordinary pocket to closed STL/3MF meshes and protects the base", async profileRotation => {
  const basic=createBasicPocket("rectangle",{x:-20,y:-10},{x:20,y:10},"profile-export")!;
  const shape={...basic.shape,outlineMm:[{outer:[[-20,-10],[0,-10],[0,0],[20,0],[20,10],[-20,10]].map(([x,y])=>({x,y})),holes:[]}]};
  const cutout=parseCutoutPlacement({...basic.cutout,depth:{mode:"mm",value:9},elevationMm:12,rotationDeg:17,tilt:profileRotation,cornerRoundMm:0,bottomFilletMm:0});
  const ordinary=createBasicPocket("rectangle",{x:26,y:26},{x:34,y:34},"ordinary-export")!;
  const request:BuildBinRequest={spec:{gridX:2,gridY:2,heightUnits:6,fill:"solid",lip:"none"},quality:EXPORT_QUALITY,
    exportTopology:true,pocketFloorMaterialThicknessMm:0.6,layout:{shapes:[shape,ordinary.shape],cutouts:[cutout,ordinary.cutout],fingerHoles:[]}};
  const result=(await getHandler()(request,context())).value;
  const whole=printableMeshVolume(result.mesh);
  expect(Math.abs(whole-result.stats.volumeMm3)).toBeLessThan(0.1);
  expect(result.materialMeshes?.pocketFloors).toBeDefined();
  const sum=Object.values(result.materialMeshes!).reduce((total,mesh)=>total+printableMeshVolume(mesh),0);
  expect(Math.abs(sum-whole)).toBeLessThan(0.1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84+result.mesh.indices.length/3*50);
  const model=strFromU8(unzipSync(writeThreeMf([{name:"Profile bin",mesh:result.mesh}]))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(result.mesh.indices.length/3);
  await expect(getHandler()({...request,layout:{...request.layout!,cutouts:[{...cutout,elevationMm:1}]}},context())).rejects.toThrow(/at least 7 mm/);
});

it.each([false, true])("exports rigid split pockets with floor colors and through section=%s", async through => {
  const basic = createBasicPocket("rectangle", {x:-12,y:-10}, {x:12,y:10}, "rigid-split")!;
  const cutout = parseCutoutPlacement({...basic.cutout, elevationMm:12, depth:{mode:"mm",value:9},
    tilt:{xDeg:90,yDeg:0},rotationDeg:17,clearanceMm:0.4,cornerRoundMm:1,bottomFilletMm:1,topFilletMm:1,
    split:{boundary:[{x:-12,y:0},{x:12,y:0}],depths:[{mode:"mm",value:9},through?{mode:"through"}:{mode:"mm",value:16}]}});
  const result = (await getHandler()({spec:{gridX:3,gridY:3,heightUnits:6,fill:"solid",lip:"none"},quality:EXPORT_QUALITY,
    exportTopology:true,pocketFloorMaterialThicknessMm:0.6,layout:{shapes:[basic.shape],cutouts:[cutout],fingerHoles:[]}},context())).value;
  const whole = printableMeshVolume(result.mesh);
  expect(result.materialMeshes?.pocketFloors).toBeDefined();
  const sum = Object.values(result.materialMeshes!).reduce((total,mesh)=>total+printableMeshVolume(mesh),0);
  expect(Math.abs(sum-whole)).toBeLessThan(0.1);
  expect(Math.abs(whole-result.stats.volumeMm3)).toBeLessThan(0.1);
});

it("exports the browser-authored linked-pocket design without collapsed Float32 triangles", async () => {
  const basic = createBasicPocket("rectangle", { x: -5.352564334869385, y: -6.021635055541992 },
    { x: 5.352564334869385, y: 6.021635055541992 }, "browser-test")!;
  const result = await getHandler()({ spec: { gridX: 2, gridY: 2, heightUnits: 6, fill: "solid", lip: "standard" },
    quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 1.25,
    layout: { shapes: [basic.shape], cutouts: [-27.668156, 0.331844, 28.331844].map((x, i) =>
      parseCutoutPlacement({ ...basic.cutout, id: `browser-${i}`, position: { x, y: -4.061699 },
        rotationDeg: i === 1 ? 14.999999999999998 : 0, depth: { mode: "mm", value: 20 },
        designLink: { id: "linked-test", tilt: false } })),
      fingerHoles: [fingerHoleSchema.parse({ id: "thumb", kind: "oblong-deep-scoop", center: { x: 0, y: 0 },
        diameterMm: 18, lengthMm: 36, depthMm: 8, topFilletMm: 1, rotationDeg: 14.999999999999998 })] },
  }, context());
  const whole = printableMeshVolume(result.value.mesh);
  expect(Math.abs(whole - result.value.stats.volumeMm3)).toBeLessThan(0.1);
  const parts = Object.values(result.value.materialMeshes!).reduce((sum, mesh) => sum + printableMeshVolume(mesh), 0);
  expect(Math.abs(parts - whole)).toBeLessThan(0.1);
});

it("exports the eight-slot CW313 rack without coincident material boundary faces", async () => {
  const basic = createBasicPocket("rectangle", { x: -3.4, y: -33.75 }, { x: 3.4, y: 33.75 }, "cw313")!;
  const result = await getHandler()({
    spec: { gridX: 4, gridY: 3, heightUnits: 7, fill: "solid", lip: "none" },
    quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6,
    layout: {
      shapes: [basic.shape],
      cutouts: [-36, 36].flatMap(x => [-13.904163, 9.095837, 32.095837, 55.095837].map((y, i) =>
        parseCutoutPlacement({ ...basic.cutout, id: `slot-${x}-${i}`, position: { x, y },
          rotationDeg: 90, tilt: { xDeg: 0, yDeg: 45 }, clearanceMm: 0,
          cornerRoundMm: 0, topFilletMm: 0.4, bottomFilletMm: 0,
          depth: { mode: "remaining", floorThicknessMm: 10 } }))),
      fingerHoles: [-36, 36].map(x => fingerHoleSchema.parse({ id: `thumb-${x}`,
        kind: "oblong-deep-scoop", center: { x, y: 8.595837 }, diameterMm: 30,
        lengthMm: 90, depthMm: 9, topFilletMm: 1, bottomFilletMm: 1, rotationDeg: 90 })),
    },
  }, context());
  const whole = printableMeshVolume(result.value.mesh);
  const parts = Object.values(result.value.materialMeshes!).reduce((sum, mesh) => sum + printableMeshVolume(mesh), 0);
  expect(Math.abs(whole - result.value.stats.volumeMm3)).toBeLessThan(0.1);
  expect(Math.abs(parts - whole)).toBeLessThan(0.1);
  expect(result.value.validationIssues).toEqual([]);
});

it("warns about hidden tilted-shaft intersections and exports their combined geometry", async () => {
  const basic = createBasicPocket("rectangle", { x: -3, y: -16 }, { x: 3, y: 16 }, "tilted")!;
  const cutouts = [-12, 12].map((x, index) => parseCutoutPlacement({
    ...basic.cutout, id: `tilted-${index}`, position: { x, y: 0 },
    tilt: { xDeg: 0, yDeg: index === 0 ? -45 : 45 }, depth: { mode: "mm", value: 35 },
  }));
  const request: BuildBinRequest = { spec: { gridX: 4, gridY: 4, heightUnits: 6, lip: "none" },
    layout: { shapes: [basic.shape], cutouts, fingerHoles: [] }, quality: { circularSegments: 16 } };
  const handler = getHandler();
  const preview = await handler(request, context());
  expect(preview.value.validationIssues?.find(issue => issue.code === "tilted-pocket-overlap")?.severity).toBe("warning");
  const combined = (await handler({ ...request, exportTopology: true }, context())).value;
  expect(combined.validationIssues?.find(issue => issue.code === "tilted-pocket-overlap")?.severity).toBe("warning");
  expect(nonManifoldEdgeCount(combined.mesh)).toBe(0);
  expect(writeBinarySTL(combined.mesh).byteLength).toBe(84 + combined.mesh.indices.length / 3 * 50);
  const corrected = await handler({ ...request, exportTopology: true,
    layout: { ...request.layout!, cutouts: cutouts.map(c => ({ ...c, tilt: { xDeg: 0, yDeg: 45 } })) } }, context());
  expect(corrected.value.validationIssues).toEqual([]);
  expect(nonManifoldEdgeCount(corrected.value.mesh)).toBe(0);
});

describe("bin worker handlers", () => {
  it.each([false, true])("keeps split depths, materials, and authored settings in a draft with section=%s", async sectioned => {
    const { shape, cutout } = createBasicPocket("rectangle", { x: -10, y: -15 }, { x: 10, y: 15 }, "draft")!;
    const placement = parseCutoutPlacement({ ...cutout, clearanceMm: 0, cornerRoundMm: 0,
      topFilletMm: 1, bottomFilletMm: 2,
      split: { boundary: [{ x: 0, y: -20 }, { x: 0, y: 20 }], depths: [{ mode: "mm", value: 4 }, { mode: "mm", value: 8 }] },
    });
    const request: BuildBinRequest = {
      spec: { gridX: 2, gridY: 2, heightUnits: 3, fill: "solid" },
      quality: { circularSegments: 16, filletProfileStepMm: 0.5 },
      layout: { shapes: [shape], cutouts: [placement], fingerHoles: [] },
      section: sectioned ? { axis: "y", offsetMm: 0 } : undefined,
      pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 1.25,
    };
    const original = structuredClone(request);
    const draft = (await getHandler()({ ...request, previewDraft: true }, context())).value;
    const sharp = (await getHandler()({ ...request, layout: { ...request.layout!,
      cutouts: [{ ...placement, topFilletMm: 0, bottomFilletMm: 0 }] },
    }, context())).value;
    expect(draft.mesh).toEqual(sharp.mesh);
    expect(draft.materialMeshes).toEqual(sharp.materialMeshes);
    expect(draft.stats.volumeMm3).toBe(sharp.stats.volumeMm3);
    expect(request).toEqual(original);
    const heights = new Set(Array.from(draft.materialMeshes!.pocketFloors!.positions)
      .filter((_, i) => i % 3 === 2).map(z => Math.round(z * 1000) / 1000));
    for (const depth of placement.split!.depths) {
      expect(heights).toContain(resolvePocketDepth(parseBinSpec(request.spec), depth).floorZ);
    }
    // Even a caller that accidentally combines both flags must export the
    // authored rounded geometry, with exactly the normal export mesh data.
    const exported = (await getHandler()({ ...request, section: undefined, exportTopology: true }, context())).value;
    const flagged = (await getHandler()({ ...request, section: undefined, exportTopology: true, previewDraft: true }, context())).value;
    expect(flagged.mesh).toEqual(exported.mesh);
    expect(flagged.materialMeshes).toEqual(exported.materialMeshes);
    expect(flagged.stats.volumeMm3).not.toBe(draft.stats.volumeMm3);
  });

  it("keeps visible rounding in a coarse draft and ignores that tier for exports", async () => {
    const { shape, cutout } = createBasicPocket("rectangle", { x: -10, y: -15 }, { x: 10, y: 15 }, "rounded-draft")!;
    const placement = parseCutoutPlacement({ ...cutout, topFilletMm: 2, bottomFilletMm: 3, depth: { mode: "mm", value: 10 } });
    const request: BuildBinRequest = {
      spec: { gridX: 2, gridY: 2, heightUnits: 3 },
      quality: { circularSegments: 24, filletProfileStepMm: 0.5 },
      layout: { shapes: [shape], cutouts: [placement], fingerHoles: [] },
      pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 1.25,
    };
    const original = structuredClone(request);
    const coarse = (await getHandler()({ ...request, previewDraft: "rounded" }, context())).value;
    const sharp = (await getHandler()({ ...request, quality: { ...request.quality, circularSegments: 16, filletProfileStepMm: 2 }, previewDraft: true }, context())).value;
    const changed = (await getHandler()({ ...request, previewDraft: "rounded", layout: { ...request.layout!,
      cutouts: [{ ...placement, topFilletMm: 4 }] } }, context())).value;
    expect(coarse.stats.triangles).toBeGreaterThan(sharp.stats.triangles);
    expect(changed.stats.volumeMm3).toBeLessThan(coarse.stats.volumeMm3);
    expect(coarse.materialMeshes?.pocketFloors).toBeDefined();
    expect(request).toEqual(original);
    // Aggregate meshes retain indexed topology; welding touching vertices can
    // create artificial non-manifold edges at material boundaries.
    expect(coarse.mesh.normals).toBeNull();
    expect(nonManifoldEdgeCount(coarse.mesh)).toBe(0);
    const detailed = (await getHandler()({ ...request, exportTopology: true }, context())).value;
    const flagged = (await getHandler()({ ...request, exportTopology: true, previewDraft: "rounded" }, context())).value;
    expect(flagged.mesh).toEqual(detailed.mesh);
    expect(flagged.materialMeshes).toEqual(detailed.materialMeshes);
  });

  it("validates authored rounding before approximating a draft", async () => {
    const { shape, cutout } = createBasicPocket("rectangle", { x: -10, y: -10 }, { x: 10, y: 10 }, "invalid")!;
    await expect(getHandler()({ ...REQUEST, previewDraft: true,
      layout: { shapes: [shape], cutouts: [{ ...cutout, topFilletMm: -1 }], fingerHoles: [] },
    }, context())).rejects.toThrow();
  });

  it("builds geometric pockets with colored floors while same-depth finger access keeps the body material", async () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, lip: "none", flatBottom: true });
    const pockets = [
      createBasicPocket("rectangle", { x: -30, y: -28 }, { x: -8, y: -12 }, "rectangle")!,
      createBasicPocket("square", { x: 8, y: -28 }, { x: 26, y: -12 }, "square")!,
      createBasicPocket("circle", { x: -19, y: 17 }, { x: -9, y: 17 }, "circle")!,
    ];
    const cutouts = pockets.map(({ cutout }) => ({ ...cutout, depth: { mode: "mm" as const, value: 8 } }));
    const fingerHoles = [fingerHoleSchema.parse({ id: "finger", center: { x: 19, y: 17 }, kind: "straight", depthMm: 8, diameterMm: 16 })];
    const result = (await getHandler()({ spec, layout: { shapes: pockets.map(p => p.shape), cutouts, fingerHoles },
      quality: { circularSegments: 32, cutoutVertexBudget: 300 }, pocketFloorMaterialThicknessMm: 0.8 }, context())).value;
    expect(result.cutoutReports).toHaveLength(3);
    expect(result.cutoutReports.every(report => !report.emptied)).toBe(true);
    const floors = result.materialMeshes!.pocketFloors!;
    expect(floors.indices.length).toBeGreaterThan(0);
    expect(nonManifoldEdgeCount(floors, true)).toBe(0);
    const floorZ = resolvePocketDepth(spec, cutouts[0].depth).floorZ!;
    const zs = Array.from(floors.positions).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(floorZ, 5);
    expect(Math.min(...zs)).toBeCloseTo(floorZ - 0.8, 5);
    // All three pocket quadrants have material; the upper-right finger access does not.
    const quadrants = new Set<string>();
    for (let i = 0; i < floors.positions.length; i += 3) {
      const x = floors.positions[i], y = floors.positions[i + 1];
      quadrants.add(`${Math.sign(x)},${Math.sign(y)}`);
    }
    expect(quadrants).toEqual(new Set(["-1,-1", "1,-1", "-1,1"]));
    expect(writeBinarySTL(result.mesh).byteLength).toBeGreaterThan(84);
    const model = strFromU8(unzipSync(writeThreeMf([
      { name: "Bin body", mesh: result.materialMeshes!.body, material: { name: "Body", displayColor: "#202020" } },
      { name: "Pocket floors", mesh: floors, material: { name: "Floor", displayColor: "#ff6600" } },
    ]))["3D/3dmodel.model"]);
    expect(model).toContain('name="Pocket floors"');
    expect(model.toLowerCase()).toContain("#ff6600");
  });

  it("builds a bin and nominates its buffers for transfer", async () => {
    const progress = vi.fn();
    const result = await getHandler()(REQUEST, context({ progress }));

    const { mesh, stats } = result.value;
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.normals).not.toBeNull();
    expect(mesh.indices.length % 3).toBe(0);
    expect(stats.triangles).toBe(mesh.indices.length / 3);
    expect(stats.volumeMm3).toBeGreaterThan(0);
    expect(stats.buildMs).toBeGreaterThan(0);

    expect(result.transfer).toContain(mesh.positions.buffer);
    expect(result.transfer).toContain(mesh.indices.buffer);
    expect(result.transfer).toContain(mesh.normals!.buffer);

    // Progress is monotonic and lands short of 1 (the client sets 1 itself).
    const values = progress.mock.calls.map(([value]) => value as number);
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(values.at(-1)!).toBeLessThan(1);
  });

  it("re-validates the spec at the worker boundary", async () => {
    await expect(
      getHandler()(
        { spec: { gridX: 0, gridY: 1, heightUnits: 2 }, quality: { circularSegments: 16 } },
        context(),
      ),
    ).rejects.toThrow();
  });

  it("rejects with a cancellation once the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getHandler()(REQUEST, context({ signal: controller.signal })),
    ).rejects.toThrow(WorkerCancelledError);
  });

  it("builds a layout's pockets and reports per cutout", async () => {
    const shape = {
      id: "s1",
      name: "square",
      outlineMm: [
        {
          outer: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 },
          ],
          holes: [],
        },
      ],
      bboxMm: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      pointCount: 4,
      sourceMmPerPx: 0.2,
    };
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3, fill: "solid" });
    const placement = parseCutoutPlacement({
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
      depth: { mode: "remaining", floorThicknessMm: 7 },
    });
    const withPocket = await getHandler()(
      {
        spec,
        quality: { circularSegments: 16, cutoutVertexBudget: 150 },
        layout: {
          shapes: [shape],
          cutouts: [placement],
          fingerHoles: [],
        },
      },
      context(),
    );
    const plain = await getHandler()(
      {
        spec,
        quality: { circularSegments: 16, cutoutVertexBudget: 150 },
      },
      context(),
    );

    expect(withPocket.value.cutoutReports).toEqual([{ id: "c1", emptied: false }]);
    expect(withPocket.value.materialMeshes).toBeUndefined();
    expect(plain.value.cutoutReports).toEqual([]);
    expect(withPocket.value.stats.volumeMm3).toBeLessThan(plain.value.stats.volumeMm3);

    const floorZ = resolvePocketDepth(spec, placement.depth).floorZ;
    expect(floorZ).not.toBeNull();
    const partition = partitionPocketFloorTriangles(withPocket.value.mesh, [floorZ!]);
    expect(partition.floorIndexCount).toBeGreaterThan(0);
    const floorIndices = partition.indices.slice(partition.bodyIndexCount);
    const xs = Array.from(floorIndices, (index) => withPocket.value.mesh.positions[index * 3]);
    const ys = Array.from(
      floorIndices,
      (index) => withPocket.value.mesh.positions[index * 3 + 1],
    );
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(10);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);

    const multicolor = await getHandler()(
      {
        spec,
        quality: { circularSegments: 16, cutoutVertexBudget: 150 },
        layout: { shapes: [shape], cutouts: [placement], fingerHoles: [] },
        pocketFloorMaterialThicknessMm: 0.8,
        stackingRimMaterialThicknessMm: 1.2,
      },
      context(),
    );
    const materialMeshes = multicolor.value.materialMeshes;
    expect(multicolor.value.mesh.normals).toBeNull();
    expect(materialMeshes).toBeDefined();
    expect(materialMeshes!.body.indices.length).toBeGreaterThan(0);
    expect(materialMeshes!.body.normals).not.toBeNull();
    expect(materialMeshes!.pocketFloors!.indices.length).toBeGreaterThan(0);
    expect(materialMeshes!.pocketFloors!.normals).not.toBeNull();
    expect(materialMeshes!.stackingRim!.indices.length).toBeGreaterThan(0);
    expect(materialMeshes!.stackingRim!.normals).not.toBeNull();
    const floorZs = Array.from(
      materialMeshes!.pocketFloors!.positions.filter((_, index) => index % 3 === 2),
    );
    expect(Math.min(...floorZs)).toBeCloseTo(floorZ! - 0.8, 5);
    expect(Math.max(...floorZs)).toBeCloseTo(floorZ!, 5);
    const rimZs = Array.from(
      materialMeshes!.stackingRim!.positions.filter((_, index) => index % 3 === 2),
    );
    const rimTopZ = binTotalHeightMm(spec.heightUnits, true);
    expect(Math.min(...rimZs)).toBeCloseTo(rimTopZ - 1.2, 5);
    expect(Math.max(...rimZs)).toBeCloseTo(rimTopZ, 5);
    expect(multicolor.transfer).toContain(materialMeshes!.body.positions.buffer);
    expect(multicolor.transfer).toContain(materialMeshes!.body.indices.buffer);
    expect(multicolor.transfer).toContain(materialMeshes!.body.normals!.buffer);
    expect(multicolor.transfer).toContain(
      materialMeshes!.pocketFloors!.positions.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.pocketFloors!.indices.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.pocketFloors!.normals!.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.stackingRim!.positions.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.stackingRim!.indices.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.stackingRim!.normals!.buffer,
    );
  });

  it("returns the exact material partition for a sectioned preview", async () => {
    const result = await getHandler()(
      {
        ...REQUEST,
        section: { axis: "x", offsetMm: 0 },
        stackingRimMaterialThicknessMm: 5,
      },
      context(),
    );

    expect(result.value.materialMeshes?.stackingRim).toBeDefined();
    expect(result.value.mesh.normals).toBeNull();
    for (const mesh of [
      result.value.materialMeshes!.body,
      result.value.materialMeshes!.stackingRim!,
    ]) {
      const xs = Array.from(
        mesh.positions.filter((_, index) => index % 3 === 0),
      );
      expect(Math.max(...xs)).toBeLessThanOrEqual(0.001);
      expect(mesh.normals).not.toBeNull();
    }
  });

  it("keeps fallback normals when requested materials have no printable volume", async () => {
    const result = await getHandler()({
      spec: { gridX: 1, gridY: 1, heightUnits: 3, lip: "none", fill: "solid" },
      quality: { circularSegments: 16 },
      pocketFloorMaterialThicknessMm: 0.6,
    }, context());
    expect(result.value.materialMeshes).toBeUndefined();
    expect(result.value.mesh.normals?.length).toBe(result.value.mesh.positions.length);
    expect(result.value.mesh.indices.length).toBeGreaterThan(0);
  });

  it.each([undefined, 1.25].flatMap(stackingRimMaterialThicknessMm =>
    [-62.75, -63].map(offsetMm => ({ stackingRimMaterialThicknessMm, offsetMm })),
  ))("handles an empty aggregate at X=$offsetMm with rim material=$stackingRimMaterialThicknessMm", async ({ stackingRimMaterialThicknessMm, offsetMm }) => {
    const request: BuildBinRequest = {
      spec: { gridX: 3, gridY: 7, heightUnits: 3, fill: "solid" },
      quality: { circularSegments: 16 }, stackingRimMaterialThicknessMm,
    };
    const whole = await getHandler()(request, context());
    const cut = await getHandler()({ ...request, section: { axis: "x", offsetMm } }, context());
    expect(cut.value.mesh.indices).toHaveLength(0);
    expect(cut.value.stats.triangles).toBe(0);
    expect(cut.value.stats.volumeMm3).toBe(whole.value.stats.volumeMm3);
    if (cut.value.materialMeshes) {
      // Independent boolean trims can leave tiny coplanar fragments exactly
      // on the boundary. Every surviving body vertex still needs its normal.
      const body = cut.value.materialMeshes.body;
      expect(body.normals?.length).toBe(body.positions.length);
      if (offsetMm < -62.75) expect(body.positions).toHaveLength(0);
      expect(cut.value.materialMeshes.stackingRim).toBeUndefined();
    }
    expect(new Set(cut.transfer).size).toBe(cut.transfer.length);
    const moved = structuredClone(cut.value, { transfer: cut.transfer });
    expect(moved.mesh.indices).toHaveLength(0);
  });

  it.each(["standard", "none"] as const)("returns topology-preserving colored meshes with %s lip", async lip => {
    const result = await getHandler()(
      {
        ...REQUEST,
        spec: { ...REQUEST.spec, lip },
        exportTopology: true,
        stackingRimMaterialThicknessMm: 1.2,
        borderWidthMm: 4,
      },
      context(),
    );

    expect(result.value.mesh.normals).toBeNull();
    expect(result.value.materialMeshes?.body.normals).toBeNull();
    expect(result.value.materialMeshes?.stackingRim?.normals).toBeNull();
    expect(nonManifoldEdgeCount(result.value.mesh)).toBe(0);
    expect(nonManifoldEdgeCount(result.value.materialMeshes!.body)).toBe(0);
    expect(nonManifoldEdgeCount(result.value.materialMeshes!.stackingRim!)).toBe(0);
  });

  it.each([
    { kind: "oblong-straight", cornerRoundMm: 0 },
    { kind: "flat-ended-straight", cornerRoundMm: 0 },
    { kind: "flat-ended-straight", cornerRoundMm: 3 },
    { kind: "flat-ended-scoop", cornerRoundMm: 3 },
  ])("exports a rounded $kind with corner radius $cornerRoundMm through the worker to closed STL/3MF geometry", async ({ kind, cornerRoundMm }) => {
    const result = await getHandler()({
      spec: { gridX: 2, gridY: 2, heightUnits: 4, fill: "solid" },
      quality: { circularSegments: 64 }, exportTopology: true,
      layout: { shapes: [], cutouts: [], fingerHoles: [fingerHoleSchema.parse({
        id: "slot", kind, center: { x: 3, y: -2 }, diameterMm: 16, lengthMm: 40,
        rotationDeg: 37, depthMm: 12, topFilletMm: 1, bottomFilletMm: 2, cornerRoundMm,
      })] },
    }, context());
    const { mesh } = result.value;
    expect(mesh.normals).toBeNull();
    expect(nonManifoldEdgeCount(mesh)).toBe(0);
    const stl = writeBinarySTL(mesh);
    expect(new DataView(stl).getUint32(80, true)).toBe(mesh.indices.length / 3);
    expect(stl.byteLength).toBe(84 + mesh.indices.length / 3 * 50);
    const model = strFromU8(unzipSync(writeThreeMf([{ name: "slot", mesh }]))["3D/3dmodel.model"]);
    expect(model.match(/<triangle /g)?.length).toBe(mesh.indices.length / 3);
    expect(model.match(/<vertex /g)?.length).toBe(mesh.positions.length / 3);
  });

  it("exports partial fill through the worker to closed STL and 3MF geometry", async () => {
    const result = await getHandler()({
      ...REQUEST,
      spec: { ...REQUEST.spec, fill: "solid", fillHeightPercent: 37.5 },
      exportTopology: true,
    }, context());
    const full = await getHandler()({ ...REQUEST, spec: { ...REQUEST.spec, fill: "solid" }, exportTopology: true }, context());
    const { mesh } = result.value;
    expect(nonManifoldEdgeCount(mesh)).toBe(0);
    expect(result.value.stats.volumeMm3).toBeLessThan(full.value.stats.volumeMm3);
    const stl = writeBinarySTL(mesh);
    expect(new DataView(stl).getUint32(80, true)).toBe(mesh.indices.length / 3);
    const model = strFromU8(unzipSync(writeThreeMf([{ name: "partial-fill", mesh }]))["3D/3dmodel.model"]);
    expect(model.match(/<triangle /g)?.length).toBe(mesh.indices.length / 3);
    expect(model.match(/<vertex /g)?.length).toBe(mesh.positions.length / 3);
  });

  it("rejects a malformed layout at the boundary", async () => {
    await expect(
      getHandler()(
        {
          spec: { gridX: 1, gridY: 1, heightUnits: 2 },
          quality: { circularSegments: 16 },
          layout: {
            shapes: [],
            cutouts: [{ id: "c1", shapeId: "s1", position: { x: Number.NaN, y: 0 } }],
          },
        } as never,
        context(),
      ),
    ).rejects.toThrow();
  });

  it("rejects out-of-range material thicknesses at the worker boundary", async () => {
    await expect(
      getHandler()(
        {
          ...REQUEST,
          stackingRimMaterialThicknessMm: 7.36,
        },
        context(),
      ),
    ).rejects.toThrow("Stacking-rim material thickness must be between 0.2 and 7.35 mm");
  });

  it.each([NaN, Infinity, -1, 0, 0.19, 20.01])("rejects invalid border width %s before building", async borderWidthMm => {
    await expect(getHandler()({ ...REQUEST, borderWidthMm }, context()))
      .rejects.toThrow("Top-border color width must be between 0.2 and 20 mm");
  });

  it.each(["none", "standard"] as const)("exports a closed colored floor on a hollow bin with %s lip", async lip => {
    const handler = getHandler();
    const request: BuildBinRequest = {
      spec: { gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip, screwHoles: true, magnetHoles: true },
      quality: EXPORT_QUALITY, pocketFloorMaterialThicknessMm: 0.6,
      stackingRimMaterialThicknessMm: 1.25,
    };
    const preview = await handler(request, context());
    expect(preview.value.materialMeshes!.pocketFloors!.normals).not.toBeNull();
    const exported = await handler({ ...request, exportTopology: true }, context());
    expect(exported.value.stats.volumeMm3).toBe(preview.value.stats.volumeMm3);
    const parts = exported.value.materialMeshes!;
    for (const mesh of [parts.body, parts.pocketFloors!, parts.stackingRim!]) {
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(nonManifoldEdgeCount(mesh)).toBe(0);
    }
    const zs = parts.pocketFloors!.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(6.4, 5);
    expect(Math.max(...zs)).toBe(7);
    const model = strFromU8(unzipSync(writeThreeMf([
      { name: "Body", mesh: parts.body, material: { name: "Body", displayColor: "#bfbfbf" } },
      { name: "Bin floor", mesh: parts.pocketFloors!, material: { name: "Bin floor", displayColor: "#2255aa" } },
      { name: "Rim", mesh: parts.stackingRim!, material: { name: "Rim", displayColor: "#000000" } },
    ], { assemble: true }))["3D/3dmodel.model"]);
    expect(model).toContain('name="Bin floor"');
    expect(model).toContain('<m:color color="#2255AAFF"/>');
  });

  it("allows a wide, deep border to consume a small bin's whole color volume", async () => {
    const { value } = await getHandler()({
      spec: { gridX: 1, gridY: 1, gridPitch: "quarter", heightUnits: 1, lip: "none", flatBottom: true },
      quality: EXPORT_QUALITY, exportTopology: true,
      stackingRimMaterialThicknessMm: 7.35, borderWidthMm: 20,
    }, context());
    expect(value.materialMeshes!.body.indices).toHaveLength(0);
    expect(value.materialMeshes!.stackingRim!.indices.length).toBeGreaterThan(0);
    expect(nonManifoldEdgeCount(value.materialMeshes!.stackingRim!)).toBe(0);
  });
});

describe("section view (G4)", () => {
  it("trims the displayed mesh but keeps whole-bin stats", async () => {
    const handler = getHandler();
    const full = await handler(REQUEST, context());
    const cut = await handler(
      { ...REQUEST, section: { axis: "x", offsetMm: 0 } },
      context(),
    );

    // The 1×1 bin spans ±20.875; keeping x ≤ 0 halves the mesh extent.
    const xs: number[] = [];
    for (let i = 0; i < cut.value.mesh.positions.length; i += 3) {
      xs.push(cut.value.mesh.positions[i]);
    }
    expect(Math.max(...xs)).toBeLessThanOrEqual(1e-6);
    expect(Math.min(...xs)).toBeLessThan(-20);

    // Stats still describe the uncut bin.
    expect(cut.value.stats.volumeMm3).toBeCloseTo(full.value.stats.volumeMm3, 6);
  });

  it("cuts along y as well", async () => {
    const cut = await getHandler()(
      { ...REQUEST, section: { axis: "y", offsetMm: 5 } },
      context(),
    );
    const ys: number[] = [];
    for (let i = 1; i < cut.value.mesh.positions.length; i += 3) {
      ys.push(cut.value.mesh.positions[i]);
    }
    expect(Math.max(...ys)).toBeLessThanOrEqual(5 + 1e-6);
  });
});

describe("fit template worker handler", () => {
  const shape = {
    id: "fit-shape",
    name: "Fit wrench",
    outlineMm: [
      {
        outer: [
          { x: -10, y: -5 },
          { x: 10, y: -5 },
          { x: 10, y: 5 },
          { x: -10, y: 5 },
        ],
        holes: [
          [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 },
          ],
        ],
      },
    ],
    bboxMm: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
    pointCount: 8,
    sourceMmPerPx: 0.2,
  };

  it("exports a filled standalone outline at the requested depth", async () => {
    const result = await getFitCheckHandler()(
      {
        shape,
        cutout: {
          id: "fit-cutout",
          shapeId: shape.id,
          position: { x: 40, y: -20 },
          scaleX: 1.5,
          scaleY: 0.5,
          clearanceMm: 1,
          cornerRoundMm: 0,
          fingerHoles: [
            {
              id: "ignored-hole",
              center: { x: 10, y: 0 },
              diameterMm: 18,
              kind: "straight",
              depthMm: 12,
            },
          ],
        },
        depthMm: 2.5,
        quality: { circularSegments: 24, cutoutVertexBudget: 600 },
      },
      context(),
    );

    const positions = result.value.mesh.positions;
    const xs: number[] = [];
    const zs: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
      xs.push(positions[index]);
      zs.push(positions[index + 2]);
    }
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(2.5, 6);
    // The placement and finger access position are intentionally ignored;
    // placement scale is retained while position and finger access features are ignored;
    // clearance grows the 30 mm wide outline to roughly 32 mm.
    expect(Math.min(...xs)).toBeCloseTo(-16, 1);
    expect(Math.max(...xs)).toBeCloseTo(16, 1);
    // Filling the 2x2 interior ring yields the full expanded rectangle.
    expect(result.value.stats.volumeMm3).toBeCloseTo(32 * 7 * 2.5, -1);
    expect(result.transfer).toContain(result.value.mesh.positions.buffer);
    expect(result.transfer).toContain(result.value.mesh.indices.buffer);
  });

  it("exports an inward-offset fit template after placement scale", async () => {
    const result = await getFitCheckHandler()({
      shape,
      cutout: { id: "fit-cutout", shapeId: shape.id, position: { x: 40, y: -20 },
        scaleX: 1.5, scaleY: 0.5, clearanceMm: -0.5, cornerRoundMm: 0 },
      depthMm: 2.5, quality: { circularSegments: 24, cutoutVertexBudget: 600 },
    }, context());
    const xs = Array.from(result.value.mesh.positions).filter((_, index) => index % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-14.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(14.5, 5);
    expect(result.value.stats.volumeMm3).toBeCloseTo(29 * 4 * 2.5, 4);
  });

  it("rejects a fit template erased by inward clearance", async () => {
    await expect(getFitCheckHandler()({
      shape,
      cutout: { id: "fit-cutout", shapeId: shape.id, position: { x: 0, y: 0 },
        scaleY: 0.05, clearanceMm: -0.5, cornerRoundMm: 0 },
      depthMm: 2, quality: { circularSegments: 24 },
    }, context())).rejects.toThrow("collapsed");
  });

  it("rejects an out-of-range template depth", async () => {
    await expect(
      getFitCheckHandler()(
        {
          shape,
          cutout: {
            id: "fit-cutout",
            shapeId: shape.id,
            position: { x: 0, y: 0 },
          },
          depthMm: 0.1,
          quality: { circularSegments: 16 },
        },
        context(),
      ),
    ).rejects.toThrow("thickness");
  });
});

describe("complete surface fit test worker handler", () => {
  const shape = {
    id: "surface-shape",
    name: "Deep pliers",
    outlineMm: [
      {
        outer: [
          { x: -6, y: -4 },
          { x: 6, y: -4 },
          { x: 6, y: 4 },
          { x: -6, y: 4 },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: -6, minY: -4, maxX: 6, maxY: 4 },
    pointCount: 4,
    sourceMmPerPx: 0.2,
  };

  const request = (lip: "standard" | "none"): BuildSurfaceFitCheckRequest => ({
    spec: { gridX: 2, gridY: 1, heightUnits: 6, fill: "solid", lip },
    layout: {
      shapes: [shape],
      cutouts: [
        {
          id: "surface-cutout-left",
          shapeId: shape.id,
          position: { x: -15, y: 0 },
          clearanceMm: 0,
          cornerRoundMm: 0,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
        {
          id: "surface-cutout-right",
          shapeId: shape.id,
          position: { x: 15, y: 0 },
          clearanceMm: 0,
          cornerRoundMm: 0,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ],
      fingerHoles: [],
    },
    thicknessMm: 1.2,
    quality: { circularSegments: 32, cutoutVertexBudget: 600 },
  });

  it("exports the full pocket surface on the build plate without the stacking lip", async () => {
    const withLip = await getSurfaceFitCheckHandler()(request("standard"), context());
    const withoutLip = await getSurfaceFitCheckHandler()(request("none"), context());
    const positions = withLip.value.mesh.positions;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
      xs.push(positions[index]);
      ys.push(positions[index + 1]);
      zs.push(positions[index + 2]);
    }

    expect(Math.min(...xs)).toBeCloseTo(-83.5 / 2, 5);
    expect(Math.max(...xs)).toBeCloseTo(83.5 / 2, 5);
    expect(Math.min(...ys)).toBeCloseTo(-41.5 / 2, 5);
    expect(Math.max(...ys)).toBeCloseTo(41.5 / 2, 5);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(1.2, 6);
    // The source bin's lip choice changes only the source elevation; the
    // exported surface geometry itself contains no lip.
    expect(withLip.value.stats.volumeMm3).toBeCloseTo(
      withoutLip.value.stats.volumeMm3,
      5,
    );
    expect(withLip.transfer).toContain(withLip.value.mesh.positions.buffer);
    expect(withLip.transfer).toContain(withLip.value.mesh.indices.buffer);
  });

  it("rejects an unsafe paper-thin surface", async () => {
    await expect(
      getSurfaceFitCheckHandler()(
        { ...request("standard"), thicknessMm: 0.2 },
        context(),
      ),
    ).rejects.toThrow("thickness");
  });

  it("exports the outline style as a smaller manifold mesh at the requested thickness", async () => {
    const full = await getSurfaceFitCheckHandler()(request("standard"), context());
    const outline = await getSurfaceFitCheckHandler()({ ...request("standard"), style: "outline" }, context());
    expect(outline.value.stats.volumeMm3).toBeLessThan(full.value.stats.volumeMm3);
    expect(outline.value.stats.volumeMm3).toBeGreaterThan(0);
    expect(nonManifoldEdgeCount(outline.value.mesh, true)).toBe(0);
    const zs = Array.from(outline.value.mesh.positions).filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(0);
    expect(Math.max(...zs)).toBeCloseTo(1.2);
  });
});

it("exports a Z-translated upright pocket and rejects its floor below the bin", async () => {
  const basic = createBasicPocket("rectangle", { x: -5, y: -8 }, { x: 5, y: 8 }, "shifted")!;
  const cutout = parseCutoutPlacement({ ...basic.cutout, depth: { mode: "remaining", floorThicknessMm: 10 }, zOffsetMm: -2 });
  const request: BuildBinRequest = { spec: { gridX: 2, gridY: 2, heightUnits: 6, lip: "none" },
    layout: { shapes: [basic.shape], cutouts: [cutout], fingerHoles: [] }, quality: { circularSegments: 16 }, exportTopology: true };
  const handler = getHandler();
  const built = await handler(request, context());
  expect(built.value.mesh.indices.length).toBeGreaterThan(0);
  expect(nonManifoldEdgeCount(built.value.mesh)).toBe(0);
  await expect(handler({ ...request, layout: { ...request.layout!, cutouts: [{ ...cutout, zOffsetMm: -20 }] } }, context())).rejects.toThrow(/deeper than the bin/);
});


it.each(["sloped", "bridged"] as const)("exports a %s peg bin as closed STL and multipart 3MF without dropping the pegs", async underside => {
  const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2, lip: "none", pegBottom: { diameterMm: 4.8, lengthMm: 4, underside },
    surfaceTexts: [{ id: "peg-text", text: "A", position: { x: 0, y: 0 } }] });
  const result = (await getHandler()({ spec,
    quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 0.6 }, context())).value;
  expect(nonManifoldEdgeCount(result.mesh)).toBe(0);
  expect(printableMeshVolume(result.mesh)).toBeCloseTo(result.stats.volumeMm3, 1);
  expect(Math.min(...result.mesh.positions.filter((_, index) => index % 3 === 2))).toBe(0);
  const stl = new DataView(writeBinarySTL(result.mesh));
  expect(stl.getUint32(80, true)).toBe(result.mesh.indices.length / 3);
  const parts = result.materialMeshes!;
  expect(parts.body).toBeTruthy();
  const text = result.textMeshes![0];
  const lift = pegBottomExtensionMm(spec);
  const zs = (mesh: typeof text.mesh) => mesh.positions.filter((_, index) => index % 3 === 2);
  expect(text.z).toBeCloseTo(14 + lift);
  expect(Math.min(...zs(text.mesh))).toBeCloseTo(14 + lift);
  expect(Math.max(...zs(result.bodyMesh!))).toBeCloseTo(14 + lift);
  expect(Math.max(...zs(parts.stackingRim!))).toBeCloseTo(14 + lift);
  const model = strFromU8(unzipSync(writeThreeMf([
    { name: "Bin body", mesh: parts.body, material: { name: "Body", displayColor: "#202020" } },
    { name: "Top border", mesh: parts.stackingRim!, material: { name: "Border", displayColor: "#ff6600" } },
    { name: "Text", mesh: text.mesh, material: { name: "Text", displayColor: "#ffffff" } },
  ], { assemble: true }))["3D/3dmodel.model"]);
  expect(model).toContain('z="0"');
  expect(model).not.toMatch(/z="-/);
  expect(model).toContain('name="Top border"');
});


it.each(["sloped", "bridged"] as const)("exports a %s peg bin with the entire partially overlapped peg omitted", async underside => {
  const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2, lip: "none",
    pegBottom: { diameterMm: 4.8, lengthMm: 4, underside } });
  const pocket = createBasicPocket("rectangle", { x: 1.8, y: -1 }, { x: 4, y: 1 }, "partial-peg")!;
  pocket.cutout.depth = { mode: "through" };
  const result = (await getHandler()({ spec, quality: EXPORT_QUALITY, exportTopology: true,
    pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 0.6,
    layout: { shapes: [pocket.shape], cutouts: [pocket.cutout], fingerHoles: [] },
  }, context())).value;
  expect(nonManifoldEdgeCount(result.mesh)).toBe(0);
  expect(printableMeshVolume(result.mesh)).toBeCloseTo(result.stats.volumeMm3, 1);
  const allMeshes = [result.mesh, ...Object.values(result.materialMeshes!)];
  for (const mesh of allMeshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = mesh.positions.subarray(i, i + 3);
      if (z < 3.9) expect(Math.hypot(x, y)).toBeGreaterThan(2.5);
    }
  }
  const stl = new DataView(writeBinarySTL(result.mesh));
  expect(stl.getUint32(80, true)).toBe(result.mesh.indices.length / 3);
  const model = strFromU8(unzipSync(writeThreeMf(Object.entries(result.materialMeshes!).map(([name, mesh]) => ({ name, mesh })),
    { assemble: true }))["3D/3dmodel.model"]);
  expect(model).toContain('z="0"');
  expect(model).not.toMatch(/z="-/);
});


it("exports a surface Through rectangle inside a finger groove without a floor or shifted opening", async () => {
  const spec = parseBinSpec({ gridX: 3, gridY: 1, heightUnits: 3, lip: "none", pegBottom: {} });
  const pocket = createBasicPocket("rectangle", { x: 27, y: -2 }, { x: 33, y: 2 }, "through-groove")!;
  pocket.cutout.depth = { mode: "remaining", floorThicknessMm: 2 };
  const cutout = { ...pocket.cutout, ...pocketDepthChangePatch(spec, pocket.shape, pocket.cutout, { mode: "through" }) };
  const finger = fingerHoleSchema.parse({ id: "groove", kind: "oblong-deep-scoop", center: { x: 0, y: 0 }, lengthMm: 100, diameterMm: 18, depthMm: 12 });
  const request = { spec, quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 0.6,
    layout: { shapes: [pocket.shape], cutouts: [cutout], fingerHoles: [finger] } };
  const result = (await getHandler()(request, context())).value;
  expect(result.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
  // A vertical ray through the layout's rectangle centre meets no printable surface.
  const hits = (mesh: BuildBinResult["mesh"], x: number, y: number) => {
    const zs: number[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = Array.from(mesh.indices.subarray(i, i + 3), n => mesh.positions.subarray(n * 3, n * 3 + 3));
      const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denominator) < 1e-8) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) zs.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
    }
    return zs;
  };
  expect(hits(result.mesh, 30, 0)).toEqual([]);
  expect(hits(result.mesh, -30, 0).length).toBeGreaterThan(0);
  const volume = printableMeshVolume(result.mesh);
  expect(volume).toBeGreaterThan(0);
  expect(Object.values(result.materialMeshes!).reduce((sum, mesh) => sum + printableMeshVolume(mesh), 0)).toBeCloseTo(volume, 1);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84 + result.mesh.indices.length / 3 * 50);
  const parts = Object.entries(result.materialMeshes!).map(([name, mesh]) => ({ name, mesh }));
  const model = strFromU8(unzipSync(writeThreeMf(parts))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(parts.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0));
});

it("exports overlapping upright finite Through pockets as one surface opening", async () => {
  const rectangle = createBasicPocket("rectangle", { x: 16.875925, y: -2.82763855 }, { x: 67.124075, y: 2.87236145 }, "rect")!;
  const circle = createBasicPocket("circle", { x: 52.408386, y: 0.03009 }, { x: 56.708386, y: 0.03009 }, "circle")!;
  const cutouts = [
    { ...rectangle.cutout, elevationMm: 0, depth: { mode: "through" as const, sourceDepthMm: 14 }, insertionMode: "axis" as const },
    { ...circle.cutout, elevationMm: 0, depth: { mode: "through" as const, sourceDepthMm: 12 } },
  ];
  const request: BuildBinRequest = { spec: { gridX: 16, gridY: 3, gridPitch: "quarter", heightUnits: 1, lip: "none", pegBottom: { lengthMm: 3.5 } },
    quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 0.6,
    layout: { shapes: [rectangle.shape, circle.shape], cutouts,
      fingerHoles: [fingerHoleSchema.parse({ id: "groove", kind: "oblong-deep-scoop", center: { x: 0, y: 0 }, diameterMm: 11.4,
        lengthMm: 152.4, depthMm: 4, topFilletMm: 1, bottomFilletMm: 0 })] } };
  const result = (await getHandler()(request, context())).value;
  expect(result.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
  expect(printableMeshVolume(result.mesh)).toBeGreaterThan(0);
  expect(writeBinarySTL(result.mesh).byteLength).toBe(84 + result.mesh.indices.length / 3 * 50);
  const parts = Object.entries(result.materialMeshes!).map(([name, mesh]) => ({ name, mesh }));
  const model = strFromU8(unzipSync(writeThreeMf(parts))["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)?.length).toBe(parts.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0));
  expect(result.validationIssues?.find(issue => issue.code === "tilted-pocket-overlap")?.severity).toBe("warning");
  const surfaceCutouts = cutouts.map(c => ({ ...c, elevationMm: undefined, insertionMode: undefined, depth: { mode: "through" as const } }));
  const surface = (await getHandler()({ ...request, layout: { ...request.layout!, cutouts: surfaceCutouts } }, context())).value;
  expect(surface.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
  expect(printableMeshVolume(surface.mesh)).toBeGreaterThan(0);
  // Submerged and tilted intersections are also permitted and reported.
  for (const pockets of [cutouts.map(c => ({ ...c, depth: { mode: "through" as const, sourceDepthMm: 2 } })),
    [cutouts[0], { ...cutouts[1], tilt: { xDeg: 1, yDeg: 0 } }]]) {
    const combined = (await getHandler()({ ...request, layout: { ...request.layout!, cutouts: pockets } }, context())).value;
    expect(combined.validationIssues?.find(issue => issue.code === "tilted-pocket-overlap")?.severity).toBe("warning");
    expect(nonManifoldEdgeCount(combined.mesh)).toBe(0);
  }
}, 15_000);

it("flips every coloured export part together for pegs-up printing while preserving editing coordinates", async () => {
  const spec = parseBinSpec({ gridX: 16, gridY: 3, gridPitch: "quarter", heightUnits: 1, lip: "none", pegBottom: { underside: "flat", density: "corners", lengthMm: 3.5 } });
  const pocket = createBasicPocket("rectangle", { x: -10, y: -4 }, { x: 10, y: 4 }, "export-test")!;
  const cutout = { ...pocket.cutout, position: { x: 42, y: 3 }, depth: { mode: "mm" as const, value: 4 }, topFilletMm: 0 };
  const request = { spec, quality: EXPORT_QUALITY, layout: { shapes: [pocket.shape], cutouts: [cutout], fingerHoles: [] }, pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 0.6, borderWidthMm: 1.2 };
  const handler = getHandler();
  const preview = (await handler({ ...request, exportTopology: false }, context())).value;
  const exported = (await handler({ ...request, exportTopology: true }, context())).value;
  const zs = (mesh: BuildBinResult["mesh"]) => Array.from(mesh.positions).filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs(preview.mesh))).toBeCloseTo(-3.5, 5);
  expect(Math.min(...zs(exported.mesh))).toBe(0); expect(Math.max(...zs(exported.mesh))).toBeCloseTo(10.5, 5);
  expect(nonManifoldEdgeCount(exported.mesh)).toBe(0);
  expect(exported.materialMeshes).toBeDefined();
  for (const [name, part] of Object.entries(exported.materialMeshes!)) {
    expect(nonManifoldEdgeCount(part), name).toBe(0);
    expect(Math.min(...zs(part))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...zs(part))).toBeLessThanOrEqual(10.5);
  }
  expect(validateLayout(spec, [cutout], new Map([[pocket.shape.id, pocket.shape]])).some(i => i.code === "pegs-up-pocket-roof" && i.severity === "warning")).toBe(true);
});

it("keeps floor and border colour volumes inside a thin arbitrary body", async () => {
  const spec = parseBinSpec({ gridX: 1, gridY: 1, arbitrarySizeMm: { width: 23.7, length: 17.8 }, heightUnits: 2.4 / 7, lip: "none", fill: "none", flatBottom: true });
  const result = (await getHandler()({ spec, quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.6, stackingRimMaterialThicknessMm: 0.6, borderWidthMm: 1.2 }, context())).value;
  expect(result.materialMeshes!.pocketFloors).toBeDefined();
  const floorTop = Math.max(...Array.from(result.materialMeshes!.pocketFloors!.positions).filter((_, i) => i % 3 === 2));
  expect(floorTop).toBeCloseTo(2.4, 5);
  for (const part of Object.values(result.materialMeshes!)) {
    expect(nonManifoldEdgeCount(part)).toBe(0);
    const zs = Array.from(part.positions).filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(0); expect(Math.max(...zs)).toBeLessThanOrEqual(2.4 + 1e-6);
  }
});
