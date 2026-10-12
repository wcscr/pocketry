import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { Manifold } from "manifold-3d";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { extractMeshData, extractPrintableMeshData, type MeshData } from "./mesh-data";
import { expectPartitionOccupancy, expectPrintableTopology, expectSameGeometry, signedMeshVolume } from "./mesh-contract.test-helpers";
import { preparePrintableMesh } from "./printable-mesh";
import opposingFaces from "./fixtures/opposing-face-floor-band.json";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());

function verifyPreparation(solid: Manifold, name: string): void {
  const before = extractMeshData(kernel, solid);
  const after = extractPrintableMeshData(kernel, solid);
  expectPrintableTopology(after, name);
  expectSameGeometry(before, after, name);
  expectPartitionOccupancy(before, [after]);
  // Repeated finalization must not progressively erode a printable mesh.
  const again: MeshData = { ...preparePrintableMesh(after), normals: null };
  expectPrintableTopology(again, `${name}, second preparation`);
  expectSameGeometry(after, again, `${name}: idempotence`);
}

it("preserves an opposing-face thin band across the one-way printable mesh boundary", () => {
  const before: MeshData = { positions: new Float32Array(opposingFaces.positions), indices: new Uint32Array(opposingFaces.indices), normals: null };
  // Keep the independent raw mesh as the reference. Reconstructing this mesh
  // in the kernel already removes occupied volume despite reporting NoError.
  const positions = before.positions.slice(), indices = before.indices.slice();
  const prepared: MeshData = { ...preparePrintableMesh(before), normals: null };
  expectPrintableTopology(prepared);
  expectSameGeometry(before, prepared, "saved band preparation", 0.001, 0.01);
  expectPartitionOccupancy(before, [prepared]);
  expect(before.positions).toEqual(positions);
  expect(before.indices).toEqual(indices);
});

it.each([0.2, 0.7, 1.4].flatMap(thickness => [false, true].map(clipped => ({ thickness, clipped }))))(
  "preserves generated concave and holed sloping bands at thickness $thickness, clipped=$clipped", ({ thickness, clipped }) => {
  // Different construction from the saved fixture; use genuine non-convex and
  // holed geometry so a whole-object convex-hull workaround cannot satisfy it.
  const section = arena.track(new kernel.CrossSection([
    [[-12, -10], [12, -10], [12, 1], [4, 1], [4, 10], [-12, 10]],
    [[-8, -6], [-8, -2], [-4, -2], [-4, -6]],
  ], "NonZero"));
  const source = arena.track(arena.track(section.extrude(12)).rotate([23, 31, 47]));
  const shifted = arena.track(source.translate([0, 0, -thickness]));
  const band = arena.track(shifted.subtract(source));
  // Native partial intersections are independent of the UI policy that rejects
  // some above-surface pockets; this exercises their numeric export boundary.
  const partialBand = clipped ? arena.track(band.trimByPlane([0, 0, -1], -2)) : band;
  verifyPreparation(partialBand, `concave band ${thickness}, clipped=${clipped}`);
});

it("distinguishes legal touching components from collapsed geometric triangles", () => {
  const touching: MeshData = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, -1]),
    indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3, 4, 6, 5, 4, 5, 7, 5, 6, 7, 6, 4, 7]),
    normals: null,
  };
  expectPrintableTopology(touching);
  const prepared: MeshData = { ...preparePrintableMesh(touching), normals: null };
  expectPrintableTopology(prepared);
  expect(signedMeshVolume(prepared)).toBeCloseTo(1 / 3, 12);
  const pinched: MeshData = { ...touching, indices: new Uint32Array(Array.from(touching.indices, index => index === 4 ? 0 : index)) };
  expect(() => expectPrintableTopology(pinched)).toThrow(/link is one cycle/);
  const reversed = touching.indices.slice();
  [reversed[0], reversed[1]] = [reversed[1], reversed[0]];
  expect(() => expectPrintableTopology({ ...touching, indices: reversed })).toThrow(/oriented boundary/);
  expect(() => expectPrintableTopology({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), indices: new Uint32Array([0, 1, 2]), normals: null })).toThrow(/zero-area/);
});

it("detects moved geometry despite equal volume, and duplicate material occupancy", () => {
  const cube = arena.track(kernel.Manifold.cube([10, 10, 10]));
  const original = extractMeshData(kernel, cube);
  const moved = extractMeshData(kernel, arena.track(cube.translate([0.1, 0, 0])));
  expect(signedMeshVolume(moved)).toBeCloseTo(signedMeshVolume(original), 3);
  expect(() => expectSameGeometry(original, moved, "moved cube")).toThrow(/surface displacement/);
  expectPartitionOccupancy(original, [original]);
  expect(() => expectPartitionOccupancy(original, [original, original])).toThrow(/occupancy/);
  const interior = extractMeshData(kernel, arena.track(arena.track(kernel.Manifold.cube([2, 2, 2])).translate([4, 4, 4])));
  expect(() => expectPartitionOccupancy(original, [original, interior])).toThrow(/occupancy/);
});

