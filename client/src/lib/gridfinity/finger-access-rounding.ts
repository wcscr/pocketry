import type { Manifold } from "manifold-3d";
import {
  elongatedFingerHoleEndpoints,
  effectiveFingerHoleDepthMm,
  capsuleRing,
  flatEndedScoopRadiusMm,
  type FingerHole,
} from "@shared/gridfinity/cutout";
import type { Kernel } from "@/lib/manifold/runtime";
import type { FilletOptions } from "./fillet-stack";

/** Exact transverse circle/fillet tangency, measured from the bin's top (z=0). */
export function fingerAccessRimGeometry(
  hole: FingerHole,
  rimRadius: number,
) {
  const depth = effectiveFingerHoleDepthMm(hole);
  const radius = flatEndedScoopRadiusMm({ ...hole, depthMm: depth });
  const centerZ = radius - depth;
  // A shaft at least as tall as the rim radius takes an ordinary quarter circle.
  const verticalJoin = hole.kind === "straight" || centerZ <= -rimRadius;
  // The fillet centre is (openingHalfWidth, -rimRadius). External tangency
  // requires its distance from the cylinder centre to equal radius + rimRadius.
  const openingHalfWidth = verticalJoin
    ? hole.diameterMm / 2 + rimRadius
    : Math.sqrt((radius + rimRadius) ** 2 - (centerZ + rimRadius) ** 2);
  const tangentZ = verticalJoin
    ? -rimRadius
    : -rimRadius * depth / (radius + rimRadius);
  const tangentHalfWidth = verticalJoin
    ? hole.diameterMm / 2
    : openingHalfWidth * radius / (radius + rimRadius);
  return { depth, radius, centerZ, rimRadius, openingHalfWidth, tangentZ, tangentHalfWidth, verticalJoin };
}

type RimGeometry = ReturnType<typeof fingerAccessRimGeometry>;

/** Half-width of the rounded cutter at a horizontal plane. */
export function fingerAccessHalfWidthAtZ(
  hole: FingerHole,
  rim: RimGeometry,
  z: number,
): number {
  if (z >= 0) return rim.openingHalfWidth;
  if (z >= rim.tangentZ) {
    return rim.openingHalfWidth - Math.sqrt(Math.max(0, rim.rimRadius ** 2 - (z + rim.rimRadius) ** 2));
  }
  if (hole.kind === "straight" || z >= rim.centerZ) return hole.diameterMm / 2;
  const height = Math.max(0, z + rim.depth);
  return Math.sqrt(Math.max(0, height * (2 * rim.radius - height)));
}

/**
 * Curved styles use a whole cutter with tangent circular profiles (a zero rim
 * radius also supports unrounded shallow round and oblong cuts). Round holes
 * use circular rings, oblongs sweep them along the capsule spine, and flat-ended
 * scoops retain planar ends with quarter-circle end rounding. Straight holes
 * return only the top flare to preserve their separately built bottom fillet.
 */
export function buildRoundedFingerAccessCutter(
  kernel: Kernel,
  hole: FingerHole,
  topZ: number,
  cutterTopZ: number,
  options: FilletOptions,
): Manifold {
  const { arena, CrossSection } = kernel;
  const r = options.radiusMm;
  const rim = fingerAccessRimGeometry(hole, r);
  const flatEnded = hole.kind === "flat-ended-scoop";
  const oblong = hole.kind === "oblong-deep-scoop";
  const straight = hole.kind === "straight";
  const { lengthMm } = elongatedFingerHoleEndpoints(hole);
  const halfSpan = oblong ? (lengthMm - hole.diameterMm) / 2 : 0;
  const halfWidth = hole.diameterMm / 2;
  const steps = Math.max(
    12,
    Math.ceil(options.circularSegments / 2),
    Math.ceil(Math.PI * r / (2 * options.profileStepMm)),
  );
  const heights = [straight ? -r : -rim.depth, rim.tangentZ, -r, 0, cutterTopZ - topZ];
  const bottomAngle = rim.verticalJoin ? Math.PI / 2 : Math.asin(rim.tangentHalfWidth / rim.radius);
  const rimAngle = Math.acos(Math.max(0, Math.min(1, (rim.tangentZ + r) / r)));
  for (let i = 0; i <= steps; i++) {
    // Sample the cylinder and both fillets by angle, including their tangent joins.
    if (!straight) heights.push(-rim.depth + 2 * rim.radius * Math.sin(bottomAngle * i / (2 * steps)) ** 2);
    heights.push(-r + r * Math.cos(rimAngle * i / steps));
    heights.push(-r + r * Math.sin(Math.PI * i / (2 * steps)));
  }
  const levels = heights
    .sort((a, b) => a - b)
    .filter((z, i, all) => i === 0 || z - all[i - 1] > 1e-9);
  const template = flatEnded
    ? arena.track(arena.track(CrossSection.square([lengthMm, hole.diameterMm], true))
        .offset(r, "Round", 2, options.circularSegments))
    : oblong
      ? arena.track(new CrossSection([capsuleRing(
          { x: -halfSpan, y: 0 }, { x: halfSpan, y: 0 }, halfWidth,
          options.circularSegments,
        ).map(({ x, y }) => [x, y] as [number, number])]))
      : arena.track(CrossSection.circle(halfWidth, options.circularSegments));
  // The source prism supplies a connected, consistently wound mesh for each ring.
  const prism = arena.track(template.extrude(levels.length - 1, levels.length - 2));
  let cutter = arena.track(prism.warp((vertex) => {
    const z = levels[Math.max(0, Math.min(levels.length - 1, Math.round(vertex[2])))];
    const width = fingerAccessHalfWidthAtZ(hole, rim, z);
    if (flatEnded) {
      const endOutset = z <= -r
        ? 0
        : z >= 0 ? r : r - Math.sqrt(Math.max(0, r * r - (z + r) ** 2));
      const baseX = Math.max(-lengthMm / 2, Math.min(lengthMm / 2, vertex[0]));
      const baseY = Math.max(-halfWidth, Math.min(halfWidth, vertex[1]));
      vertex[0] = baseX + (vertex[0] - baseX) * endOutset / r;
      vertex[1] = baseY / halfWidth * (width - endOutset) + (vertex[1] - baseY) * endOutset / r;
    } else {
      const baseX = Math.max(-halfSpan, Math.min(halfSpan, vertex[0]));
      vertex[0] = baseX + (vertex[0] - baseX) * width / halfWidth;
      vertex[1] *= width / halfWidth;
    }
    vertex[2] = z;
  }));
  // Round/straight mouths ignore retained rotation, matching their shaft polygons.
  if (flatEnded || oblong) cutter = arena.track(cutter.rotate([0, 0, hole.rotationDeg ?? 0]));
  return arena.track(cutter.translate([hole.center.x, hole.center.y, topZ]));
}
