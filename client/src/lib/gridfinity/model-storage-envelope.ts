import { modelStorageGridStep } from "@shared/gridfinity/model-pocket";
import type { Manifold } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";

type Point = [number, number, number];

/** Clip a source triangle to one raster cell, retaining exact interpolated Z.
 * Taking its minimum covers the entire cell, not just a ray through its centre. */
function clip(poly: Point[], axis: 0 | 1, bound: number, sign: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a[axis] - bound) * sign, db = (b[axis] - bound) * sign;
    if (da >= 0) out.push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      out.push(a.map((v, j) => v + t * (b[j] - v)) as Point);
    }
  }
  return out;
}

/** A conservative lower envelope in the insertion frame. Everything above it
 * is empty pocket space. Spherical opening removes narrow raised ribs without
 * raising the floor; the final dilation supplies independent fit clearance.
 * Original triangles are cell-clipped, and each mesh vertex takes the minimum
 * of adjacent cells, so interpolation cannot cut back into the source solid.
 * The source CAD remains intact. No WASM handles survive the caller's arena. */
export function modelStorageEnvelope(kernel: Kernel, source: Manifold, ceiling: number,
  smoothingMm: number, marginMm: number): Manifold {
  const bounds = source.boundingBox();
  // Bound both memory and work for large models. Normal hand tools use 0.2–0.3 mm cells.
  const width = bounds.max[0] - bounds.min[0], depth = bounds.max[1] - bounds.min[1];
  const step = modelStorageGridStep(width, depth, smoothingMm);
  const halo = Math.ceil((2 * smoothingMm + marginMm) / step) + 3;
  const nx = Math.ceil(width / step) + halo * 2, ny = Math.ceil(depth / step) + halo * 2;
  const x0 = bounds.min[0] - halo * step, y0 = bounds.min[1] - halo * step;
  let heights = new Float64Array(nx * ny).fill(ceiling);
  const mesh = source.getMesh();
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    const tri = Array.from(mesh.triVerts.subarray(t, t + 3), v =>
      Array.from(mesh.vertProperties.subarray(v * mesh.numProp, v * mesh.numProp + 3)) as Point);
    const minX = Math.max(0, Math.floor((Math.min(...tri.map(v => v[0])) - x0) / step));
    const maxX = Math.min(nx - 1, Math.floor((Math.max(...tri.map(v => v[0])) - x0) / step));
    const minY = Math.max(0, Math.floor((Math.min(...tri.map(v => v[1])) - y0) / step));
    const maxY = Math.min(ny - 1, Math.floor((Math.max(...tri.map(v => v[1])) - y0) / step));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      let polygon = clip(tri, 0, x0 + x * step, 1);
      polygon = clip(polygon, 0, x0 + (x + 1) * step, -1);
      polygon = clip(polygon, 1, y0 + y * step, 1);
      polygon = clip(polygon, 1, y0 + (y + 1) * step, -1);
      for (const point of polygon) heights[y * nx + x] = Math.min(heights[y * nx + x], point[2]);
    }
  }
  const filter = (input: Float64Array, radius: number, erode: boolean) => {
    if (radius <= 0) return input;
    const cells = Math.ceil(radius / step), offsets: { dx: number; dy: number; z: number }[] = [];
    for (let dy = -cells; dy <= cells; dy++) for (let dx = -cells; dx <= cells; dx++) {
      const d2 = (dx * dx + dy * dy) * step * step;
      if (d2 <= radius * radius) offsets.push({ dx, dy, z: Math.sqrt(radius * radius - d2) });
    }
    const out = new Float64Array(input.length);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let value = erode ? Infinity : -Infinity;
      for (const { dx, dy, z } of offsets) {
        if (x + dx < 0 || x + dx >= nx || y + dy < 0 || y + dy >= ny) continue;
        const v = input[(y + dy) * nx + x + dx] + (erode ? -z : z);
        value = erode ? Math.min(value, v) : Math.max(value, v);
      }
      out[y * nx + x] = value;
    }
    return out;
  };
  if (smoothingMm > 0) {
    const opened = filter(filter(heights, smoothingMm, true), smoothingMm, false);
    heights = heights.map((h, i) => Math.min(h, opened[i]));
  }
  // Keep empty exterior cells at the ceiling: finite sentinel heights are not solid.
  const occupied = heights.map(h => h < bounds.max[2] + 1 ? h : Infinity);
  heights = filter(occupied, marginMm, true);
  const positions: number[] = [], indices: number[] = [];
  const stride = nx + 1;
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    let z = ceiling;
    for (const dy of [-1, 0]) for (const dx of [-1, 0]) {
      if (x + dx >= 0 && x + dx < nx && y + dy >= 0 && y + dy < ny)
        z = Math.min(z, heights[(y + dy) * nx + x + dx]);
    }
    positions.push(x0 + x * step, y0 + y * step, z);
  }
  const bottomCount = positions.length / 3;
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++)
    positions.push(x0 + x * step, y0 + y * step, ceiling + 1);
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = y * stride + x, b = a + 1, c = b + stride, d = a + stride;
    quad(a, d, c, b); quad(a + bottomCount, b + bottomCount, c + bottomCount, d + bottomCount);
  }
  for (let x = 0; x < nx; x++) {
    quad(x, x + 1, x + 1 + bottomCount, x + bottomCount);
    const a = ny * stride + x; quad(a + 1, a, a + bottomCount, a + 1 + bottomCount);
  }
  for (let y = 0; y < ny; y++) {
    const a = y * stride; quad(a + stride, a, a + bottomCount, a + stride + bottomCount);
    const b = a + nx; quad(b, b + stride, b + stride + bottomCount, b + bottomCount);
  }
  const solid = kernel.arena.track(new kernel.Manifold(new kernel.Mesh({ numProp: 3,
    vertProperties: new Float32Array(positions), triVerts: new Uint32Array(indices) })));
  const result = kernel.arena.track(solid.trimByPlane([0, 0, -1], -(ceiling - 0.01)));
  if (result.status() !== "NoError" || result.isEmpty()) throw new Error("Could not build the model's storage shape.");
  const compact = kernel.arena.track(result.simplify());
  return smoothingMm > 0 ? smoothStorageBoundary(kernel, compact, step) : compact;
}

/** Remove raster stair steps at the cell scale. Expanding the
 * reduced surface restores clearance; union with the conservative envelope
 * makes containment explicit, even where simplification accumulates error.
 * A final spherical expansion rounds surviving convex corners and thin tips.
 * The final numerical-only simplification removes redundant coplanar edges. */
export function smoothStorageBoundary(kernel: Kernel, envelope: Manifold, cellMm: number): Manifold {
  const { arena, Manifold: M } = kernel;
  let reduced = envelope;
  for (let pass = 0; pass < 3; pass++) reduced = arena.track(reduced.simplify(cellMm * 1.5));
  const padding = arena.track(M.cube([3 * cellMm, 3 * cellMm, 3 * cellMm], true));
  const expanded = arena.track(reduced.minkowskiSum(padding));
  const contained = arena.track(expanded.add(envelope));
  const compact = arena.track(contained.simplify());
  const rounder = arena.track(M.sphere(Math.max(0.3, cellMm), 8));
  const rounded = arena.track(compact.minkowskiSum(rounder));
  const result = arena.track(rounded.simplify());
  if (result.status() !== "NoError") throw new Error("Could not smooth the model's storage boundary.");
  return result;
}
