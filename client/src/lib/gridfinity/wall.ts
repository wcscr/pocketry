import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { CrossSection, Manifold } from "manifold-3d";

import type { BinFootprint } from "@shared/gridfinity/footprint";
import {
  BASE_HEIGHT,
  BASE_TOP_RADIUS,
  binWallHeightMm,
  binWallThicknessMm,
  D_WALL,
  STACKING_LIP_SUPPORT_HEIGHT,
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
  arbitrarySizeMm?: { width: number; length: number } | null;
  footprint?: BinFootprint;
  heightUnits: number;
  fill?: "none" | "solid";
  lip?: "standard" | "none";
  wallThicknessMm?: number;
}

/**
 * The plain wall ring from the top of the base to the bin's nominal top:
 * Uses the requested hollow-wall thickness. Extra material stops below the
 * lip's inner support face so the original mating region stays unchanged.
 * Returns `null` for a 1u bin, whose wall height is zero.
 */
export function buildWallRing(
  kernel: Kernel,
  spec: WallSpec,
  circularSegments: number,
): Manifold | null {
  const { arena } = kernel;
  const wallHeightMm = binWallHeightMm(spec.heightUnits);
  if (wallHeightMm <= 0) return null;

  const widthMm = binWallThicknessMm(spec);
  const annulus = buildWallSection(kernel, spec, circularSegments, D_WALL);
  const originalWall = arena.track(annulus.extrude(wallHeightMm));
  let wall = originalWall;
  const thickHeightMm = spec.lip === "none" ? wallHeightMm
    : Math.max(0, wallHeightMm - STACKING_LIP_SUPPORT_HEIGHT);
  if (widthMm > D_WALL && thickHeightMm > 0) {
    const thickSection = buildWallSection(kernel, spec, circularSegments, widthMm);
    wall = arena.track(originalWall.add(arena.track(thickSection.extrude(thickHeightMm))));
  }
  return arena.track(wall.translate([0, 0, BASE_HEIGHT]));
}

/** Wall footprint or a wider/narrower inward border for a bin without a lip. */
export function buildWallSection(
  kernel: Kernel,
  spec: WallSpec,
  circularSegments: number,
  widthMm = binWallThicknessMm(spec),
): CrossSection {
  const { CrossSection, arena } = kernel;
  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    throw new Error("buildWallSection: border width must be positive and finite");
  }
  if (spec.footprint?.kind === "custom") {
    const outer = footprintOuterSection(kernel, spec, circularSegments);
    const wallInterior = footprintInteriorSection(kernel, spec, circularSegments);
    const inner = widthMm === D_WALL ? wallInterior
      : arena.track(wallInterior.offset(D_WALL - widthMm, "Round", 2, circularSegments));
    return arena.track(outer.subtract(inner));
  }

  const widthMmOuter = binWidthMm(spec);
  const lengthMm = binLengthMm(spec);
  const outer = roundedRectPolygon(widthMmOuter, lengthMm, BASE_TOP_RADIUS, circularSegments);
  // A wide border can consume a narrow footprint; never create a negative-size hole.
  if (2 * widthMm >= Math.min(widthMmOuter, lengthMm)) {
    return arena.track(new CrossSection([outer]));
  }
  // Winding is the hole marker: reversing the inner contour makes it negative
  // under manifold's Positive fill rule, so one CrossSection carries both.
  const inner = roundedRectPolygon(
    widthMmOuter - 2 * widthMm,
    lengthMm - 2 * widthMm,
    Math.min(BASE_TOP_RADIUS, (widthMmOuter - 2 * widthMm) / 2, (lengthMm - 2 * widthMm) / 2),
    circularSegments,
  ).reverse();

  return arena.track(new CrossSection([outer, inner]));
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
  const widthMm = binWidthMm(spec);
  const lengthMm = binLengthMm(spec);
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
