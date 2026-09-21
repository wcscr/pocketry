import type { Manifold } from "manifold-3d";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { pocketName, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
import { D_DIV } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import type { ValidationIssue } from "@shared/gridfinity/validate";
import type { Kernel } from "@/lib/manifold/runtime";

/** Exact cavity checks include hidden intersections and the shaft's path
 * through the wall, label tab and lip. Extension outside the bin is ignored. */
export function validateTiltedSolids(kernel: Kernel, spec: BinSpec,
  cutouts: readonly CutoutPlacement[], shapes: ReadonlyMap<string, TracedShape>,
  groups: readonly { id: string; cutters: Manifold[] }[],
  wall: Manifold | null, lip: Manifold | null,
): ValidationIssue[] {
  if (!cutouts.some(hasPocketTilt)) return [];
  const { arena, Manifold: M } = kernel;
  const top = resolvePocketDepth(spec, { mode: "through" }).cutterTopZ - 1;
  const clipped = groups.flatMap(group => {
    const cutout = cutouts.find(c => c.id === group.id);
    if (!cutout || group.cutters.length === 0) return [];
    let solid = arena.track(M.union(group.cutters));
    solid = arena.track(solid.trimByPlane([0, 0, 1], 0));
    solid = arena.track(solid.trimByPlane([0, 0, -1], -top));
    return [{ cutout, solid, label: pocketName(cutout, shapes.get(cutout.shapeId)) }];
  });
  const issues: ValidationIssue[] = [];
  const overlaps = (a: Manifold, b: Manifold): boolean => {
    const intersection = arena.track(a.intersect(b));
    if (intersection.status() !== "NoError") throw new Error("Could not validate tilted pocket intersections.");
    return intersection.volume() > 1e-5;
  };
  for (const [i, item] of clipped.entries()) {
    if (hasPocketTilt(item.cutout)) {
      const boundaries = [wall, lip].filter((solid): solid is Manifold => solid !== null && !solid.isEmpty());
      if (boundaries.some(boundary => overlaps(item.solid, boundary))) {
        issues.push({ code: "tilted-pocket-wall", severity: "error", cutoutIds: [item.cutout.id],
          message: `“${item.label}”: The tilted pocket cuts into a wall, label tab, or stacking rim. Move it inward, reduce tilt, or enlarge the bin.` });
      } else if (boundaries.some(boundary => item.solid.minGap(boundary, D_DIV) < D_DIV - 1e-5)) {
        issues.push({ code: "tilted-pocket-thin-material", severity: "warning", cutoutIds: [item.cutout.id],
          message: `“${item.label}”: The tilted shaft leaves less than ${D_DIV} mm of material beside a wall, label tab, or stacking rim.` });
      }
    }
    for (const other of clipped.slice(i + 1)) {
      if (!hasPocketTilt(item.cutout) && !hasPocketTilt(other.cutout)) continue;
      if (overlaps(item.solid, other.solid)) issues.push({ code: "tilted-pocket-overlap", severity: "error",
        cutoutIds: [item.cutout.id, other.cutout.id], message: `“${item.label}” and “${other.label}” intersect in 3D. Move their shafts farther apart.` });
      else if (item.solid.minGap(other.solid, D_DIV) < D_DIV - 1e-5) issues.push({ code: "tilted-pocket-thin-material", severity: "warning",
        cutoutIds: [item.cutout.id, other.cutout.id], message: `“${item.label}” and “${other.label}” leave less than ${D_DIV} mm of material between their shafts.` });
    }
  }
  return issues;
}
