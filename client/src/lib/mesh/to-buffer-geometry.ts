import { BufferAttribute, BufferGeometry } from "three";

import type { MeshData } from "./mesh-data";

/**
 * Wraps a {@link MeshData} in a three.js `BufferGeometry` without copying:
 * the typed arrays become the attribute storage directly.
 *
 * Deliberately **never** calls `computeVertexNormals()`. The mesh's normals
 * come from manifold's `calculateNormals` with a 60° crease threshold, which
 * keeps the base profile's 45° transitions crisp; three's recomputation would
 * average across those edges and smooth the Gridfinity silhouette into mush
 * (the plan calls this out explicitly). A mesh without normals gets flat
 * shading from the material instead.
 */
export function toBufferGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  if (mesh.normals) {
    geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  }
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  // Precompute bounds so the first frame does not hitch on demand.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
