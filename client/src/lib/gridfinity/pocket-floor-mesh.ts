import type { MeshData } from "@/lib/mesh/mesh-data";

export const BIN_BODY_COLOR = "#bfbfbf" as const;
export const POCKET_FLOOR_COLOR = "#000000" as const;
/** The rim starts linked visually to the pocket floor, but can be changed in View Settings. */
export const STACKING_RIM_COLOR = POCKET_FLOOR_COLOR;

/** Manifold coordinates are millimetres and normally agree to float epsilon. */
const FLOOR_Z_TOLERANCE_MM = 0.001;

/**
 * Reorders the existing mesh indices into a body group followed by a
 * pocket-floor group. Every triangle remains in the original mesh exactly
 * once: there is no raised duplicate surface, depth fighting, or body layer
 * underneath the floor material. Through pockets contribute no height, and
 * vertical/filleted faces remain in the body group.
 */
export function partitionPocketFloorTriangles(
  mesh: MeshData,
  floorZs: readonly number[],
): {
  indices: Uint32Array;
  bodyIndexCount: number;
  floorIndexCount: number;
} {
  const heights = [...new Set(floorZs.filter(Number.isFinite))];
  if (heights.length === 0) {
    return {
      indices: mesh.indices,
      bodyIndexCount: mesh.indices.length,
      floorIndexCount: 0,
    };
  }

  const bodyIndices: number[] = [];
  const floorIndices: number[] = [];

  for (let corner = 0; corner + 2 < mesh.indices.length; corner += 3) {
    const a = mesh.indices[corner] * 3;
    const b = mesh.indices[corner + 1] * 3;
    const c = mesh.indices[corner + 2] * 3;
    const az = mesh.positions[a + 2];
    const bz = mesh.positions[b + 2];
    const cz = mesh.positions[c + 2];

    const onPocketFloor = heights.some(
      (height) =>
        Math.abs(az - height) <= FLOOR_Z_TOLERANCE_MM &&
        Math.abs(bz - height) <= FLOOR_Z_TOLERANCE_MM &&
        Math.abs(cz - height) <= FLOOR_Z_TOLERANCE_MM,
    );
    // The z component of (B - A) x (C - A) identifies upward winding without
    // trusting smoothed vertex normals from the render mesh.
    const upward =
      (mesh.positions[b] - mesh.positions[a]) *
        (mesh.positions[c + 1] - mesh.positions[a + 1]) -
        (mesh.positions[b + 1] - mesh.positions[a + 1]) *
          (mesh.positions[c] - mesh.positions[a]) >
      0;
    const destination = onPocketFloor && upward ? floorIndices : bodyIndices;
    destination.push(
      mesh.indices[corner],
      mesh.indices[corner + 1],
      mesh.indices[corner + 2],
    );
  }

  return {
    indices:
      floorIndices.length === 0
        ? mesh.indices
        : new Uint32Array([...bodyIndices, ...floorIndices]),
    bodyIndexCount:
      floorIndices.length === 0 ? mesh.indices.length : bodyIndices.length,
    floorIndexCount: floorIndices.length,
  };
}
