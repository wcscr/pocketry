// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import type { BinFootprint } from "@shared/gridfinity/footprint";
import {
  BASE_HEIGHT,
  BASE_TOP_RADIUS,
  binFootprintMm,
  binWallHeightMm,
  D_WALL,
  type GridPitch,
} from "@shared/gridfinity/standard";

import type { Kernel } from "@/lib/manifold/runtime";

import { roundedRectPolygon, stackingLipProfilePolygon } from "./profiles";
import { sweepRounded } from "./sweep";
import { footprintInteriorSection, footprintOuterSection } from "./footprint-section";

/**
 * The bin wall and its stacking lip, ported from upstream `render_wall()` /
 * `_profile_wall()` in src/core/wall.scad @ 910e22d8. Both solids sit in the
 * bin frame: XY-centred, z = 0 at the bottom of the base, so the wall starts
 * at z = {@link BASE_HEIGHT}.
 *
 * Following upstream, the plain wall's inner face reuses
 * {@link BASE_TOP_RADIUS} for its corner radius (giving slightly thicker
 * corners — 1.34 mm on the diagonal against 0.95 on the flats), while the lip
 * is a swept profile whose corner arcs are true offsets. The two intersect;
 * `buildBin` unions them.
 */

export interface WallSpec {
  gridX: number;
  gridY: number;
  gridPitch?: GridPitch;
  footprint?: BinFootprint;
  heightUnits: number;
}

/**
 * The plain wall ring from the top of the base to the bin's nominal top:
 * a rounded-rect annulus of thickness {@link D_WALL}, extruded
 * `heightUnits·7 − 7`. Returns `null` for a 1u bin, whose wall height is zero.
 */
export function buildWallRing(
  kernel: Kernel,
  spec: WallSpec,
  circularSegments: number,
): Manifold | null {
  const { CrossSection, arena } = kernel;
  const wallHeightMm = binWallHeightMm(spec.heightUnits);
  if (wallHeightMm <= 0) return null;

  if (spec.footprint?.kind === "custom") {
    const outer = footprintOuterSection(kernel, spec, circularSegments);
    const inner = footprintInteriorSection(kernel, spec, circularSegments);
    const annulus = arena.track(outer.subtract(inner));
    return arena.track(
      arena.track(annulus.extrude(wallHeightMm)).translate([0, 0, BASE_HEIGHT]),
    );
  }

  const widthMm = binFootprintMm(spec.gridX, spec.gridPitch);
  const lengthMm = binFootprintMm(spec.gridY, spec.gridPitch);
  const outer = roundedRectPolygon(widthMm, lengthMm, BASE_TOP_RADIUS, circularSegments);
  // Winding is the hole marker: reversing the inner contour makes it negative
  // under manifold's Positive fill rule, so one CrossSection carries both.
  const inner = roundedRectPolygon(
    widthMm - 2 * D_WALL,
    lengthMm - 2 * D_WALL,
    BASE_TOP_RADIUS,
    circularSegments,
  ).reverse();

  const annulus = arena.track(new CrossSection([outer, inner]));
  return arena.track(
    arena.track(annulus.extrude(wallHeightMm)).translate([0, 0, BASE_HEIGHT]),
  );
}

/**
 * The stacking lip, swept around the rim. The profile already contains the
 * wall-height offset and the at-the-floor clamp (see
 * {@link stackingLipProfilePolygon}), so the sweep result only needs lifting
 * by the base height. For short bins the 45° support is clipped at the wall
 * bottom exactly as upstream's `_profile_wall()` clamps it.
 */
export function buildStackingLip(
  kernel: Kernel,
  spec: WallSpec,
  circularSegments: number,
  profileStepMm = 0.2,
): Manifold {
  const { arena } = kernel;
  const wallHeightMm = binWallHeightMm(spec.heightUnits);
  if (wallHeightMm < 0) {
    throw new Error(`buildStackingLip: negative wall height for ${spec.heightUnits}u`);
  }

  const profile = stackingLipProfilePolygon({ wallHeightMm, circularSegments });
  if (spec.footprint?.kind === "custom") {
    return buildCustomStackingLip(
      kernel,
      spec,
      profile,
      circularSegments,
      profileStepMm,
    );
  }
  const widthMm = binFootprintMm(spec.gridX, spec.gridPitch);
  const lengthMm = binFootprintMm(spec.gridY, spec.gridPitch);
  const swept = sweepRounded(
    kernel,
    profile,
    {
      widthMm: widthMm - 2 * BASE_TOP_RADIUS,
      lengthMm: lengthMm - 2 * BASE_TOP_RADIUS,
    },
    circularSegments,
  );
  return arena.track(swept.translate([0, 0, BASE_HEIGHT]));
}

function buildCustomStackingLip(
  kernel: Kernel,
  spec: WallSpec,
  profile: readonly (readonly [number, number])[],
  circularSegments: number,
  profileStepMm: number,
): Manifold {
  const { Manifold, arena } = kernel;
  const outer = footprintOuterSection(kernel, spec, circularSegments);
  const minY = Math.min(...profile.map((point) => point[1]));
  const maxY = Math.max(...profile.map((point) => point[1]));
  const slices = Math.max(1, Math.ceil((maxY - minY) / Math.max(profileStepMm, 0.05)));
  const pieces: Manifold[] = [];
  for (let index = 0; index < slices; index++) {
    const bottom = minY + ((maxY - minY) * index) / slices;
    const top = minY + ((maxY - minY) * (index + 1)) / slices;
    const span = horizontalProfileSpan(profile, (bottom + top) / 2);
    if (!span) continue;
    const innerDelta = span[0] - BASE_TOP_RADIUS;
    const outerDelta = span[1] - BASE_TOP_RADIUS;
    const outerBand = Math.abs(outerDelta) < 1e-9
      ? outer
      : arena.track(outer.offset(outerDelta, "Round", 2, circularSegments).simplify());
    const innerBand = arena.track(outer.offset(innerDelta, "Round", 2, circularSegments).simplify());
    if (outerBand.isEmpty()) continue;
    const band = innerBand.isEmpty() ? outerBand : arena.track(outerBand.subtract(innerBand));
    if (band.isEmpty()) continue;
    pieces.push(
      arena.track(
        arena.track(band.extrude(top - bottom + 0.01)).translate([0, 0, BASE_HEIGHT + bottom]),
      ),
    );
  }
  if (pieces.length === 0) throw new Error("buildStackingLip: custom lip profile collapsed");
  return arena.track(Manifold.union(pieces));
}

function horizontalProfileSpan(
  profile: readonly (readonly [number, number])[],
  y: number,
): [number, number] | null {
  const intersections: number[] = [];
  for (let index = 0; index < profile.length; index++) {
    const a = profile[index];
    const b = profile[(index + 1) % profile.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      const t = (y - a[1]) / (b[1] - a[1]);
      intersections.push(a[0] + t * (b[0] - a[0]));
    }
  }
  if (intersections.length < 2) return null;
  return [Math.min(...intersections), Math.max(...intersections)];
}
