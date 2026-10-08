import { beforeAll, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { Outline } from "@shared/geometry/types";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { normalizeOutline, outlineBounds, outlinePointCount } from "@/lib/geometry/outline";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { extractMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { expectPartitionOccupancy, expectPrintableTopology, expectSameGeometry, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import { writeThreeMf } from "@/lib/mesh/threemf";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";

type Family = "rectangle" | "circle" | "concave" | "holed";
type BuildHandler = (request: BuildBinRequest, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
let wasm: ManifoldToplevel;
beforeAll(async () => { wasm = await loadManifold(); });

function shapeFor(family: Family): TracedShape {
  const ring = (points: number[][]) => points.map(([x, y]) => ({ x, y }));
  const rectangle = ring([[-10, -12], [10, -12], [10, 12], [-10, 12]]);
  const outline: Outline = [{
    outer: family === "circle" ? Array.from({ length: 32 }, (_, i) => ({ x: 11 * Math.cos(i * Math.PI / 16), y: 11 * Math.sin(i * Math.PI / 16) }))
      : family === "concave" ? ring([[-10, -12], [10, -12], [10, -2], [2, -2], [2, 12], [-10, 12]]) : rectangle,
    holes: family === "holed" ? [ring([[-4, -5], [-4, 5], [4, 5], [4, -5]])] : [],
  }];
  const outlineMm = normalizeOutline(outline);
  return { id: family, name: family, outlineMm, bboxMm: outlineBounds(outlineMm)!, pointCount: outlinePointCount(outlineMm), sourceMmPerPx: 1 };
}

/** Fixed seed makes failures reproducible while avoiding only hand-picked poses. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}
const cases = (["rectangle", "circle", "concave", "holed"] as const).flatMap((family, index) =>
  [0, 1].map(variant => ({ family, variant, seed: 0x706f636b + index * 101 + variant })));

function readSerializedParts(result: BuildBinResult): Record<string, MeshData> {
  const entries = Object.entries(result.materialMeshes!);
  const xml = strFromU8(unzipSync(writeThreeMf(entries.map(([name, mesh]) => ({ name, mesh }))))["3D/3dmodel.model"]);
  const meshes = [...xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)].map(([, contents], index): MeshData => {
    const coordinates = [...contents.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)]
      .flatMap(([, x, y, z]) => [Number(x), Number(y), Number(z)]);
    // Check XML at a slicer's double precision before Float32 could conceal
    // a second rounding step in the writer.
    expect(coordinates).toEqual(Array.from(entries[index][1].positions));
    return {
      positions: new Float32Array(coordinates),
      indices: new Uint32Array([...contents.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)]
        .flatMap(([, a, b, c]) => [Number(a), Number(b), Number(c)])),
      normals: null,
    };
  });
  expect(meshes).toHaveLength(entries.length);
  return Object.fromEntries(entries.map(([name], i) => [name, meshes[i]]));
}

it.each(cases)("conserves geometry and material ownership for $family, variant=$variant, seed=$seed", async ({ family, variant, seed }) => {
  const arena = new Arena(), kernel = createKernel(wasm, arena), random = seeded(seed), shape = shapeFor(family);
  const cutout = parseCutoutPlacement({ id: `p-${seed}`, shapeId: shape.id,
    position: { x: -25 + 3 * random(), y: -4 + 8 * random() }, elevationMm: variant ? 12 : 7,
    tilt: { xDeg: 25 + 12 * random(), yDeg: 17 + 12 * random() }, rotationDeg: 360 * random(), mirrored: random() > 0.5,
    depth: { mode: "mm", value: 16 }, insertionMode: "vertical", cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
  const request: BuildBinRequest = {
    spec: { gridX: 3, gridY: 3, heightUnits: 8, fill: "solid", lip: "none" },
    quality: EXPORT_QUALITY, exportTopology: true, layout: { shapes: [shape], cutouts: [cutout], fingerHoles: [] },
  };
  const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as BuildHandler;
  const build = async (r: BuildBinRequest) => (await handler(r, { signal: new AbortController().signal, progress: () => {} })).value;
  try {
    const spec = parseBinSpec(request.spec), layout = { shapesById: new Map([[shape.id, shape]]), cutouts: [cutout], fingerHoles: [] };
    const authored = buildBinWithCutouts(kernel, spec, layout, EXPORT_QUALITY).solid;
    const reference = extractMeshData(kernel, authored);
    const singleColor = await build(request);
    expectPrintableTopology(singleColor.mesh, "single-color aggregate");
    expectSameGeometry(reference, singleColor.mesh, "authored to single-color");
    let firstFloor: MeshData | undefined;
    for (const thickness of [0.25, 0.75]) {
      const result = await build({ ...request, pocketFloorMaterialThicknessMm: thickness, stackingRimMaterialThicknessMm: 1.25, borderWidthMm: 2 });
      expect(result.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
      const parts = readSerializedParts(result), meshes = Object.values(parts);
      for (const [name, mesh] of Object.entries(parts)) expectPrintableTopology(mesh, name);
      expectSameGeometry(reference, result.mesh, "authored to colored aggregate");
      expectSameGeometry(singleColor.mesh, result.mesh, "color toggle");
      expect(Math.abs(meshes.reduce((sum, mesh) => sum + signedMeshVolume(mesh), 0) - signedMeshVolume(reference)), "total serialized material volume").toBeLessThan(0.05);
      expectPartitionOccupancy(reference, meshes);
      // Correct exterior alone is insufficient: material assignments must also
      // match the authored floor mask, rather than silently returning all body.
      const expected = buildBinWithCutouts(kernel, spec, layout, EXPORT_QUALITY, { floorInsertThicknessMm: thickness, rimInsertThicknessMm: 1.25, borderWidthMm: 2 });
      expect(parts.pocketFloors).toBeDefined();
      expect(expected.materialParts?.pocketFloors).not.toBeNull();
      expectSameGeometry(extractMeshData(kernel, expected.materialParts!.pocketFloors!), parts.pocketFloors, "floor ownership", 0.001, 0.01);
      if (firstFloor) expect(signedMeshVolume(parts.pocketFloors)).toBeGreaterThan(signedMeshVolume(firstFloor));
      else firstFloor = parts.pocketFloors;
    }

    // Adding a disjoint pocket must not alter the first pocket's floor color.
    const added = parseCutoutPlacement({ ...cutout, id: "disjoint-pocket", position: { x: 30, y: 0 }, elevationMm: 7, tilt: { xDeg: 0, yDeg: 0 }, rotationDeg: 0 });
    const combined = await build({ ...request, pocketFloorMaterialThicknessMm: 0.25,
      layout: { ...request.layout!, cutouts: [cutout, added] } });
    const combinedParts = readSerializedParts(combined);
    // Select the disconnected left component directly from indexed triangles.
    // Reimporting Float32 export geometry into the kernel would make this
    // independence oracle depend on the very constructor boundary being fixed.
    const floor = combinedParts.pocketFloors, left: number[] = [];
    for (let i = 0; i < floor.indices.length; i += 3) {
      const triangle = Array.from(floor.indices.subarray(i, i + 3));
      const sides = triangle.map(index => floor.positions[index * 3] < 0);
      expect(sides.every(side => side === sides[0]), "disjoint floors must not cross x=0").toBe(true);
      if (sides[0]) left.push(...triangle);
    }
    const localFloor: MeshData = { positions: floor.positions, indices: new Uint32Array(left), normals: null };
    expectPrintableTopology(localFloor, "isolated left floor");
    expectSameGeometry(firstFloor!, localFloor, "disjoint pocket independence", 0.001, 0.01);
  } finally {
    arena.dispose();
  }
}, 30_000);
