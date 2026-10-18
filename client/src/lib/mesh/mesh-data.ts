// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import type { Kernel } from "@/lib/manifold/runtime";
import { preparePrintableMesh } from "./printable-mesh";

/**
 * Extraction of renderable/exportable mesh data from a manifold solid — the
 * seam between the geometry kernel and everything downstream (three.js
 * BufferGeometry in the preview, the 3MF and STL writers).
 *
 * The typed arrays are **copies**, deliberately detached from the WASM heap:
 * a `MeshData` stays valid after the kernel's arena is disposed, and can be
 * posted from the worker as transferables.
 */

export interface MeshData {
  /** `xyz` triples. */
  positions: Float32Array;
  /** Unit vertex normals, `xyz` triples parallel to `positions`; null when not requested. */
  normals: Float32Array | null;
  /** Triangle corners indexing into `positions`. */
  indices: Uint32Array;
}

export interface MeshDataOptions {
  /**
   * Compute vertex normals into the mesh. Edges sharper than `sharpAngleDeg`
   * stay creased (vertices are duplicated per side by manifold), so the base
   * profile's 45° transitions render crisp instead of being smoothed to mush —
   * which is also why the preview must NOT recompute normals with three.js's
   * `computeVertexNormals()`.
   */
  normals?: boolean;
  /** Crease threshold in degrees. Default 60: 45° chamfer edges stay sharp. */
  sharpAngleDeg?: number;
}

/**
 * The one-way boundary from native solids to printable Float32 geometry.
 * Keep all CSG and material partitioning in the kernel before this call:
 * rebuilding a rounded mesh in Manifold can change its occupied volume.
 * Only explicit kernel merge pairs identify property seams; coincident
 * coordinates alone do not make two vertices topologically identical.
 */
export function extractPrintableMeshData(_kernel: Kernel, solid: Manifold): MeshData {
  const mesh = solid.getMesh();
  return {
    ...preparePrintableMesh({
      positions: copyChannel(mesh, 0, 3),
      indices: new Uint32Array(mesh.triVerts),
      mergeFromVert: mesh.mergeFromVert,
      mergeToVert: mesh.mergeToVert,
    }),
    normals: null,
  };
}

/**
 * Copies a solid's mesh out of the WASM heap.
 *
 * With `normals`, the solid is run through `calculateNormals(0, sharpAngle)`
 * first — channel 0 is the current API's "standard slot" (non-zero indices
 * are deprecated in manifold ≥ 3.x; the plan's `calculateNormals(3, 60)`
 * predates that) — and `getMesh()` then interleaves positions with normals.
 */
export function extractMeshData(
  kernel: Kernel,
  solid: Manifold,
  options: MeshDataOptions = {},
): MeshData {
  const { arena } = kernel;
  const wantNormals = options.normals ?? false;
  const sharpAngleDeg = options.sharpAngleDeg ?? 60;

  // A section plane can remove the entire solid. Manifold does not attach
  // normal properties to an empty mesh; return a valid empty view explicitly.
  if (solid.isEmpty()) {
    return {
      positions: new Float32Array(),
      normals: wantNormals ? new Float32Array() : null,
      indices: new Uint32Array(),
    };
  }

  if (!wantNormals) {
    const mesh = solid.getMesh();
    return {
      positions: copyChannel(mesh, 0, 3),
      normals: null,
      indices: new Uint32Array(mesh.triVerts),
    };
  }

  const withNormals = arena.track(solid.calculateNormals(0, sharpAngleDeg));
  const mesh = withNormals.getMesh();
  if (mesh.numProp < 6) {
    // calculateNormals is documented to expand the property set; if it did
    // not, silently returning null normals would ship a matte-shaded preview.
    throw new Error(
      `extractMeshData: expected ≥ 6 properties after calculateNormals, got ${mesh.numProp}`,
    );
  }
  const positions = copyChannel(mesh, 0, 3);
  const normals = copyChannel(mesh, 3, 3);
  const indices = new Uint32Array(mesh.triVerts);
  weightPreviewNormals(positions, normals, indices, mesh.mergeFromVert, mesh.mergeToVert);
  return { positions, normals, indices };
}

/**
 * Respect the kernel's crease groups, but weight their normals by face area.
 * Microscopic CSG seam triangles must not bend the shading of a broad planar
 * floor. Explicit merge pairs preserve topology across property seams; equal
 * coordinates alone are deliberately insufficient to join separate surfaces.
 * This changes only preview normals, never positions or printable geometry.
 */
function weightPreviewNormals(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  mergeFrom: Uint32Array,
  mergeTo: Uint32Array,
): void {
  const count = positions.length / 3;
  const parent = Uint32Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < mergeFrom.length; i++) parent[root(mergeFrom[i])] = root(mergeTo[i]);
  const groups = new Map<string, number>();
  const group = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    const key = `${root(i)}:${normals[j]},${normals[j + 1]},${normals[j + 2]}`;
    let id = groups.get(key);
    if (id === undefined) { id = groups.size; groups.set(key, id); }
    group[i] = id;
  }
  const sums = new Float64Array(groups.size * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (let corner = 0; corner < 3; corner++) {
      const j = group[indices[i + corner]] * 3;
      sums[j] += nx; sums[j + 1] += ny; sums[j + 2] += nz;
    }
  }
  for (let i = 0; i < count; i++) {
    const j = group[i] * 3, length = Math.hypot(sums[j], sums[j + 1], sums[j + 2]);
    if (length > 0 && Number.isFinite(length)) {
      for (let axis = 0; axis < 3; axis++) normals[i * 3 + axis] = sums[j + axis] / length;
    }
  }
}

/** De-interleaves `count` floats per vertex starting at `first`. */
function copyChannel(
  mesh: { numProp: number; vertProperties: Float32Array },
  first: number,
  count: number,
): Float32Array {
  const { numProp, vertProperties } = mesh;
  if (numProp === count && first === 0) {
    return new Float32Array(vertProperties);
  }
  const vertexCount = Math.floor(vertProperties.length / numProp);
  const out = new Float32Array(vertexCount * count);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const source = vertex * numProp + first;
    for (let channel = 0; channel < count; channel++) {
      out[vertex * count + channel] = vertProperties[source + channel];
    }
  }
  return out;
}
