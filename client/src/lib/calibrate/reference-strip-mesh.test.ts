import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { withKernel, loadManifold } from "@/lib/manifold/runtime";
import type { ThreeMfMesh } from "@/lib/mesh/threemf";
import { runAutoCalibration } from "./auto-calibrate";
import { referenceStripMeshes, referenceStripThreeMf } from "./reference-strip-mesh";

/** Closed, consistently wound indexed surfaces; no reliance on a slicer's repair. */
function volumeAndCheckTopology(mesh: ThreeMfMesh): number {
  const edges = new Map<string, { count: number; direction: number }>();
  let volume = 0;
  const point = (id: number) => Array.from(mesh.positions.slice(id * 3, id * 3 + 3));
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const ids = Array.from(mesh.indices.slice(offset, offset + 3));
    const [a, b, c] = ids.map(point);
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (let i = 0; i < 3; i++) {
      const from = ids[i], to = ids[(i + 1) % 3];
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      const entry = edges.get(key) ?? { count: 0, direction: 0 };
      entry.count++; entry.direction += from < to ? 1 : -1;
      edges.set(key, entry);
    }
  }
  for (const edge of edges.values()) expect(edge).toEqual({ count: 2, direction: 0 });
  expect(volume).toBeGreaterThan(0);
  return volume;
}

describe("printable reference strip 3MF", () => {
  it("exports two closed, seated parts, exactly 100 x 20 x 1.2 mm with no volume overlap", async () => {
    const wasm = await loadManifold();
    await withKernel((kernel) => {
      const parts = referenceStripMeshes(kernel);
      expect(parts).toHaveLength(2);
      const volumes = parts.map(({ mesh }) => volumeAndCheckTopology(mesh));
      expect(volumes[0] + volumes[1]).toBeCloseTo(100 * 20 * 1.2, 3);
      const meshes = parts.map(({ mesh }) => {
        const solid = kernel.arena.track(new kernel.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) })));
        return solid;
      });
      const overlap = kernel.arena.track(meshes[0].intersect(meshes[1]));
      expect(overlap.volume()).toBeCloseTo(0, 6);
      const combined = kernel.arena.track(meshes[0].add(meshes[1]));
      const bounds = combined.boundingBox();
      expect(bounds.min).toEqual([0, 0, 0]);
      expect(bounds.max[0]).toBe(100); expect(bounds.max[1]).toBe(20);
      expect(bounds.max[2]).toBeCloseTo(1.2, 6);
      const zip = unzipSync(referenceStripThreeMf(kernel));
      const model = strFromU8(zip["3D/3dmodel.model"]);
      expect(model).toContain('unit="millimeter"');
      expect(model.match(/<item /g)).toHaveLength(1);
      expect(model.match(/<component /g)).toHaveLength(2);
      expect(model).toContain('#FFFFFFFF'); expect(model).toContain('#000000FF');
      const settings = strFromU8(zip["Metadata/model_settings.config"]);
      expect(settings).toContain('key="extruder" value="1"');
      expect(settings).toContain('key="extruder" value="2"');
    });
  });

  it("recognizes an independent top-view raster of the exported black triangles", async () => {
    const parts = await withKernel(referenceStripMeshes);
    const { positions, indices } = parts[1].mesh;
    const width = 560, height = 180, scale = 4, pad = 50;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let offset = 0; offset < indices.length; offset += 3) {
      const vertices = Array.from(indices.slice(offset, offset + 3)).map((index) => ({
        x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2],
      }));
      if (!vertices.every(({ z }) => Math.abs(z - 1.2) < 1e-5)) continue;
      const [a, b, c] = vertices.map(({ x, y }) => ({ x: pad + x * scale, y: pad + (20 - y) * scale }));
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
    const cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js");
    const result = runAutoCalibration(cv, { data, width, height, colorSpace: "srgb" } as ImageData);
    expect(result.kind).toBe("calibrated-strip");
    if (result.kind === "calibrated-strip") expect(result.solution.mmPerPx).toBeCloseTo(.25, 3);
  });
});