it("does not mistake removal of a zero-thickness fin for moving the occupied boundary", () => {
  const cube = extractMeshData(kernel, arena.track(kernel.Manifold.cube([10, 10, 10])));
  const start = cube.positions.length / 3;
  const withFin: MeshData = {
    positions: new Float32Array([...cube.positions, 3, 3, 10, 7, 3, 10, 5, 3, 10.5]),
    indices: new Uint32Array([...cube.indices, start, start + 1, start + 2, start + 2, start + 1, start]),
    normals: null,
  };
  expect(signedMeshVolume(withFin)).toBeCloseTo(signedMeshVolume(cube), 10);
  expectSameGeometry(withFin, cube, "regularized fin");
  expectPartitionOccupancy(withFin, [cube]);
});

it("preserves nondegenerate Float32 triangles across extreme exponent differences", () => {
  // Ordinary double subtraction loses the unit coordinates beside 1e20 and
  // gives a false zero cross product for the first face of this tetrahedron.
  const mesh: MeshData = {
    positions: new Float32Array([1e20, 1e20, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]), normals: null,
  };
  const prepared: MeshData = { ...preparePrintableMesh(mesh), normals: null };
  expect(prepared.indices.length).toBe(12);
  expectPrintableTopology(prepared);
  // The topology oracle uses exact Float32 arithmetic. Avoid a numerically
  // unstable signed-volume subtraction on this deliberately enormous fixture.
  const inputVertices = new Set(Array.from({ length: 4 }, (_, i) => Array.from(mesh.positions.subarray(i * 3, i * 3 + 3)).join(",")));
  for (const index of prepared.indices) expect(inputVertices.has(Array.from(prepared.positions.subarray(index * 3, index * 3 + 3)).join(","))).toBe(true);
});

it("uses explicit property-seam merge pairs while preserving the input arrays", () => {
  const tetra = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const faces = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
  const first = new Map<number, number>(), from: number[] = [], to: number[] = [];
  const positions = new Float32Array(faces.flatMap(vertex => tetra.slice(vertex * 3, vertex * 3 + 3)));
  faces.forEach((vertex, index) => {
    if (first.has(vertex)) { from.push(index); to.push(first.get(vertex)!); }
    else first.set(vertex, index);
  });
  const mesh = { positions, indices: new Uint32Array(faces.map((_, i) => i)), mergeFromVert: new Uint32Array(from), mergeToVert: new Uint32Array(to) };
  const snapshot = { positions: positions.slice(), indices: mesh.indices.slice(), from: mesh.mergeFromVert.slice(), to: mesh.mergeToVert.slice() };
  const prepared: MeshData = { ...preparePrintableMesh(mesh), normals: null };
  expectPrintableTopology(prepared);
  expect(signedMeshVolume(prepared)).toBeCloseTo(1 / 6, 12);
  expect(mesh.positions).toEqual(snapshot.positions);
  expect(mesh.indices).toEqual(snapshot.indices);
  expect(mesh.mergeFromVert).toEqual(snapshot.from);
  expect(mesh.mergeToVert).toEqual(snapshot.to);
});

it("resolves collinear faces even when squared edge lengths round to a tie", () => {
  const mesh: MeshData = {
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 1e-20, 0, 0]),
    indices: new Uint32Array([0, 2, 4, 4, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3, 0, 4, 1]), normals: null,
  };
  const prepared: MeshData = { ...preparePrintableMesh(mesh), normals: null };
  expectPrintableTopology(prepared);
  expect(signedMeshVolume(prepared)).toBeCloseTo(1 / 3, 12);
  expectSameGeometry(mesh, prepared, "collinear endpoint ordering");
});

it.each([
  [0, 14, 10.2, 12.8],
  [0, 2, 1e-20, 1],
  [-100, 50, -20, 0],
].map(([start, end, first, second]) => ({ start, end, first, second })))("resolves a collinear face network on $start..$end with interior points $first and $second", ({ start, end, first, second }) => {
  // Two side faces subdivide a tetrahedron edge at different existing points.
  // Two zero-area triangles bridge those subdivisions and share the outermost
  // edge. Neither can be removed by an isolated zero-to-nonzero face flip.
  const mesh: MeshData = {
    positions: new Float32Array([start, 0, 0, end, 0, 0, first, 0, 0, second, 0, 0, start, 10, 0, start, 0, 10]),
    indices: new Uint32Array([0, 4, 2, 2, 4, 1, 1, 5, 3, 3, 5, 0, 0, 5, 4, 1, 4, 5, 0, 2, 1, 1, 3, 0]), normals: null,
  };
  const prepared: MeshData = { ...preparePrintableMesh(mesh), normals: null };
  expectPrintableTopology(prepared);
  expectSameGeometry(mesh, prepared, "collinear network", 0.001, 0.01);
  expectPartitionOccupancy(mesh, [prepared]);
});
