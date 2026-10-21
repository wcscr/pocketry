import type { Manifold } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";
import type { BinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { compartmentHeightMm, compartmentLayout, compartmentLayoutError, dividerStripRings, hasCompartments } from "@shared/gridfinity/compartments";
import { footprintOuterSection } from "./footprint-section";
import { buildWallSection } from "./wall";

/**
 * Integral divider strips and directional scoops before the body's shared slant.
 * Scoop cross-section adapts Rebuilt's _compartment_scoop at 910e22d8 (MIT):
 * a square minus a quarter circle, extruded across a compartment's width.
 * One continuous scoop per row or column is equivalent after union with dividers.
 * All handles belong to the caller's Arena; see UPSTREAM.md and NOTICE.
 */
export function buildCompartments(kernel: Kernel, spec: BinSpec, segments: number): Manifold | null {
  if (spec.fill !== "none" || !hasCompartments(spec)) return null;
  const error = compartmentLayoutError(spec);
  if (error) throw new Error(error);
  const { arena, CrossSection, Manifold } = kernel;
  const height = compartmentHeightMm(spec);
  const outer = footprintOuterSection(kernel, spec, segments);
  const strips = dividerStripRings(spec);
  const solids: Manifold[] = [];
  if (strips.length) {
    const section = arena.track(new CrossSection(strips.map(ring => ring.map(p => [p.x, p.y] as [number, number]))));
    solids.push(arena.track(arena.track(arena.track(section.intersect(outer)).extrude(height)).translate([0, 0, BASE_HEIGHT])));
  }
  if (spec.compartments.scoop) {
    const { width, length, scoopAxis, scoopSide, scoopWalls, scoopRadius: radius } = compartmentLayout(spec);
    const span = scoopAxis === "y" ? width : length;
    const steps = Math.max(4, segments / 4);
    for (const wall of scoopWalls) {
      const profile: [number, number][] = [[0, BASE_HEIGHT], [radius, BASE_HEIGHT]];
      for (let i = 1; i <= steps; i++) {
        const angle = Math.PI / 2 * (1 - i / steps);
        profile.push([radius - radius * Math.cos(angle), BASE_HEIGHT + radius - radius * Math.sin(angle)]);
      }
      const placedProfile = profile.map(([distance, z]) => [wall - scoopSide * distance, z] as [number, number]);
      if (scoopSide > 0) placedProfile.reverse();
      const section = arena.track(new CrossSection([placedProfile]));
      const scoop = arena.track(arena.track(section.extrude(span)).transform([
        0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -span / 2, 0, 0, 1,
      ]));
      // Reflect across x=y: the profile coordinate becomes X, extrusion Y.
      solids.push(scoopAxis === "y" ? scoop : arena.track(scoop.transform([
        0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      ])));
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
