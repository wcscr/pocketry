import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import { polygonsToOutline } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";
import { buildRigidPocket } from "./cutouts";

/** Both outlines are derived from the generated solid, including split seats,
 * clearance and rounding. A future imported model supplies the same solid. */
export function resolvedPocketFootprints(kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement, spec: BinSpec) {
  const { arena, Manifold } = kernel;
  const built = buildRigidPocket(kernel, shape, cutout, spec, { circularSegments: 64, cutoutVertexBudget: 600 });
  if (!built.cutters.length) return { full: [], opening: [] };
  const solid = arena.track(Manifold.union(built.cutters));
  const top = resolvePocketDepth(spec, cutout.depth).infillTopZ;
  // Slice from the material side so a coplanar upper cap still has an opening.
  const opening = solid.boundingBox().min[2] >= top - 1e-8 ? []
    : polygonsToOutline(arena.track(solid.slice(top - 1e-7)).toPolygons());
  return { full: polygonsToOutline(arena.track(solid.project()).toPolygons()), opening };
}
