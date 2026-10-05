import type { Manifold, Vec3 } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";

/** Clear the complete top-down outline, keeping the original tilted seat.
 * First clear upward continuously. Source portions wholly above the fill do
 * not contribute to that opening, so their missing projection gets a vertical
 * column to the pocket's lowest elevation. A 1 micrometre overlap joins the
 * columns without zero-thickness seams at their boundary. */
export function verticalDropInCutter(kernel: Kernel, source: Manifold, surface: number, ceiling: number): Manifold {
  const { arena } = kernel;
  const swept = sweepSolidAlongAxis(kernel, source, [0,0,1], ceiling);
  if (source.isEmpty() || source.boundingBox().min[2] >= surface) return swept;
  const projection = arena.track(source.project());
  const opening = arena.track(swept.slice(surface-1e-7));
  const missing = arena.track(projection.subtract(opening));
  if (missing.isEmpty()) return swept;
  // Restrict the overlapping join to the exact projection, preserving holes
  // and concavities rather than enlarging the outside outline.
  const overlapping = arena.track(missing.offset(0.001,"Round",2,32));
  const footprint = arena.track(arena.track(overlapping.intersect(projection)).simplify(0.0001));
  const floor = source.boundingBox().min[2];
  const extension = arena.track(arena.track(footprint.extrude(ceiling-floor)).translate([0,0,floor]));
  const joined = arena.track(swept.add(extension));
  const result = arena.track(arena.track(joined.asOriginal()).simplify(0.0001));
  if (result.status() !== "NoError") throw new Error("Could not clear the complete vertical pocket opening.");
  return result;
}

/** Continuous upward sweep; exiting triangles generate exact convex prisms.
 * No sampled poses or whole-object hull are used. */
function sweepSolidAlongAxis(kernel: Kernel, source: Manifold, axis: Vec3, ceiling: number): Manifold {
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
