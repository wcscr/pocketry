import type { CrossSection, Manifold, Vec3 } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";
import { bottomFilletCutter, type FilletOptions } from "./fillet-stack";

export interface VerticalPocketSeat {
  /** Shadow of the nominal tool, before the bin's bottom edge treatment. */
  projection: CrossSection;
  /** Upward normal of the authored bottom, after the pocket's rigid rotation. */
  normal: Vec3;
  /** Plane equation normal · position = offset; optional projected split region. */
  floors: { offset: number; region?: CrossSection }[];
  fillet: FilletOptions;
}

/** Extrude the object's XY shadow with vertical walls, then shear only the
 * floor profile to the authored seat plane. Extending the bottom plane removes
 * the tilted sidewalls that an upward sweep would otherwise retain as ridges.
 * Clamp to the original lowest elevation so added clearance cannot lower the
 * requested remaining floor. Split seats use the union of their vertical paths.
 */
function projectedPocket(kernel: Kernel, source: Manifold, ceiling: number, seat: VerticalPocketSeat): Manifold {
  const { arena, Manifold: M } = kernel;
  const projection = seat.projection;
  const floor = source.boundingBox().min[2];
  const [nx, ny, nz] = seat.normal;
  const xy = projection.toPolygons().flat();
  const pieces = seat.floors.map(({offset, region}) => {
    const minPlane = Math.min(...xy.map(([x,y]) => (offset-nx*x-ny*y)/nz));
    const local = bottomFilletCutter(kernel, projection, ceiling-minPlane+1, seat.fillet);
    const sloped = arena.track(local.transform([
      1,0,-nx/nz,0, 0,1,-ny/nz,0, 0,0,1,0, 0,0,offset/nz,1,
    ]));
    const bottomClipped = arena.track(sloped.trimByPlane([0,0,1],floor));
    let clipped = arena.track(bottomClipped.trimByPlane([0,0,-1],-ceiling));
    if (region) {
      const column = arena.track(arena.track(region.extrude(ceiling-floor)).translate([0,0,floor]));
      clipped = arena.track(clipped.intersect(column));
    }
    return clipped;
  });
  // Keep the authored object clear throughout insertion wherever the new wall
  // fillet would touch it. A finite copy alone can leave small overhangs above
  // the fillet's steps; its continuous upward sweep clears those as well.
  if (seat.fillet.radiusMm > 0 && nz < 1-1e-8) {
    // Sweep individual floor facets to keep work proportional to their count.
    // A one-micrometre lateral overlap avoids coincident fillet seams; clipping
    // to the nominal projection below preserves the exact outer perimeter.
    pieces.push(sweepSolidAlongAxis(kernel,source,[0,0,1],ceiling,0.001));
  }
  const joined = arena.track(M.union(pieces));
  const column = arena.track(arena.track(projection.extrude(ceiling-floor)).translate([0,0,floor]));
  return arena.track(joined.intersect(column));
}

/** Extend an upward-facing seat across the object's complete XY shadow.
 * Horizontal, inverted, and through pockets have no upward-facing authored
 * bottom plane; retain their general solid sweep instead. */
export function verticalDropInCutter(kernel: Kernel, source: Manifold, surface: number, ceiling: number, seat?: VerticalPocketSeat): Manifold {
  const { arena } = kernel;
  if (seat && seat.normal[2] > 0.01 && !source.isEmpty()) return projectedPocket(kernel,source,ceiling,seat);
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
function sweepSolidAlongAxis(kernel: Kernel, source: Manifold, axis: Vec3, ceiling: number, lateralOverlap = 0): Manifold {
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
    const facing = normal.reduce((sum,n,j) => sum+n*axis[j], 0);
    // For projected seats, sweep the downward-facing floor triangles. Their
    // small lateral overlap also covers joins along the original floor, not
    // just the volume above the object's exit faces.
    if (lateralOverlap ? facing >= -1e-10 : facing <= 1e-10) continue;
    const start = lateralOverlap ? points.flatMap(([x,y,z]) =>
      [-1,1].flatMap(dx => [-1,1].map(dy => [x+dx*lateralOverlap,y+dy*lateralOverlap,z] as Vec3))) : points;
    const exit = start.map(p => p.map((n,j) => n+axis[j]*travel) as Vec3);
    const hull = arena.track(M.hull([...start, ...exit]));
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
