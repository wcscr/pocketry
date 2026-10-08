import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import type { Kernel } from "@/lib/manifold/runtime";
import { buildRigidPocket } from "./cutouts";
import { resolvedObjectGeometry } from "./object-geometry";

/** All inspection views come from the cutter solid, including split seats,
 * clearance and rounding. No separate extrusion model is used for rendering. */
export function resolvedPocketGeometry(kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement, spec: BinSpec) {
  const { arena, Manifold } = kernel;
  const built = buildRigidPocket(kernel, shape, cutout, spec, { circularSegments: 64, cutoutVertexBudget: 600 });
  const solid = arena.track(Manifold.union(built.cutters));
  const top = resolvePocketDepth(spec, cutout.depth).infillTopZ;
  return resolvedObjectGeometry(kernel, solid, top);
}
