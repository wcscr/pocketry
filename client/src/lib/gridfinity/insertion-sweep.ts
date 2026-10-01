import type { Manifold, Vec3 } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";

/** Numerical overlap for a nondegenerate sweep, in mm (0.1 micrometre).
 * It only enlarges the cavity horizontally; this is not the user's fit clearance. */
export const INSERTION_SWEEP_EPSILON_MM = 0.0001;

/** Continuous Minkowski sweep along an insertion axis toward the bin opening.
 * The swept segment is given a sub-micron horizontal thickness so the kernel
 * receives a proper solid instead of a degenerate line. This is conservative:
 * it includes every translated copy of the source, preserves a shaped seat and
 * concave outline, and clears enclosed voids and insertion-blocking overhangs.
 * No sampled positions, whole-object convex hull, or source decimation is used.
 */
export function sweepSolidAlongAxis(kernel: Kernel, source: Manifold, axis: Vec3, ceiling: number, clearance?: Manifold, numericalDirections?: Vec3[]): Manifold {
  if (source.isEmpty()) return source;
  const bounds = source.boundingBox();
  if (!axis.every(Number.isFinite) || axis[2] < 0.01 || !Number.isFinite(ceiling) || ceiling <= bounds.max[2]) {
    throw new Error("The insertion path must extend above the complete model.");
  }
  const { arena, Manifold: M } = kernel;
  const travel = (ceiling - bounds.min[2] - (clearance?.boundingBox().min[2] ?? 0)) / axis[2];
  const epsilon = Math.max(INSERTION_SWEEP_EPSILON_MM, source.tolerance() * 2);
  const padding = clearance?.getMesh();
  const offsets: Vec3[] = padding ? Array.from({length:padding.numVert}, (_,i) =>
    [padding.vertProperties[i * padding.numProp], padding.vertProperties[i * padding.numProp + 1], padding.vertProperties[i * padding.numProp + 2]]) : [[0,0,0]];
  // Minkowski sums associate: combine the convex fit-clearance box and path
  // first, so even detailed models need only one expensive solid dilation.
  const directions: Vec3[] = numericalDirections ?? [[-1,-1,0],[-1,1,0],[1,-1,0],[1,1,0]];
  const corners: Vec3[] = offsets.flatMap(offset => [0, travel].flatMap(t =>
    directions.map(d => [offset[0] + epsilon * d[0] + axis[0] * t,
      offset[1] + epsilon * d[1] + axis[1] * t, offset[2] + epsilon * d[2] + axis[2] * t] as Vec3)));
  const path = arena.track(M.hull(corners));
  const swept = arena.track(source.minkowskiSum(path));
  const clipped = arena.track(swept.trimByPlane([0, 0, -1], -ceiling));
  if (clipped.status() !== "NoError" || clipped.isEmpty()) {
    throw new Error("Could not clear the model's insertion path. Repair or simplify the STL and try again.");
  }
  return clipped;
}
