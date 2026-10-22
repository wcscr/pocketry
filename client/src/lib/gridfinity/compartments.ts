import type { Manifold } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";
import type { BinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT, binWallThicknessMm } from "@shared/gridfinity/standard";
import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
import { compartmentHeightMm, compartmentLayout, compartmentLayoutError, dividerStripRings, hasCompartments } from "@shared/gridfinity/compartments";
import { footprintOuterSection } from "./footprint-section";
import { buildWallSection } from "./wall";
import { bottomFilletCutter, FILLET_PROFILE_STEP_MM } from "./fillet-stack";
import { effectiveBottomFilletRadiusMm } from "@shared/gridfinity/bottom-fillet";

/** Quarter-circle floor transition, swept parallel to its mounting wall. */
function floorCurve(kernel: Kernel, axis: "x" | "y", wall: number, side: number,
  span: number, radius: number, steps: number): Manifold {
  const { arena, CrossSection } = kernel;
  const profile: [number, number][] = [[0, BASE_HEIGHT], [radius, BASE_HEIGHT]];
  for (let i = 1; i <= steps; i++) {
    const angle = Math.PI / 2 * (1 - i / steps);
    profile.push([radius - radius * Math.cos(angle), BASE_HEIGHT + radius - radius * Math.sin(angle)]);
  }
  const placed = profile.map(([distance, z]) => [wall - side * distance, z] as [number, number]);
  if (side > 0) placed.reverse();
  const section = arena.track(new CrossSection([placed]));
  const curve = arena.track(arena.track(section.extrude(span)).transform([
    0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -span / 2, 0, 0, 1,
  ]));
  return axis === "y" ? curve : arena.track(curve.transform([
    0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]));
}

/** Closing wedges introduce an upright wall by clipping, rather than warping
 * the original wall. Round that new floor edge in world coordinates as well. */
export function buildClosingWallFillet(kernel: Kernel, spec: BinSpec, segments: number,
  profileStepMm = FILLET_PROFILE_STEP_MM): Manifold | null {
  const radius = effectiveBottomFilletRadiusMm(spec);
  if (radius === 0 || !spec.wallSlant) return null;
  const { axis, side } = spec.wallSlant;
  const fixedSide = side === "positive" ? -1 : 1;
  const half = (axis === "x" ? binWidthMm(spec) : binLengthMm(spec)) / 2;
  const span = axis === "x" ? binLengthMm(spec) : binWidthMm(spec);
  return floorCurve(kernel, axis, fixedSide * (half - binWallThicknessMm(spec)), fixedSide,
    span, radius, Math.max(4, Math.ceil(segments / 4), Math.ceil(Math.PI * radius / (2 * profileStepMm))));
}

/** Floor fillets to fuse with the upright wall before any non-affine slant.
 * A single-wall warp must triangulate the wall and its fillet together, or
 * rounded corners can leave coincident-edge seams in coordinate-only STL. */
export function buildBottomFillet(kernel: Kernel, spec: BinSpec, segments: number,
  profileStepMm = FILLET_PROFILE_STEP_MM): Manifold | null {
  const radius = effectiveBottomFilletRadiusMm(spec);
  if (radius === 0) return null;
  const error = compartmentLayoutError(spec);
  if (error) throw new Error(error);
  const { arena, CrossSection } = kernel;
  const outer = footprintOuterSection(kernel, spec, segments);
  let cavity = arena.track(outer.subtract(buildWallSection(kernel, spec, segments)));
  const strips = dividerStripRings(spec);
  if (strips.length) {
    const dividers = arena.track(new CrossSection(strips.map(ring => ring.map(p => [p.x, p.y] as [number, number]))));
    cavity = arena.track(cavity.subtract(dividers));
  }
  // Offsetting the complete cavity rounds both sides of each divider and
  // follows custom footprints without independent overlapping edge sweeps.
  const rounded = bottomFilletCutter(kernel, cavity, radius + profileStepMm, {
    radiusMm: radius, profileStepMm, circularSegments: segments,
  });
  return arena.track(arena.track(arena.track(cavity.extrude(radius)).subtract(rounded))
    .translate([0, 0, BASE_HEIGHT]));
}

/**
 * Integral divider strips and directional scoops before the body's shared slant.
 * Scoop cross-section adapts Rebuilt's _compartment_scoop at 910e22d8 (MIT):
 * a square minus a quarter circle, extruded across a compartment's width.
 * One continuous scoop per row or column is equivalent after union with dividers.
 * All handles belong to the caller's Arena; see UPSTREAM.md and NOTICE.
 */
export function buildCompartments(kernel: Kernel, spec: BinSpec, segments: number,
  floorFillet: Manifold | null = null): Manifold | null {
  if (spec.fill !== "none" || (!hasCompartments(spec) && !floorFillet)) return null;
  const error = compartmentLayoutError(spec);
  if (error) throw new Error(error);
  const { arena, CrossSection, Manifold } = kernel;
  const height = compartmentHeightMm(spec);
  const outer = footprintOuterSection(kernel, spec, segments);
  const strips = dividerStripRings(spec);
  const solids: Manifold[] = [];
  const dividers = strips.length ? arena.track(new CrossSection(strips.map(ring => ring.map(p => [p.x, p.y] as [number, number])))) : null;
  if (dividers) {
    solids.push(arena.track(arena.track(arena.track(dividers.intersect(outer)).extrude(height)).translate([0, 0, BASE_HEIGHT])));
  }
  if (floorFillet) solids.push(floorFillet);
  if (spec.compartments.scoop) {
    const { width, length, scoopAxis, scoopSide, scoopWalls, scoopRadius: radius } = compartmentLayout(spec);
    const span = scoopAxis === "y" ? width : length;
    const steps = Math.max(4, segments / 4);
    for (const wall of scoopWalls) {
      solids.push(floorCurve(kernel, scoopAxis, wall, scoopSide, span, radius, steps));
    }
  }
  const combined = arena.track(Manifold.union(solids));
  const envelope = arena.track(arena.track(outer.extrude(height)).translate([0, 0, BASE_HEIGHT]));
  return arena.track(combined.intersect(envelope));
}

/** A color mask across divider tops only, stopping at the cavity's wall boundary. */
export function buildDividerTopRegion(kernel: Kernel, spec: BinSpec, segments: number, depthMm: number): Manifold | null {
  const strips = dividerStripRings(spec);
  const depth = Math.min(depthMm, compartmentHeightMm(spec));
  if (!strips.length || depth <= 0) return null;
  const { arena, CrossSection } = kernel;
  const interior = arena.track(footprintOuterSection(kernel, spec, segments)
    .subtract(buildWallSection(kernel, spec, segments)));
  const section = arena.track(arena.track(new CrossSection(strips.map(ring => ring.map(p => [p.x, p.y] as [number, number]))))
    .intersect(interior));
  return arena.track(arena.track(section.extrude(depth))
    .translate([0, 0, BASE_HEIGHT + compartmentHeightMm(spec) - depth]));
}
