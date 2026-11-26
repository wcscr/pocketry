import { expect, it } from "vitest";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec, type BinSpec, type BinSpecInput } from "@shared/gridfinity/types";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { loadManifold } from "@/lib/manifold/runtime";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { autoPlaceIncremental, autoPlaceWithGrowth } from "./autoplace";
import { createBasicPocket } from "./basic-shape";
import { placeSurfaceTextOnTab } from "./surface-text";
import { EXPORT_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";

function exportBin(spec: BinSpec, cutouts: CutoutPlacement[], shapes: TracedShape[]) {
  const worker = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as
    (request: BuildBinRequest, ctx: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
  return worker({ spec, quality: EXPORT_QUALITY, exportTopology: true,
    layout: { cutouts, shapes, fingerHoles: [] } }, { signal: new AbortController().signal, progress: () => {} });
}

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
  const { value } = await exportBin({ ...spec, arbitrarySizeMm: resized!.arbitrarySizeMm ?? null },
    [existing, ...resized!.cutouts.map(cutout => ({ ...cutout, depth }))], shapes);
  expect(value.mesh.indices.length).toBeGreaterThan(0);
  expect(value.textMeshes?.map(part => part.label.id) ?? []).toEqual(textIds);
});

it("preserves the exportable custom tab when converting would remove its edge", async () => {
  const bare = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, lip: "none",
    footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    labelTab: { wall: "north", edge: { cell: { x: 1, y: 0 }, side: "north" } } });
  const tabLabel = placeSurfaceTextOnTab(bare, surfaceTextSchema.parse({
    id: "tab-label", text: "M4", surface: "label-tab", position: { x: 0, y: 0 },
  }));
  const spec = parseBinSpec({ ...bare, surfaceTexts: [tabLabel] });
  const existing = createBasicPocket("rectangle", { x: -36, y: -36 }, { x: -16, y: -16 }, "existing")!;
  const incoming = createBasicPocket("square", { x: -11, y: -11 }, { x: 11, y: 11 }, "incoming")!;
  const shapes = [existing.shape, incoming.shape];
  const options = { spec, gridX: spec.gridX, gridY: spec.gridY, lip: spec.lip, keepBinSize: true,
    existing: [existing.cutout], shapesById: new Map(shapes.map(shape => [shape.id, shape])) };
  const original = await exportBin(spec, [existing.cutout], shapes);
  expect(original.value.textMeshes?.map(part => part.label.id)).toEqual([tabLabel.id]);
  expect(autoPlaceIncremental([incoming.shape], options).overflow).toBe(true);
  expect(autoPlaceWithGrowth([incoming.shape], options)).toBeNull();
});

it("places the next pocket beside a raised label at the existing exact size", async () => {
  const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 4, flatBottom: true, lip: "none",
    arbitrarySizeMm: { width: 83.5, length: 41.5 }, surfaceTexts: [{ ...label, position: { x: 13.5, y: 0 } }] });
  const existing = createBasicPocket("rectangle", { x: -27, y: -17 }, { x: -3, y: 17 }, "existing")!;
  const incoming = createBasicPocket("rectangle", { x: -10, y: -16 }, { x: 10, y: 16 }, "incoming")!;
  const shapes = [existing.shape, incoming.shape];
  const options = { spec, gridX: spec.gridX, gridY: spec.gridY, lip: spec.lip, keepBinSize: true,
    existing: [existing.cutout], shapesById: new Map(shapes.map(shape => [shape.id, shape])) };
  const current = autoPlaceIncremental([incoming.shape], options);
  expect(current.overflow).toBe(false);
  expect(current.cutouts[0].position.x).toBeGreaterThan(25);
  const { value } = await exportBin(spec, [existing.cutout, ...current.cutouts], shapes);
  expect(value.textMeshes?.map(part => part.label.id)).toEqual([label.id]);
});
