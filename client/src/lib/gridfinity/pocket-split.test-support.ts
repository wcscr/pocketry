// Shared fixtures and lifecycle hooks for the matching test suites.

import { afterEach, beforeAll, beforeEach } from "vitest";
import { parseCutoutPlacement, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";

let wasm: ManifoldToplevel;
let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "tool", name: "Tool", outlineMm: [{ outer: [{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }], holes: [] }],
  bboxMm: { minX: -30, minY: -10, maxX: 30, maxY: 10 }, pointCount: 4, sourceMmPerPx: 1 };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 5, flatBottom: true });
const shapesById = new Map([[shape.id, shape]]);
const pocket = (extra: Partial<CutoutPlacement> = {}) => parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, cornerRoundMm: 0, bottomFilletMm: 0,
  split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "remaining", floorThicknessMm: 2 }] }, ...extra });
const layout = (c: CutoutPlacement) => ({ cutouts: [c], shapesById, fingerHoles: [] });

export { wasm, arena, kernel, shape, spec, shapesById, pocket, layout };
