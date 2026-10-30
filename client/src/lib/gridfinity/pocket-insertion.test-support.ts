// Shared fixtures and lifecycle hooks for the matching test suites.
import { afterEach, beforeAll, beforeEach } from "vitest";
import type { Manifold } from "manifold-3d";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { buildCutoutCutters } from "./cutouts";
import { EXPORT_QUALITY } from "./bin";

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

export { wasm, arena, kernel, shape, spec, pocket, map, cutter, undersideAt };
