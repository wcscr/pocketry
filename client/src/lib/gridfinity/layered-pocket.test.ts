import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCutoutPlacement, cutoutPlacementSchema, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { rigidPocketVertices } from "@shared/gridfinity/rigid-pocket";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { applyLinkedEdits } from "@shared/gridfinity/design-links";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { toCrossSection } from "@/lib/geometry/offset";
import { buildRigidPocket } from "./cutouts";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { EXPORT_QUALITY } from "./bin";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const rect = (x: number, y: number, w: number, h: number) =>
  [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([x,y]) => ({x,y}));
const outer = rect(-15,-12,30,24);
const holes = [[-10,-9],[7,-9],[-10,3],[7,3]].map(([x,y]) => rect(x,y,3,6).reverse());
const lower = [{ outer, holes }], upper = [{ outer, holes: [] }];
const shape: TracedShape = { id: "pcb", name: "PCB", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -15, maxX: 15, minY: -12, maxY: 12 }, outlineMm: upper };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid", lip: "none" });
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 3, y: -4 },
  depth: { mode: "mm", value: 15 }, elevationMm: 7, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 0,
  layers: [{ outlineMm: lower, bottom: 0, top: 0.2 }, { outlineMm: upper, bottom: 0.2, top: 1 }] });

