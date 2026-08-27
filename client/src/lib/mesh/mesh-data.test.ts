import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { extractMeshData } from "./mesh-data";

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

describe("extractMeshData", () => {
  it("copies positions and indices for a plain mesh", () => {
    const cube = arena.track(kernel.Manifold.cube([2, 3, 4], false));
    const mesh = extractMeshData(kernel, cube);

    expect(mesh.normals).toBeNull();
    expect(mesh.positions.length).toBe(8 * 3);
    expect(mesh.indices.length).toBe(12 * 3);

    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      maxX = Math.max(maxX, mesh.positions[i]);
      maxZ = Math.max(maxZ, mesh.positions[i + 2]);
    }
    expect(maxX).toBeCloseTo(2, 6);
    expect(maxZ).toBeCloseTo(4, 6);
  });

  it("computes creased unit normals that agree with facet orientation", () => {
    const cube = arena.track(kernel.Manifold.cube([2, 2, 2], true));
    const mesh = extractMeshData(kernel, cube, { normals: true });

    expect(mesh.normals).not.toBeNull();
    const normals = mesh.normals!;
    // 90° edges crease at the 60° threshold: vertices duplicate per face.
    expect(mesh.positions.length).toBeGreaterThan(8 * 3);
    expect(normals.length).toBe(mesh.positions.length);

    for (let v = 0; v < normals.length; v += 3) {
      const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
      expect(length).toBeCloseTo(1, 5);
    }

    // Each vertex normal must point with its facet, and on a creased cube
    // must *equal* the facet normal.
    const { positions, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const vz = positions[c + 2] - positions[a + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      for (const corner of [a, b, c]) {
        const dot = nx * normals[corner] + ny * normals[corner + 1] + nz * normals[corner + 2];
        expect(dot).toBeGreaterThan(0.999);
      }
    }
  });

  it("keeps smooth surfaces smooth: sphere normals are radial", () => {
    const sphere = arena.track(kernel.Manifold.sphere(5, 32));
    const mesh = extractMeshData(kernel, sphere, { normals: true });
    const { positions } = mesh;
    const normals = mesh.normals!;

    for (let v = 0; v < positions.length; v += 3) {
      const radius = Math.hypot(positions[v], positions[v + 1], positions[v + 2]);
      const dot =
        (positions[v] / radius) * normals[v] +
        (positions[v + 1] / radius) * normals[v + 1] +
        (positions[v + 2] / radius) * normals[v + 2];
      expect(dot).toBeGreaterThan(0.99);
    }
  });
});
