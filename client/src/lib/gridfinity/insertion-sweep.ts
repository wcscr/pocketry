import type { Manifold, Vec3 } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";

/** Continuous segment sweep of the complete pocket. Each exiting surface
 * triangle sweeps a convex prism; their union with the original solid retains
 * its seated floor, concavities and holes, while clearing blocking overhangs.
 * No sampled poses or whole-object hull are used. Sweeping facets avoids the
 * general Minkowski kernel's expensive treatment of rounded split silhouettes. */
export function sweepSolidAlongAxis(kernel: Kernel, source: Manifold, axis: Vec3, ceiling: number): Manifold {
  if (source.isEmpty()) return source;
  const bounds = source.boundingBox();
  if (!axis.every(Number.isFinite) || axis[2] < 0.01 || !Number.isFinite(ceiling) || ceiling <= bounds.max[2]) {
    throw new Error("The insertion path must extend above the complete pocket.");
  }
  const { arena, Manifold: M } = kernel;
  // getMesh exposes Float32 vertices. Treat their sub-micron seams as kernel
  // tolerance before joining prisms to the original double-precision solid.
  const tolerance = Math.max(source.tolerance(), 0.0001);
  const travel = (ceiling - bounds.min[2]) / axis[2];
  const mesh = source.getMesh();
  const vertex = (index: number): Vec3 => [mesh.vertProperties[index * mesh.numProp],
    mesh.vertProperties[index * mesh.numProp + 1], mesh.vertProperties[index * mesh.numProp + 2]];
  const prisms: Manifold[] = [arena.track(source.setTolerance(tolerance))];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const points = [vertex(mesh.triVerts[i]), vertex(mesh.triVerts[i+1]), vertex(mesh.triVerts[i+2])];
    const [a,b,c] = points;
    const u = b.map((n,j) => n-a[j]), v = c.map((n,j) => n-a[j]);
    const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    // Only outward faces in the travel direction bound new swept volume.
    if (normal.reduce((sum,n,j) => sum+n*axis[j], 0) <= 1e-10) continue;
    const exit = points.map(p => p.map((n,j) => n+axis[j]*travel) as Vec3);
    const hull = arena.track(M.hull([...points, ...exit]));
    const prism = arena.track(hull.setTolerance(tolerance));
    if (!prism.isEmpty()) prisms.push(prism);
  }
  const joined = arena.track(M.union(prisms));
  const swept = arena.track(joined.simplify(tolerance));
  const clipped = arena.track(swept.trimByPlane([0, 0, -1], -ceiling));
  if (clipped.status() !== "NoError" || clipped.isEmpty()) {
    throw new Error("Could not clear the pocket's insertion path. Simplify the outline and try again.");
  }
  return clipped;
}
