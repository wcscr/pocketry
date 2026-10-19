// Shared fixtures and lifecycle hooks for the matching test suites.
import { afterEach, beforeAll, beforeEach } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { EXPORT_QUALITY } from "./bin";
import { buildCutoutCutters } from "./cutouts";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "tool", name: "Raised tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -10, maxX: 10, minY: -12, maxY: 12 },
  outlineMm: [{ outer: [[-10,-12],[10,-12],[10,12],[-10,12]].map(([x,y]) => ({x,y})), holes: [] }] };
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, fill: "solid", lip: "none" });
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 0, y: 0 },
  elevationMm: 12, depth: { mode: "mm", value: 16 }, clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 2, bottomFilletMm: 1 });
const layout = (p = pocket, s = shape) => ({ shapesById: new Map([[s.id,s]]), cutouts: [p], fingerHoles: [] });
function cutter(p = pocket, bin = spec, s = shape, quality = EXPORT_QUALITY) {
  return arena.track(kernel.Manifold.union(buildCutoutCutters(kernel, new Map([[s.id,s]]), [p], bin, quality).cutters));
}

export { wasm, arena, kernel, shape, spec, pocket, layout, cutter };
