import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { extractMeshData, extractPrintableMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement, tracedShapeSchema } from "@shared/gridfinity/cutout";
import { rotateObjectVector, type Vec3 } from "@shared/gridfinity/object-pose";
import { pocketRotation } from "@shared/gridfinity/rigid-pocket";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import fixture from "./fixtures/sideways-tape-color.json";
import type { Manifold } from "manifold-3d";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());

function surfaceAreas(mesh: MeshData, capNormal: Vec3) {
  let parallelCaps = 0, clippedFloor = 0;
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [0, 1, 2].map(j => mesh.indices[i + j] * 3), [a, b, c] = ids;
    const u = [0, 1, 2].map(j => p[b + j] - p[a + j]), v = [0, 1, 2].map(j => p[c + j] - p[a + j]);
    const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const length = Math.hypot(...cross);
    if (Math.abs(cross[0]*capNormal.x + cross[1]*capNormal.y + cross[2]*capNormal.z) > length * .99999)
      parallelCaps += length / 2;
    if (ids.every(id => Math.abs(p[id + 2] - 7) < 1e-4)) clippedFloor += length / 2;
  }
  return { parallelCaps, clippedFloor };
}

/** Check exposed cavity walls, not internal lining interfaces. A stepped
 * lining necessarily has hidden vertical faces between it and the body. */
function expectUncoloredWalls(mesh: MeshData, color: Manifold) {
  const p = mesh.positions;
  let checked = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(j => mesh.indices[i + j] * 3);
    const u = [0, 1, 2].map(j => p[b + j] - p[a + j]), v = [0, 1, 2].map(j => p[c + j] - p[a + j]);
    const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const length = Math.hypot(...normal);
    const center = [0, 1, 2].map(j => (p[a + j] + p[b + j] + p[c + j]) / 3);
    if (length < 10 || normal[2] / length > .5 || Math.abs(center[0]) > 55
      || Math.abs(center[1]) > 55 || center[2] < 7.5 || center[2] > 40) continue;
    const position = center.map((x, j) => x - .002 * normal[j] / length) as [number, number, number];
    const probe = arena.track(arena.track(kernel.Manifold.cube([.001, .001, .001], true)).translate(position));
    expect(arena.track(color.intersect(probe)).volume(), `wall at ${center}`).toBeLessThan(1e-12);
    checked++;
  }
  expect(checked).toBeGreaterThan(10);
}

// Exact 33-point tape trace exported from the user's failing local preview.
// X is the live design; Y reproduces the screenshot's 38.8-degree insertion.
it.each([
  { name: "X", tilt: fixture.cutouts[0].tilt, axis: "x" as const },
  { name: "Y", tilt: { xDeg: 51.2, yDeg: 0 }, axis: "y" as const },
  { name: "inverted Y", tilt: { xDeg: -51.2, yDeg: 0 }, axis: "y" as const },
  { name: "vertical X", tilt: { xDeg: 0, yDeg: -90 }, axis: "x" as const },
  { name: "vertical Y", tilt: { xDeg: 90, yDeg: 0 }, axis: "y" as const },
])("restricts $name floor color to the support surface in preview and printable material parts", ({ tilt, axis }) => {
  const cutout = parseCutoutPlacement({ ...fixture.cutouts[0], tilt, insertionAxis: axis });
  const layout = { shapesById: new Map(fixture.shapes.map(s => [s.id, tracedShapeSchema.parse(s)])),
    cutouts: [cutout], fingerHoles: [] };
  const spec = parseBinSpec(fixture.spec);
  const capNormal = rotateObjectVector({ x: 0, y: 0, z: 1 }, pocketRotation(cutout));
  for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
    const plain = buildBinWithCutouts(kernel, spec, layout, quality);
    const colored = buildBinWithCutouts(kernel, spec, layout, quality,
      { floorInsertThicknessMm: .6, rimInsertThicknessMm: 1.25 });
    expect(colored.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(colored.solid.volume()).toBeCloseTo(plain.solid.volume(), 6);
    const parts = colored.materialParts!;
    expect(parts.pocketFloors!.volume()).toBeGreaterThan(100);
    // Boolean tolerances at coincident material interfaces can leave less
    // than 0.01 mm³ of numerical residue in this 500,000+ mm³ model.
    expect(arena.track(parts.body.intersect(parts.pocketFloors!)).volume()).toBeLessThan(.01);
    const mesh = extractMeshData(kernel, parts.pocketFloors!);
    const areas = surfaceAreas(mesh, capNormal);
    if (Math.abs(tilt.yDeg) === 90) expectUncoloredWalls(extractMeshData(kernel, colored.solid), parts.pocketFloors!);
    // Only the thin lining's end faces belong here. The regression painted
    // 3,129/7,825 mm² of parallel caps and 752/823 mm² of the clipped floor.
    // At exactly 90°, many hidden lining interfaces are vertical too; inspect
    // actual exposed walls above instead of applying this aggregate cap limit.
    if (Math.abs(tilt.yDeg) !== 90) expect(areas.parallelCaps).toBeLessThan(300);
    expect(areas.clippedFloor).toBeLessThan(Math.abs(tilt.yDeg) === 90 ? 4 : 3);
    if (quality === EXPORT_QUALITY) {
      const printable = [parts.body, parts.pocketFloors!, parts.stackingRim!]
        .map(part => extractPrintableMeshData(kernel, part));
      printable.forEach((part, i) => expectPrintableTopology(part, `material ${i}`));
      if (Math.abs(tilt.yDeg) === 90) expectUncoloredWalls(extractPrintableMeshData(kernel, colored.solid), parts.pocketFloors!);
      expect(Math.abs(printable.reduce((volume, part) => volume + signedMeshVolume(part), 0)
        - plain.solid.volume())).toBeLessThan(.05);
      if (Math.abs(tilt.yDeg) !== 90) expect(surfaceAreas(printable[1], capNormal).parallelCaps).toBeLessThan(300);
      expect(surfaceAreas(printable[1], capNormal).clippedFloor).toBeLessThan(Math.abs(tilt.yDeg) === 90 ? 4 : 3);
    }
  }
}, 120000);
