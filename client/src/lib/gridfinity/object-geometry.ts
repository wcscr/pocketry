import type { Manifold } from "manifold-3d";
import type { Outline } from "@shared/geometry/types";
import { polygonsToOutline } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";
import { extractMeshData, type MeshData } from "@/lib/mesh/mesh-data";

/** Disposable-kernel-independent views of one posed solid. Generated extrusions
 * and imported solids use the same projection, section and preview path. */
export interface ObjectGeometry {
  full: Outline;
  opening: Outline;
  mesh: MeshData;
}

export function resolvedObjectGeometry(kernel: Kernel, solid: Manifold, top: number): ObjectGeometry {
  const { arena } = kernel;
  // Slice from the material side so a coplanar upper cap still has an opening.
  const opening = solid.isEmpty() || solid.boundingBox().min[2] >= top - 1e-8 ? []
    : polygonsToOutline(arena.track(solid.slice(top - 1e-7)).toPolygons());
  return {
    full: polygonsToOutline(arena.track(solid.project()).toPolygons()),
    opening,
    mesh: extractMeshData(kernel, solid),
  };
}
