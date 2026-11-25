import { expect, it } from "vitest";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec, type BinSpecInput } from "@shared/gridfinity/types";
import { loadManifold } from "@/lib/manifold/runtime";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { autoPlaceIncremental, autoPlaceWithGrowth } from "./autoplace";
import { createBasicPocket } from "./basic-shape";
import { EXPORT_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";

const label = surfaceTextSchema.parse({ id: "label", text: "A", sizeMm: 4, position: { x: 15.5, y: 0 } });
const cases: { name: string; spec: Partial<BinSpecInput>; textIds: string[] }[] = [
  { name: "an existing raised label", spec: { surfaceTexts: [label] }, textIds: [label.id] },
  { name: "an inward slanted wall", spec: { wallSlant: { axis: "x", side: "positive", angleDeg: -18 } }, textIds: [] },
];

it.each(cases)("exports a bin resized around $name", async ({ spec: overrides, textIds }) => {
  const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 4, flatBottom: true, lip: "none",
    arbitrarySizeMm: { width: 41.5, length: 41.5 }, ...overrides });
  const old = createBasicPocket("rectangle", { x: -9, y: -9 }, { x: 9, y: 9 }, "existing")!;
  const incoming = createBasicPocket("rectangle", { x: -14, y: -16 }, { x: 14, y: 16 }, "incoming")!;
  const depth = { mode: "mm" as const, value: 6 };
  const existing = { ...old.cutout, depth };
  const shapes = [old.shape, incoming.shape];
  const options = { spec, gridX: spec.gridX, gridY: spec.gridY, lip: spec.lip, keepBinSize: true,
    existing: [existing], shapesById: new Map(shapes.map(shape => [shape.id, shape])) };
  expect(autoPlaceIncremental([incoming.shape], options).overflow).toBe(true);
  const resized = autoPlaceWithGrowth([incoming.shape], options);
  expect(resized).not.toBeNull();
  const worker = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as
    (request: BuildBinRequest, ctx: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
  const { value } = await worker({ spec: { ...spec, arbitrarySizeMm: resized!.arbitrarySizeMm },
    quality: EXPORT_QUALITY, exportTopology: true,
    layout: { cutouts: [existing, ...resized!.cutouts.map(cutout => ({ ...cutout, depth }))],
      shapes, fingerHoles: [] } }, { signal: new AbortController().signal, progress: () => {} });
  expect(value.mesh.indices.length).toBeGreaterThan(0);
  expect(value.textMeshes?.map(part => part.label.id) ?? []).toEqual(textIds);
});
