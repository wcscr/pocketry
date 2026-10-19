// Shared fixtures and lifecycle hooks for the matching test suites.
import { createRequire } from "node:module";
import { beforeAll, expect } from "vitest";
import type { ThreeMfMesh } from "@/lib/mesh/threemf";

// The shipped OpenCV ArUco API is untyped.
let cv: any;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);

/** Render the actual exported top triangles, independently of the print artwork. */
function photograph(mesh: ThreeMfMesh, length: number, scale: number): ImageData {
  const pad = 50, width = length * scale + 2 * pad, height = 15 * scale + 2 * pad;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = Array.from(mesh.indices.slice(offset, offset + 3)).map((index) => ({
      x: mesh.positions[index * 3], y: mesh.positions[index * 3 + 1], z: mesh.positions[index * 3 + 2],
    }));
    if (!vertices.every(({ z }) => Math.abs(z - 2) < 1e-5)) continue;
    const [a, b, c] = vertices.map(({ x, y }) => ({ x: pad + x * scale, y: pad + (15 - y) * scale }));
    const cross = (p: typeof a, q: typeof a, x: number, y: number) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    for (let row = Math.floor(Math.min(a.y, b.y, c.y)); row < Math.ceil(Math.max(a.y, b.y, c.y)); row++) {
      for (let col = Math.floor(Math.min(a.x, b.x, c.x)); col < Math.ceil(Math.max(a.x, b.x, c.x)); col++) {
        const signs = [cross(a, b, col + .5, row + .5), cross(b, c, col + .5, row + .5), cross(c, a, col + .5, row + .5)];
        if (signs.every((v) => v <= 0) || signs.every((v) => v >= 0)) {
          const at = (row * width + col) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function expectClosed(mesh: ThreeMfMesh): void {
  const edges = new Map<string, { count: number; winding: number }>();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    for (let i = 0; i < 3; i++) {
      const a = mesh.indices[offset + i], b = mesh.indices[offset + (i + 1) % 3];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++; edge.winding += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  expect([...edges.values()].every(({ count, winding }) => count === 2 && winding === 0)).toBe(true);
}

export { cv, photograph, expectClosed };
