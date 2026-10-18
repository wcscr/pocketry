import { expect, it } from "vitest";
import { parseCutoutPlacement, tracedShapeSchema } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { rigidPocket } from "@shared/gridfinity/rigid-pocket";
import { loadManifold } from "@/lib/manifold/runtime";
import type { MeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { EXPORT_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";
import fixture from "./fixtures/tape-measure-outline.json";

/** STL stores coordinates without indexed identities. Check exact-coordinate
 * topology too: otherwise coincident sheets can pass the indexed 3MF contract. */
function coordinateWelded(mesh: MeshData): MeshData {
  const lookup = new Map<string, number>(), remap: number[] = [], positions: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const point = Array.from(mesh.positions.subarray(i, i + 3)), key = point.join(",");
    if (!lookup.has(key)) {
      lookup.set(key, positions.length / 3);
      positions.push(...point);
    }
    remap.push(lookup.get(key)!);
  }
  return { positions: new Float32Array(positions), indices: Uint32Array.from(mesh.indices, index => remap[index]), normals: null };
}

it("exports the height-12 standing photo without coincident underside sheets", async () => {
  const shape = tracedShapeSchema.parse(fixture);
  const originalSpec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid", lip: "standard" });
  const original = rigidPocket(parseCutoutPlacement({ id: "standing", shapeId: shape.id,
    position: { x: 7.105427357601002e-15, y: -7.105427357601002e-15 },
    depth: { mode: "remaining", floorThicknessMm: 7 }, cornerRoundMm: 1, topFilletMm: 1, bottomFilletMm: 2.8,
    clearanceMm: 0 }), shape, originalSpec);
  const cutout = { ...original, tilt: { xDeg: 0, yDeg: 80 }, insertionMode: "axis" as const, insertionAxis: "x" as const };
  const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as
    (request: BuildBinRequest, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
  const { value } = await handler({ spec: { ...originalSpec, heightUnits: 12 }, quality: EXPORT_QUALITY,
    exportTopology: true, layout: { shapes: [shape], cutouts: [cutout], fingerHoles: [] },
    pocketFloorMaterialThicknessMm: .6, stackingRimMaterialThicknessMm: 1.25 },
  { signal: new AbortController().signal, progress: () => {} });
  expect(value.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
  const parts = value.materialMeshes!;
  expect(parts.pocketFloors).toBeDefined();
  for (const [name, mesh] of Object.entries({ complete: value.mesh, ...parts })) {
    expectPrintableTopology(mesh, name);
    expectPrintableTopology(coordinateWelded(mesh), `${name}: exact-coordinate topology`);
    expect(signedMeshVolume(mesh)).toBeGreaterThan(0);
  }
  expect(Math.abs(Object.values(parts).reduce((sum, mesh) => sum + signedMeshVolume(mesh), 0)
    - signedMeshVolume(value.mesh))).toBeLessThan(.05);
}, 120_000);
