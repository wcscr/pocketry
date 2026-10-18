import { expect, it } from "vitest";
import { parseCutoutPlacement, transformPointPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { pocketInsertionAxis } from "@shared/gridfinity/pocket-insertion";
import { withKernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology } from "@/lib/mesh/mesh-contract.test-helpers";
import { buildRigidPocket } from "./cutouts";
import { PREVIEW_QUALITY } from "./bin";
import { buildObjectCavity } from "./object-cavity";

/** Independent solid-angle containment on exported Float32 triangles. */
function containsPoint(mesh: MeshData, point: number[]): boolean {
  const vertex = (i: number) => [0,1,2].map(axis => mesh.positions[i*3+axis]-point[axis]);
  const dot = (a: number[], b: number[]) => a.reduce((sum,v,i) => sum+v*b[i],0);
  let angle = 0;
  for (let i=0;i<mesh.indices.length;i+=3) {
    const [a,b,c] = Array.from(mesh.indices.subarray(i,i+3),vertex);
    const na=Math.hypot(...a), nb=Math.hypot(...b), nc=Math.hypot(...c);
    const cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
    angle += 2*Math.atan2(dot(a,cross),na*nb*nc+dot(a,b)*nc+dot(b,c)*na+dot(c,a)*nb);
  }
  return Math.abs(angle)>2*Math.PI;
}

function expectSeatedMeshInside(source: MeshData, swept: MeshData) {
  let samples = 0;
  const step = Math.max(1,Math.floor(source.indices.length/3/64));
  for (let face=0;face<source.indices.length/3;face+=step) {
    const [a,b,c]=Array.from(source.indices.subarray(face*3,face*3+3),i => Array.from(source.positions.subarray(i*3,i*3+3)));
    const u=b.map((v,i)=>v-a[i]),v=c.map((value,i)=>value-a[i]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
    if (!length) continue;
    const point=a.map((value,i)=>(value+b[i]+c[i])/3-normal[i]/length*0.0001);
    if (!containsPoint(source,point)) continue;
    expect(containsPoint(swept,point),"seated source mesh extends outside the sweep").toBe(true);
    samples++;
  }
  expect(samples).toBeGreaterThan(20);
}

const shape: TracedShape = { id: "sideways", name: "Concave split tool", sourceMmPerPx: 1, pointCount: 16,
  bboxMm: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
  outlineMm: [{ outer: [[-20,-20],[20,-20],[20,-5],[6,-5],[6,10],[20,10],[20,20],[-20,20]].map(([x,y]) => ({x,y})),
    holes: [[[-15,-12],[-15,-5],[-8,-5],[-8,-12]],[[-15,4],[-15,12],[-8,12],[-8,4]]].map(r => r.map(([x,y]) => ({x,y}))) }] };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 8, fill: "solid", lip: "none" });

it.each([
  { axis: "x" as const, tilt: { xDeg: 20, yDeg: 65 }, mirrored: false },
  { axis: "x" as const, tilt: { xDeg: 20, yDeg: -65 }, mirrored: true },
  { axis: "y" as const, tilt: { xDeg: 65, yDeg: 20 }, mirrored: false },
  { axis: "y" as const, tilt: { xDeg: -65, yDeg: 20 }, mirrored: true },
])("clears the split source across its original boundary along $axis: $tilt", async ({ axis, tilt, mirrored }) => withKernel(kernel => {
  const { arena } = kernel;
  const depths = [
    { mode: "remaining" as const, floorThicknessMm: 9, sourceDepthMm: 6 },
    { mode: "remaining" as const, floorThicknessMm: 17, sourceDepthMm: 15 },
  ];
  const p = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 3, y: -2 }, rotationDeg: 17,
    tilt, mirrored, elevationMm: 7, insertionMode: "axis", insertionAxis: axis, depth: depths[0],
    cornerRoundMm: 0, bottomFilletMm: .8, topFilletMm: 0, clearanceMm: 0,
    split: { boundary: axis === "x" ? [{ x:0,y:-30 },{ x:0,y:30 }] : [{ x:-30,y:0 },{ x:30,y:0 }], depths } });
  const local = parseCutoutPlacement({ ...p, position: { x:0,y:0 }, rotationDeg: 0, tilt: undefined,
    insertionMode: undefined, elevationMm: 0, depth: { mode: "mm", value: 6 },
    split: { ...p.split!, depths: [{ mode:"mm", value:6 },{ mode:"mm", value:15 }] } });
  const localPlaced = buildRigidPocket(kernel, shape, local, spec, PREVIEW_QUALITY).cutters[0];
  const source = arena.track(localPlaced.translate([0,0,-localPlaced.boundingBox().max[2]]));
  const pose = { rotation: { ...tilt, zDeg: p.rotationDeg }, position: p.position, elevationMm: p.elevationMm! };
  const actual = buildRigidPocket(kernel, shape, p, spec, PREVIEW_QUALITY, {}, 56).cutters[0];
  // Check the native finite source at its seated pose, then independently
  // check serialized boundary samples and each moving split section.
  const finite = buildRigidPocket(kernel, shape, { ...p, insertionMode: undefined }, spec, PREVIEW_QUALITY, {}, 56).cutters[0];
  expect(arena.track(finite.subtract(actual)).volume()).toBeLessThan(.001);
  expectSeatedMeshInside(extractPrintableMeshData(kernel, finite), extractPrintableMeshData(kernel, actual));
  const direction = pocketInsertionAxis(p);
  const [a,b] = p.split!.boundary.map(point => transformPointPlacement(point, local));
  const length = Math.hypot(b.x-a.x,b.y-a.y);
  for (const [i, depth] of depths.entries()) {
    const sign = (mirrored ? -1 : 1) * (i === 0 ? 1 : -1);
    const nx = -(b.y-a.y)/length*sign, ny = (b.x-a.x)/length*sign;
    const part = arena.track(source.trimByPlane([nx,ny,0], nx*a.x+ny*a.y));
    const placed = buildObjectCavity(kernel, part, pose, Infinity, source)!;
    for (const travel of [.0001,.001,.3,3,12,30,60]) {
      const moved = arena.track(placed.translate([direction.x*travel,direction.y*travel,direction.z*travel]));
      const clipped = arena.track(arena.track(moved.trimByPlane([0,0,1],depth.floorThicknessMm)).trimByPlane([0,0,-1],-56));
      expect.soft(arena.track(clipped.subtract(actual)).volume(), `section ${i} blocked after ${travel} mm`).toBeLessThan(.001);
    }
  }
  expectPrintableTopology(extractPrintableMeshData(kernel, actual));
}), 30_000);
