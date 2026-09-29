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

/** Rebuild in the precision used by STL/3MF before extracting printable faces.
 * CSG can leave distinct double-precision vertices at identical Float32
 * positions. The resulting zero-area faces survive ordinary index-only
 * topology checks. A 0.1 micrometre simplification removes those seams while
 * preserving dimensions far below the application's modelling resolution. */
export function preparePrintableSolid(kernel: Kernel, solid: Manifold): Manifold {
  if (solid.isEmpty()) return solid;
  let current = solid;
  // Simplification can itself create a face that collapses on the next Float32
  // round trip. Retry only when the actual serialized coordinates need it.
  for (let pass = 0; pass < 6; pass++) {
    const raw = current.getMesh();
    // If ordinary cleanup stalls, recompute coplanar faces at serialized
    // precision. Stale CSG face/run provenance (not used by STL/3MF) can pin
    // collinear triangles in place through every simplification pass. Keep
    // the established path first, since retriangulation can add new seams.
    const floatMesh = pass < 3 ? raw : new kernel.Mesh({
      numProp: raw.numProp, vertProperties: raw.vertProperties, triVerts: raw.triVerts,
      mergeFromVert: raw.mergeFromVert, mergeToVert: raw.mergeToVert,
      tolerance: raw.tolerance,
    });
    floatMesh.merge();
    const rebuilt = kernel.arena.track(new kernel.Manifold(floatMesh));
    const printable = kernel.arena.track(rebuilt.simplify(0.0001));
    if (printable.status() !== "NoError") throw new Error("Could not prepare printable mesh topology.");
    const mesh = printable.getMesh();
    let collapsed = false;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => mesh.triVerts[i + k] * mesh.numProp);
      const p = mesh.vertProperties;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) === 0) {
        collapsed = true;
        break;
      }
    }
    if (!collapsed) return printable;
    current = printable;
  }
  // Preserve established behavior for kernel-valid collinear seams that survive
  // bounded cleanup; rebuilding provenance fixes the long-bin export case.
  return current;
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
