import type { Manifold, Vec3 } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";

/** Clear every upward translation of the rotated object. At each XY point the
 * floor is its lowest actual surface, including side faces turned downward by
 * rotation. Never extrapolate an authored bottom plane or flatten the seat.
 * Downward-facing triangles generate continuous prisms, preserving concavities,
 * holes and split seats without sampled poses or a whole-object convex hull. */
export function verticalDropInCutter(kernel: Kernel, source: Manifold, ceiling: number): Manifold {
  if (source.isEmpty()) return source;
  const bounds = source.boundingBox();
  if (!Number.isFinite(ceiling) || ceiling <= bounds.max[2]) {
    throw new Error("The insertion path must extend above the complete pocket.");
  }
  const { arena, Manifold: M } = kernel;
  // getMesh exposes Float32 positions. Tiny overlapping facets avoid coincident
  // Boolean seams that would otherwise collapse into degenerate exported faces.
  const tolerance = Math.max(source.tolerance(), 0.0001);
  const overlap = 0.001;
  const mesh = source.getMesh();
  const vertex = (index: number): Vec3 => [mesh.vertProperties[index * mesh.numProp],
    mesh.vertProperties[index * mesh.numProp + 1], mesh.vertProperties[index * mesh.numProp + 2]];
  const prisms: Manifold[] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const points = [vertex(mesh.triVerts[i]), vertex(mesh.triVerts[i+1]), vertex(mesh.triVerts[i+2])];
    const [a,b,c] = points;
    const facing = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if (facing >= -1e-10) continue;
    const start = points.flatMap(([x,y,z]) => [-1,1].flatMap(dx =>
      [-1,1].map(dy => [x+dx*overlap,y+dy*overlap,z] as Vec3)));
    const exit = start.map(([x,y,z]) => [x,y,z+ceiling-bounds.min[2]] as Vec3);
    const hull = arena.track(M.hull([...start, ...exit]));
    const prism = arena.track(hull.setTolerance(tolerance));
    if (!prism.isEmpty()) prisms.push(prism);
  }
  const joined = arena.track(M.union(prisms));
  // Restrict the overlap to the object's exact footprint. Simplifying the
  // projection removes sub-micron slivers from edge-on rounded faces.
  const projection = arena.track(arena.track(source.project()).simplify(tolerance));
  const column = arena.track(arena.track(projection.extrude(ceiling-bounds.min[2])).translate([0,0,bounds.min[2]]));
  const result = arena.track(joined.intersect(column));
  if (result.status() !== "NoError" || result.isEmpty()) {
    throw new Error("Could not clear the pocket's insertion path. Simplify the outline and try again.");
  }
  return result;
}
