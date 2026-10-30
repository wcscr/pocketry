import { buildCompartments } from "./compartments";
import { buildWallRing } from "./wall";
import { compartmentHeightMm, compartmentLabelTabPlacements } from "@shared/gridfinity/compartments";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { footprintOuterSection } from "./footprint-section";
import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import {
  binHeightMm,
  D_WALL,
  R_F2,
  TAB_WIDTH_NOMINAL_MM,
} from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import { boundaryLabelTabProfileMm } from "@shared/gridfinity/label-tab";
import { edgeForWall, resolveBoundaryRun } from "@shared/gridfinity/footprint";

import { roundedRectPolygon } from "./profiles";
import type { Kernel } from "@/lib/manifold/runtime";
import { footprintInteriorSection } from "./footprint-section";

/**
 * Label tab (upstream `src/core/tab.scad` + `TAB_POLYGON`): a shelf hung
 * from the top of one wall — vertical wall face, flat top flush with the
 * wall top, 1.2 mm tip face, 36° sloped underside — deep enough to read or
 * label the bin's contents.
 *
 * Construction mirrors the scoop's: the profile prism is built oversized
 * along the wall, then intersected with the interior column, so the rounded
 * interior corners trim the ends exactly and a full-width tab can never
 * poke through a wall. The tab is *added* material, unioned into the wall
 * part; where it meets the stacking lip's support or a solid infill the
 * union simply absorbs the overlap.
 *
 * `width: "left"/"right"` is as seen from the bin centre facing the wall —
 * a frame that rotates with the wall, so the rule reads the same on all
 * four.
 */

export interface LabelTabSpec {
  wall: "north" | "south" | "east" | "west";
  width: "full" | "center" | "left" | "right";
}

const WALL_ROTATION_DEG: Record<LabelTabSpec["wall"], number> = {
  north: 0,
  east: -90,
  south: 180,
  west: 90,
};

/** Builds the tab solid for `spec.labelTab`, or null when absent. */
export function buildLabelTab(
  kernel: Kernel,
  spec: BinSpec,
  circularSegments: number,
): Manifold | null {
  const tab = spec.labelTab;
  if (!tab) return null;
  if (tab.scope === "compartments" && spec.fill === "none") return buildCompartmentLabelTabs(kernel, spec, circularSegments);
  const profileMm = boundaryLabelTabProfileMm(spec);
  if (!profileMm) return null;

  const { CrossSection, arena } = kernel;
  const edge = tab.edge ?? edgeForWall(spec, tab.wall);
  const run = resolveBoundaryRun(spec, edge);
  if (!run) return null;
  const chordMm = run.lengthMm - 2 * D_WALL;
  if (!(chordMm > 0)) return null;

  // Profile in the (x = depth, y = height) plane, depth negated so the tab
  // grows inward (−y after mapping) from the wall face; negation also turns
  // the upstream point order CCW.
  const profile = profileMm.points.map(([depth, height]) => [-depth, height] as [number, number]);
  const section = arena.track(new CrossSection([profile]));

  const lengthMm =
    tab.width === "full" ? chordMm + 20 : Math.min(TAB_WIDTH_NOMINAL_MM, chordMm);
  // extrude → z ∈ [0, L]; rotate X90 then Z90 maps (depth, height, length)
  // onto (length → x, depth → y, height → z).
  const prism = arena.track(
    arena.track(section.extrude(lengthMm)).rotate([90, 0, 90]),
  );

  // Facing the wall from the bin centre, left is the −x end pre-rotation.
  const startX =
    tab.width === "left"
      ? -chordMm / 2
      : tab.width === "right"
        ? chordMm / 2 - lengthMm
        : -lengthMm / 2;
  const local = arena.track(
    prism.translate([startX, 0, binHeightMm(spec.heightUnits) - profileMm.heightMm]),
  );
  const rotation = WALL_ROTATION_DEG[edge.side];
  const rotated =
    rotation === 0 ? local : arena.track(local.rotate([0, 0, rotation]));
  const midpoint = {
    x: (run.start.x + run.end.x) / 2,
    y: (run.start.y + run.end.y) / 2,
  };
  if (edge.side === "north") midpoint.y -= D_WALL;
  else if (edge.side === "south") midpoint.y += D_WALL;
  else if (edge.side === "east") midpoint.x -= D_WALL;
  else midpoint.x += D_WALL;
  const placed = arena.track(rotated.translate([midpoint.x, midpoint.y, 0]));

  // Trim to the rounded interior so the ends follow the corner fillets.
  const interiorW = binWidthMm(spec) - 2 * D_WALL;
  const interiorL = binLengthMm(spec) - 2 * D_WALL;
  const columnSection = spec.footprint.kind === "custom"
    ? footprintInteriorSection(kernel, spec, circularSegments)
    : arena.track(new CrossSection([
        roundedRectPolygon(interiorW, interiorL, R_F2, circularSegments),
      ]));
  const column = arena.track(columnSection.extrude(binHeightMm(spec.heightUnits) + 1));
  return arena.track(placed.intersect(column));
}

/** Repeat the existing Rebuilt tab profile at each compartment's selected wall. */
function buildCompartmentLabelTabs(kernel: Kernel, spec: BinSpec, segments: number): Manifold | null {
  const { arena, CrossSection, Manifold } = kernel;
  const placements = compartmentLabelTabPlacements(spec);
  const height = compartmentHeightMm(spec);
  if (!placements.length || height <= 0) return null;
  const tabs = placements.map(({ x, y, start, length, depth, rotation, profile }) => {
    const points = profile.points.map(([d, z]) => [d === 0 ? 0.02 : -d * depth / profile.depthMm, z] as [number, number]);
    // Keep the sloped underside's root at the nominal wall face. The tiny
    // attachment overlap must not flatten the support by extending its run.
    if (profile.points.at(-1)![0] !== 0 && profile.points.at(-1)![1] > 0) points.push([0, 0]);
    const section = arena.track(new CrossSection([points]));
    const prism = arena.track(arena.track(section.extrude(length)).rotate([90, 0, 90]));
    const local = arena.track(prism.translate([start, 0, BASE_HEIGHT + height - profile.heightMm]));
    return arena.track(arena.track(local.rotate([0, 0, rotation])).translate([x, y, 0]));
  });
  const envelope = arena.track(arena.track(footprintOuterSection(kernel, spec, segments).extrude(height)).translate([0, 0, BASE_HEIGHT]));
  const clipped = arena.track(arena.track(Manifold.union(tabs)).intersect(envelope));
  if (spec.footprint.kind !== "custom") return clipped;
  // A clipped cell can lose its mounting edge. Retain only shelf fragments
  // attached to a wall/divider/scoop, or reaching the floor in a shallow bin.
  const supports = [buildWallRing(kernel, spec, segments), buildCompartments(kernel, spec, segments)]
    .filter((part): part is Manifold => part !== null);
  const support = arena.track(Manifold.union(supports));
  const attached = clipped.decompose().map(part => arena.track(part)).filter(part =>
    part.boundingBox().min[2] <= BASE_HEIGHT + 1e-7 || arena.track(part.intersect(support)).volume() > 1e-7);
  return attached.length ? arena.track(Manifold.union(attached)) : null;
}
