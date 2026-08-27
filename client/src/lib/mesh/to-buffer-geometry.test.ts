import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { extractMeshData } from "./mesh-data";
import { toBufferGeometry } from "./to-buffer-geometry";

let arena: Arena;
let kernel: Kernel;

beforeAll(async () => {
  const wasm = await loadManifold();
  arena = new Arena();
  kernel = createKernel(wasm, arena);
});

afterAll(() => {
  arena.dispose();
});

describe("toBufferGeometry", () => {
  it("wraps positions, normals and indices without copying", () => {
    const cube = arena.track(kernel.Manifold.cube([2, 3, 4], true));
    const mesh = extractMeshData(kernel, cube, { normals: true });
    const geometry = toBufferGeometry(mesh);

    expect(geometry.getAttribute("position").array).toBe(mesh.positions);
    expect(geometry.getAttribute("normal").array).toBe(mesh.normals);
    expect(geometry.getIndex()!.array).toBe(mesh.indices);
    expect(geometry.getIndex()!.count).toBe(mesh.indices.length);
  });

  it("computes bounds matching the solid", () => {
    const cube = arena.track(kernel.Manifold.cube([2, 3, 4], true));
    const geometry = toBufferGeometry(extractMeshData(kernel, cube));

    const box = geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(-1, 6);
    expect(box.max.y).toBeCloseTo(1.5, 6);
    expect(box.max.z).toBeCloseTo(2, 6);
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
  });

  it("omits the normal attribute when the mesh has none", () => {
    const cube = arena.track(kernel.Manifold.cube([1, 1, 1], true));
    const geometry = toBufferGeometry(extractMeshData(kernel, cube));
    expect(geometry.getAttribute("normal")).toBeUndefined();
  });
});
