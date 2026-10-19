import type { Manifold } from "manifold-3d";
import { pocketName, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import type { ValidationIssue } from "@shared/gridfinity/validate";
import type { Kernel } from "@/lib/manifold/runtime";

// The continuous sweep uses Float32 facets. Ignore sub-print-resolution
// Boolean residue at touching faces, but not a measurable blocking volume.
const COLLISION_VOLUME_MM3 = 0.01;

export interface PocketInsertionPath {
  id: string;
  volumes: Manifold[];
  /** Parts of the sweep excluded from the cut by floor limits or kept material. */
  excluded: Manifold[];
}

/** Check the continuous insertion sweep against material that actually remains
 * in the bin, after all pockets and finger access cuts. A full XY projection
 * wrongly requires an opening below parts that never enter the bin.
 */
export function validateInsertionPaths(
  kernel: Kernel,
  solid: Manifold,
  paths: readonly PocketInsertionPath[],
  cutouts: readonly CutoutPlacement[],
  shapes: ReadonlyMap<string, TracedShape>,
  additions: readonly Manifold[] = [],
): ValidationIssue[] {
  if (solid.isEmpty()) return [];
  const intersects = (a: Manifold, b: Manifold) => {
    const common = kernel.arena.track(a.intersect(b));
    if (common.status() !== "NoError") throw new Error("Could not check the pocket's insertion path.");
    return common.volume() > COLLISION_VOLUME_MM3;
  };
  return paths.flatMap(path => {
    // The rest of the sweep was subtracted from the bin by construction.
    // Testing those coincident faces again is expensive for photo traces.
    // Other pockets may remove an excluded region, so use the finished solid.
    const blocked = path.excluded.some(volume => intersects(volume, solid))
      || additions.some(addition => path.volumes.some(volume => intersects(volume, addition)));
    if (!blocked) return [];
    const cutout = cutouts.find(item => item.id === path.id);
    const name = cutout ? pocketName(cutout, shapes.get(cutout.shapeId)) : "Pocket";
    return [{ code: "pocket-insertion-collision", severity: "error" as const, cutoutIds: [path.id],
      message: `“${name}”: Bin material blocks the vertical insertion path or the object's seated position. Raise the pocket, reduce the remaining floor thickness, or move the obstructing material out of the path.` }];
  });
}
