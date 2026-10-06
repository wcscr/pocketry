import { expect, it } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import { loadManifold, withKernel } from "@/lib/manifold/runtime";
import { objectEdges } from "@/lib/mesh/object-edges";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { resolvedProfileFootprint } from "./profile-bottom";
import { RESOLVE_POCKET_GEOMETRY_METHOD, type PocketGeometry, type ResolvePocketGeometryRequest } from "./worker-api";

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none", fill: "solid" });
const shape: TracedShape = { id: "s", name: "Concave tool", sourceMmPerPx: 1, pointCount: 6,
  bboxMm: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  outlineMm: [{ outer: [[0,0],[20,0],[20,10],[10,10],[10,20],[0,20]].map(([x,y]) => ({x,y})), holes: [] }] };
const placement = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 4, y: -7 }, elevationMm: 8,
  rotationDeg: 23, tilt: { xDeg: 65, yDeg: -15 }, mirrored: true, depth: { mode: "mm", value: 12 },
  clearanceMm: 0.5, topFilletMm: 0.5, bottomFilletMm: 1,
  split: { boundary: [{x:-5,y:5},{x:25,y:5}], depths: [{mode:"mm",value:12},{mode:"mm",value:8}] } });
const handler = () => createBinWorkerHandlers(loadManifold)[RESOLVE_POCKET_GEOMETRY_METHOD] as unknown as
  (request: ResolvePocketGeometryRequest, context: HandlerContext) => Promise<TransferableResult<PocketGeometry[]>>;
const context = (signal = new AbortController().signal): HandlerContext => ({ signal, progress: () => {} });

it("returns the same posed rounded split solid and prepares its crease edges in the worker", async () => {
  const request = { spec, pockets: [{ shape, cutout: placement }] };
  const before = JSON.stringify(request);
  const reference = await withKernel(kernel => resolvedPocketGeometry(kernel, shape, placement, spec));
  const result = await handler()(request, context());
  expect(result.value[0].full).toEqual(reference.full);
  expect(result.value[0].opening).toEqual(reference.opening);
  expect(result.value[0].mesh).toEqual(reference.mesh);
  expect(result.value[0].edges).toEqual(objectEdges(reference.mesh));
  expect(result.transfer).toContain(result.value[0].mesh!.positions.buffer);
  expect(result.transfer).toContain(result.value[0].mesh!.indices.buffer);
  expect(new Set(result.transfer).size).toBe(result.transfer.length);
  expect(JSON.stringify(request)).toBe(before);
});

it("preserves legacy profile boundaries without requiring a rigid mesh", async () => {
  const cutout = parseCutoutPlacement({ id: "profile", shapeId: shape.id, position: { x: -5, y: 4 },
    profileBottom: { edge: "bottom", widthMm: 8, elevationMm: 7 }, profileRotation: { xDeg: 20, yDeg: 35 }, rotationDeg: 15 });
  const reference = await withKernel(kernel => ({ full: resolvedProfileFootprint(kernel, shape.outlineMm, cutout),
    opening: resolvedProfileFootprint(kernel, shape.outlineMm, cutout, resolvePocketDepth(spec, cutout.depth).infillTopZ) }));
  const result = await handler()({ spec, pockets: [{ shape, cutout }] }, context());
  expect(result.value[0]).toEqual(reference);
  expect(result.transfer).toEqual([]);
});

it("rejects cancelled and invalid outline requests", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(handler()({ spec, pockets: [{ shape, cutout: placement }] }, context(controller.signal))).rejects.toThrow("cancelled");
  await expect(handler()({ spec, pockets: [{ shape, cutout: { ...placement, scaleX: 0 } }] }, context())).rejects.toThrow();
});