describe("one layered PCB pocket", () => {
  it.each([[0,0,0,1,1,false],[90,0,17,1.2,0.8,true],[125,-24,20,1,1,false],[180,0,0,1,1,true]] as const)(
    "equals an independently constructed ribbed cavity at %s/%s/%s", (xDeg,yDeg,rotationDeg,scaleX,scaleY,mirrored) => {
      const p = { ...pocket, tilt: {xDeg,yDeg}, rotationDeg, scaleX, scaleY, mirrored };
      const solid = buildRigidPocket(kernel, shape, p, spec, EXPORT_QUALITY).cutters[0];
      const base = arena.track(kernel.Manifold.cube([30,24,15]).translate([-15,-12,-15]));
      const ribs = holes.map(ring => {
        const xs = ring.map(p=>p.x), ys = ring.map(p=>p.y);
        return arena.track(kernel.Manifold.cube([3,6,3]).translate([Math.min(...xs),Math.min(...ys),-15]));
      });
      const ribUnion = arena.track(kernel.Manifold.union(ribs));
      const source = arena.track(base.subtract(ribUnion));
      const scaled = arena.track(source.scale([scaleX * (mirrored ? -1 : 1), scaleY, 1]));
      const rotated = arena.track(scaled.rotate([xDeg,yDeg,rotationDeg]));
      const expected = arena.track(rotated.translate([3,-4,7-rotated.boundingBox().min[2]]));
      expect(arena.track(solid.subtract(expected)).volume()).toBeCloseTo(0, 5);
      expect(arena.track(expected.subtract(solid)).volume()).toBeCloseTo(0, 5);
      expect(solid.status()).toBe("NoError");
      const vertices = rigidPocketVertices(shape.outlineMm, p);
      for (const axis of [0,1,2] as const) {
        const key = (["x","y","z"] as const)[axis];
        expect(Math.min(...vertices.map(v=>v[key]))).toBeCloseTo(solid.boundingBox().min[axis], 5);
        expect(Math.max(...vertices.map(v=>v[key]))).toBeCloseTo(solid.boundingBox().max[axis], 5);
      }
    });
  it("scales all layer heights with total depth and preserves the four support seats", () => {
    const p = { ...pocket, depth: { mode: "mm" as const, value: 30 } };
    const solid = buildRigidPocket(kernel, shape, p, spec, EXPORT_QUALITY).cutters[0];
    expect(arena.track(solid.slice(12)).area()).toBeCloseTo(30*24-4*3*6, 5);
    expect(arena.track(solid.slice(14)).area()).toBeCloseTo(30*24, 5);
    expect(solid.boundingBox().max[2]).toBeCloseTo(37, 5);
    const lowSpec = { ...spec, heightUnits: 2 };
    const opening = resolvedPocketGeometry(kernel, shape, pocket, lowSpec).opening;
    expect(toCrossSection(kernel, opening).area()).toBeCloseTo(720, 4);
  });
  it("joins three fractional levels without internal seam sheets", () => {
    const depth = 14.295, seat = 3 / depth, pcbTop = 4.6 / depth;
    const p = { ...pocket, depth: { mode: "mm" as const, value: depth },
      layers: [{ outlineMm:lower,bottom:0,top:seat }, { outlineMm:upper,bottom:seat,top:pcbTop },
        { outlineMm:upper,bottom:pcbTop,top:1 }] };
    const solid = buildRigidPocket(kernel, shape, p, spec, EXPORT_QUALITY).cutters[0];
    const pieces = solid.decompose(); arena.trackAll(pieces);
    expect(pieces).toHaveLength(1);
    const box = arena.track(kernel.Manifold.cube([1,1,1]).translate([3,-4,9.5]));
    expect(arena.track(box.subtract(solid)).isEmpty()).toBe(true);
    expect(solid.volume()).toBeCloseTo(720*depth-4*3*6*3, 5);
  });
  it("round trips layers, history and as-drawn references, and migrates v26", () => {
    const doc = { spec, cutouts: [pocket], fingerHoles: [] };
    const project = { ...doc, schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape],
      history: { stack: [{ doc, label: "Import PCB" }], index: 0 },
      transformOrigins: { pockets: [{ cutout:pocket, spec }], fingerHoles:[] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
    const old = { ...pocket, layers: undefined };
    const oldDoc = { spec, cutouts: [old], fingerHoles: [] };
    const previous = { ...project, ...oldDoc, schemaVersion: 26,
      history: { stack: [{ doc: oldDoc, label: "Original" }], index: 0 },
      transformOrigins: { pockets: [{ cutout:old, spec }], fingerHoles:[] } };
    expect(parseProjectDoc(previous)).toEqual({ ...previous, schemaVersion: PROJECT_SCHEMA_VERSION });
  });
  it("propagates layer edits through linked copies without moving them", () => {
    const a = { ...pocket, designLink: { id:"linked", tilt:false } };
    const b = { ...a, id:"copy", position:{x:40,y:0} };
    const layers = a.layers!.map(layer=>({...layer,outlineMm:upper}));
    const changed = applyLinkedEdits({cutouts:[a,b],fingerHoles:[]}, {cutouts:[{...a,layers}],fingerHoles:[]})!;
    expect(changed.cutouts[1].layers).toEqual(layers);
    expect(changed.cutouts[1].position).toEqual(b.position);
  });
  it.each([
    { layers:[] }, { layers:[{outlineMm:lower,bottom:0,top:0.2},{outlineMm:upper,bottom:0.2000000005,top:1}] },
    { depth:{mode:"through"} }, { elevationMm:undefined }, { topFilletMm:1 },
    { layers:[{outlineMm:lower,bottom:0,top:0.3},{outlineMm:upper,bottom:0.2,top:1}] },
    { layers:[{outlineMm:lower,bottom:0,top:0.2},{outlineMm:upper,bottom:0.3,top:1}] },
    { layers:[{outlineMm:lower,bottom:0,top:0.2},{outlineMm:upper,bottom:0.2,top:0.9}] },
    { layers:[{outlineMm:lower,bottom:0,top:0},{outlineMm:upper,bottom:0,top:1}] },
    { split:{boundary:[{x:-15,y:0},{x:15,y:0}],depths:[{mode:"mm",value:3},{mode:"mm",value:5}]} },
  ])("rejects ambiguous or invalid layer configuration %j", patch => {
    expect(cutoutPlacementSchema.safeParse({...pocket,...patch}).success).toBe(false);
  });
});
