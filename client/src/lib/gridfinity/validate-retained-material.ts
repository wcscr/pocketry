import type { Manifold } from "manifold-3d";
import { pocketName, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import type { ValidationIssue } from "@shared/gridfinity/validate";
import type { Kernel } from "@/lib/manifold/runtime";

const VOLUME_TOLERANCE_MM3 = 1e-5;

/** A hole can add a loose island to a through cut or a floating cap to a blind
 * pocket. Check the finished solid, so walls, floors, overlapping masks, splits,
 * and tilted volumes can provide real connections without depth heuristics.
 * Only wholly retained components are new islands: existing disconnected parts
 * outside the masks remain the responsibility of the ordinary pocket checks.
 */
export function validateRetainedMaterial(
  kernel: Kernel,
  solid: Manifold,
  groups: readonly { id: string; volumes: Manifold[] }[],
  cutouts: readonly CutoutPlacement[],
  shapes: ReadonlyMap<string, TracedShape>,
): ValidationIssue[] {
  const volumes = groups.flatMap(group => group.volumes);
  if (!volumes.length || solid.isEmpty()) return [];
  const { arena, Manifold: M } = kernel;
  const components = solid.decompose().map(part => arena.track(part));
  if (components.length < 2) return [];
  const masks = groups.filter(group => group.volumes.length > 0)
    .map(group => ({ id: group.id, solid: arena.track(M.union(group.volumes)) }));
  const mask = arena.track(M.union(volumes));
  const loose = components.filter(part => {
    const outside = arena.track(part.subtract(mask));
    if (outside.status() !== "NoError") throw new Error("Could not check retained material connections.");
    return part.volume() > VOLUME_TOLERANCE_MM3 && outside.volume() <= VOLUME_TOLERANCE_MM3;
  });
  return masks.flatMap(group => {
    const contributes = loose.some(part => {
      const common = arena.track(part.intersect(group.solid));
      if (common.status() !== "NoError") throw new Error("Could not check retained material connections.");
      return common.volume() > VOLUME_TOLERANCE_MM3;
    });
    if (!contributes) return [];
    const cutout = cutouts.find(item => item.id === group.id);
    const name = cutout ? pocketName(cutout, shapes.get(cutout.shapeId)) : "Hole";
    return [{ code: "disconnected-retained-material", severity: "error" as const, cutoutIds: [group.id],
      message: `“${name}” keeps material that is disconnected from the bin. Extend it to a pocket floor or wall, or use a blind pocket instead of a through cut.` }];
  });
}
