import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, tracedShapeSchema } from "@shared/gridfinity/cutout";
import { pocketInsertionAxis } from "@shared/gridfinity/pocket-insertion";
import { rigidPocket } from "@shared/gridfinity/rigid-pocket";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import type { MeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { buildCutoutCutters, buildRigidPocket } from "@/lib/gridfinity/cutouts";
import { EXPORT_QUALITY, PREVIEW_QUALITY, type BuildQuality } from "@/lib/gridfinity/bin";
import { createBinWorkerHandlers } from "@/lib/gridfinity/bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "@/lib/gridfinity/worker-api";
import fixture from "./fixtures/tape-measure-outline.json";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
// The reported photo trace has 230 vertices. Default rounds create thousands
// of narrow facets, which simple rectangle/concave fixtures do not exercise.
const shape = tracedShapeSchema.parse(fixture);
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid", lip: "standard" });
const upright = parseCutoutPlacement({ id: "tape-pocket", shapeId: shape.id, position: { x: 7.105427357601002e-15, y: -7.105427357601002e-15 },
  depth: { mode: "remaining", floorThicknessMm: 7 }, clearanceMm: 0,
  cornerRoundMm: 1, topFilletMm: 1, bottomFilletMm: 2.8 });
// Freeze depth before applying the first tilt, exactly as the UI does.
const original = rigidPocket(upright, shape, spec);
const poses = [
  { xDeg: 20, yDeg: 0, rotationDeg: 0 },
  { xDeg: 0, yDeg: 20, rotationDeg: 0 },
  { xDeg: 20, yDeg: 25, rotationDeg: 17 },
];
const cases: { quality: BuildQuality; pose: typeof poses[number]; insertionMode: "axis" | "vertical" }[] =
  [PREVIEW_QUALITY, EXPORT_QUALITY].flatMap(quality => poses.map(pose => ({ quality, pose, insertionMode: "axis" as const })));
// A detailed vertical case exercises the general facet sweep too. Keep its
// underside flat here; rounded vertical and split seats have dedicated tests.
cases.push({ quality: { ...PREVIEW_QUALITY, circularSegments: 16, filletProfileStepMm: 2 },
  pose: poses[0], insertionMode: "vertical" });

it.each(cases)("clears the detailed rounded source at quality=$quality.cutoutVertexBudget, pose=$pose, insertion=$insertionMode", ({ quality, pose, insertionMode }) => {
  const p = { ...original, tilt: { xDeg: pose.xDeg, yDeg: pose.yDeg }, rotationDeg: pose.rotationDeg, insertionMode,
    ...(insertionMode === "vertical" ? { bottomFilletMm: 0 } : {}) };
  const source = arena.track(kernel.Manifold.union(buildRigidPocket(kernel, shape, { ...p, insertionMode: undefined, topFilletMm: 0 }, spec, quality).cutters));
  const built = buildCutoutCutters(kernel, new Map([[shape.id, shape]]), [p], spec, quality);
  const cutter = arena.track(kernel.Manifold.union(built.cutters));
  const axis = pocketInsertionAxis(p), top = resolvePocketDepth(spec, p.depth).infillTopZ;
  expect(cutter.status()).toBe("NoError");
  for (const travel of [0, 3, 12]) {
    const moved = arena.track(source.translate([axis.x * travel, axis.y * travel, axis.z * travel]));
    const belowTop = arena.track(moved.trimByPlane([0, 0, -1], -top));
    const inside = arena.track(belowTop.trimByPlane([0, 0, 1], 7));
    expect(arena.track(inside.subtract(cutter)).volume(), `source blocked after ${travel} mm travel`).toBeLessThan(0.01);
  }
}, 120_000);

/** Independent ray intersection on the serialized mesh, without kernel repair. */
function highestAt(mesh: MeshData, x: number, y: number): number {
  let highest = -Infinity;
  const vertex = (index: number) => Array.from(mesh.positions.subarray(index * 3, index * 3 + 3));
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = Array.from(mesh.indices.subarray(i, i + 3), vertex);
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
    if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) highest = Math.max(highest, u * a[2] + v * b[2] + (1 - u - v) * c[2]);
  }
  return highest;
}

it.each(poses.slice(0, 2))("exports closed meshes and continuous floor material for pose=%j", async pose => {
  const p = { ...original, tilt: { xDeg: pose.xDeg, yDeg: pose.yDeg }, insertionMode: "axis" as const };
  const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as
    (request: BuildBinRequest, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
  const { value } = await handler({ spec, quality: EXPORT_QUALITY, exportTopology: true,
    layout: { shapes: [shape], cutouts: [p], fingerHoles: [] }, pocketFloorMaterialThicknessMm: 0.6,
    stackingRimMaterialThicknessMm: 1.25 }, { signal: new AbortController().signal, progress: () => {} });
  expect(value.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
  expectPrintableTopology(value.mesh, "complete bin");
  const materials = value.materialMeshes!;
  expect(materials.pocketFloors).toBeDefined();
  for (const [name, mesh] of Object.entries(materials)) expectPrintableTopology(mesh, name);
  expect(Math.abs(Object.values(materials).reduce((volume, mesh) => volume + signedMeshVolume(mesh), 0) - signedMeshVolume(value.mesh))).toBeLessThan(0.05);
  // These interior points crossed the former phantom slit, which the floor
  // rounding offset widened into a visible stripe of the body material.
  for (const y of pose.xDeg ? [17.57, 19.57] : [20.57, 22.57]) {
    const top = highestAt(value.mesh, 0.31, y);
    expect(highestAt(materials.pocketFloors!, 0.31, y)).toBeCloseTo(top, 4);
    expect(highestAt(materials.body, 0.31, y)).toBeLessThan(top - 0.5);
  }
}, 120_000);
