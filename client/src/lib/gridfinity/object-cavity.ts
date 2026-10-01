import type { Manifold } from "manifold-3d";
import type { ObjectPose } from "@shared/gridfinity/object-pose";
import type { Kernel } from "@/lib/manifold/runtime";

/** Pose a finite source solid without extending it to the fill surface. Generated
 * profile extrusions and prepared model cutters use this same rigid transform.
 * The source stays in its authored frame until rotation; only then is the
 * lowest point anchored to the requested elevation. An optional anchor keeps
 * attachments, such as a floor band, in the source object's placement frame. */
export function buildObjectCavity(kernel: Kernel, source: Manifold, pose: ObjectPose,
  top: number, anchor: Manifold = source,
): Manifold | null {
  const { arena } = kernel;
  if (source.isEmpty()) return null;
  const rotated = arena.track(source.rotate([pose.rotation.xDeg % 360, pose.rotation.yDeg % 360, pose.rotation.zDeg % 360]));
  const rotatedAnchor = anchor === source ? rotated : arena.track(anchor.rotate([pose.rotation.xDeg % 360, pose.rotation.yDeg % 360, pose.rotation.zDeg % 360]));
  const solid = arena.track(rotated.translate([pose.position.x, pose.position.y,
    pose.elevationMm - rotatedAnchor.boundingBox().min[2]]));
  if (solid.boundingBox().min[2] >= top - 1e-8) return null;
  const clipped = Number.isFinite(top) ? arena.track(solid.trimByPlane([0, 0, -1], -top)) : solid;
  if (clipped.status() !== "NoError") throw new Error("Could not build the rotated object pocket.");
  return clipped;
}
