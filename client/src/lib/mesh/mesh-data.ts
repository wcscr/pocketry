// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import type { Kernel } from "@/lib/manifold/runtime";

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
  return {
    positions: copyChannel(mesh, 0, 3),
    normals: copyChannel(mesh, 3, 3),
    indices: new Uint32Array(mesh.triVerts),
  };
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
