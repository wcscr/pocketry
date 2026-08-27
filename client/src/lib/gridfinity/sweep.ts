// Type-only, so no manifold code is pulled into this module: the kernel is
// injected by the caller (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import type { Kernel } from "@/lib/manifold/runtime";

import { assertCircularSegments, polygonArea, type ProfilePolygon } from "./profiles";

/**
 * The sweep primitive the whole Gridfinity port hinges on, mapping upstream
 * `sweep_rounded(size)` (src/helpers/generic-helpers.scad @ 910e22d8) onto
 * manifold: a 2D profile is swept around a `width × length` rectangle **path**
 * centred on the origin, producing four linear extrusions along the edges and
 * four 90° revolves at the corners, unioned into one ring solid.
 *
 * The profile lives in the (radial, up) plane: x ≥ 0 points outward from the
 * path, y becomes world z. A profile point at x = r therefore traces a corner
 * arc of radius r — which is why callers pre-translate profiles outward (the
 * base profile by `BASE_BOTTOM_RADIUS`, the lip by `BASE_TOP_RADIUS −
 * STACKING_LIP_DEPTH`) to realise the spec's corner radii.
 *
 * This decomposition is exact, not approximate (modulo circular segments):
 * sweeping along a convex path is a Minkowski sum, and the union of per-edge
 * and per-corner pieces equals the Minkowski sum of the whole path. The
 * invariant tests pin this against a closed form (prisms + faceted Pappus)
 * and against `minkowskiSum` as an independent oracle.
 */

export interface SweepPathRect {
  /** Extent of the rectangular sweep path along x, in mm. */
  widthMm: number;
  /** Extent of the rectangular sweep path along y, in mm. */
  lengthMm: number;
}

/**
 * Sweeps `profile` around the rectangle `path`, returning a Manifold tracked
 * in `kernel.arena` (release it if it must outlive the arena).
 *
 * `circularSegments` is per full circle; each corner revolve uses a quarter
 * of it. Multiples of 8 keep corner vertices on the cardinal directions, so
 * bounding boxes stay exact.
 */
export function sweepRounded(
  kernel: Kernel,
  profile: ProfilePolygon,
  path: SweepPathRect,
  circularSegments: number,
): Manifold {
  const { CrossSection, Manifold, arena } = kernel;
  assertCircularSegments(circularSegments);

  if (!(path.widthMm > 0) || !(path.lengthMm > 0)) {
    throw new Error(
      `sweepRounded: path must be positive, got ${path.widthMm}×${path.lengthMm}`,
    );
  }
  if (polygonArea(profile) <= 0) {
    throw new Error("sweepRounded: profile must be counter-clockwise and non-degenerate");
  }
  if (profile.some(([x]) => x < -1e-9)) {
    // rotate_extrude / revolve clip x < 0; a profile crossing the axis would
    // silently lose material rather than erroring.
    throw new Error("sweepRounded: profile x must be ≥ 0 (radial distance from the path)");
  }

  const section = arena.track(new CrossSection([profile]));
  const halfW = path.widthMm / 2;
  const halfL = path.lengthMm / 2;
  const pieces: Manifold[] = [];

  // Edges. The canonical prism extrudes the profile along +z, then
  // rotate([90, 0, 90]) maps: extrusion → +x, profile x → +y (outward),
  // profile y → +z (up). Walking the path clockwise keeps "outward" on the
  // left of travel, matching the corner revolves below.
  const edges = [
    { lengthMm: path.widthMm, rotZ: 0, at: [-halfW, halfL] }, // top, outward +y
    { lengthMm: path.lengthMm, rotZ: -90, at: [halfW, halfL] }, // right, outward +x
    { lengthMm: path.widthMm, rotZ: 180, at: [halfW, -halfL] }, // bottom, outward −y
    { lengthMm: path.lengthMm, rotZ: 90, at: [-halfW, -halfL] }, // left, outward −x
  ] as const;

  for (const edge of edges) {
    let piece = arena.track(
      arena.track(section.extrude(edge.lengthMm)).rotate([90, 0, 90]),
    );
    if (edge.rotZ !== 0) {
      piece = arena.track(piece.rotate([0, 0, edge.rotZ]));
    }
    pieces.push(arena.track(piece.translate([edge.at[0], edge.at[1], 0])));
  }

  // Corners. revolve() spins the profile CCW from the +x axis around z, so a
  // quarter revolve spans azimuth 0°–90° — exactly the wedge between the
  // right edge's outward normal and the top edge's, which is the (+,+)
  // corner. The rest are that wedge rotated by 90° steps.
  //
  // manifold spreads the segment count across the *swept angle*, not per full
  // circle (measured: revolve(32, 90°) gives 32 wedges in the quarter), so a
  // quarter revolve gets a quarter of the per-circle budget.
  const quarter = arena.track(section.revolve(circularSegments / 4, 90));
  const corners = [
    { rotZ: 0, at: [halfW, halfL] },
    { rotZ: 90, at: [-halfW, halfL] },
    { rotZ: 180, at: [-halfW, -halfL] },
    { rotZ: 270, at: [halfW, -halfL] },
  ] as const;

  for (const corner of corners) {
    const oriented =
      corner.rotZ === 0 ? quarter : arena.track(quarter.rotate([0, 0, corner.rotZ]));
    pieces.push(arena.track(oriented.translate([corner.at[0], corner.at[1], 0])));
  }

  return arena.track(Manifold.union(pieces));
}

/**
 * Closed-form volume of {@link sweepRounded}'s output, exact for the
 * *discretised* solid (not the smooth limit): the profile area times the path
 * perimeter for the edge prisms, plus a faceted Pappus term for the corner
 * revolves — four quarter-turns of `m = circularSegments / 4` wedges, each
 * wedge contributing `area · centroidX · sin(90°/m)`.
 *
 * Lives beside the primitive rather than in the tests because the worker will
 * later use it for progress estimation; the tests hold it against manifold's
 * measured volume to 1e-6.
 */
export function sweptVolumeClosedForm(
  profileAreaMm2: number,
  profileCentroidX: number,
  path: SweepPathRect,
  circularSegments: number,
): number {
  const perimeter = 2 * (path.widthMm + path.lengthMm);
  const wedges = circularSegments / 4;
  const corners =
    4 * profileAreaMm2 * profileCentroidX * wedges * Math.sin(Math.PI / (2 * wedges));
  return profileAreaMm2 * perimeter + corners;
}
