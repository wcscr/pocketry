// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import {
  binFootprintMm,
  binHeightMm,
  D_WALL,
  R_F2,
  TAB_HEIGHT_MM,
  TAB_PROFILE,
  TAB_WIDTH_NOMINAL_MM,
} from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
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

  const { CrossSection, arena } = kernel;
  const edge = tab.edge ?? edgeForWall(spec, tab.wall);
  const run = resolveBoundaryRun(spec, edge);
  if (!run) return null;
  const chordMm = run.lengthMm - 2 * D_WALL;
  if (!(chordMm > 0)) return null;

  // Profile in the (x = depth, y = height) plane, depth negated so the tab
  // grows inward (−y after mapping) from the wall face; negation also turns
  // the upstream point order CCW.
  const profile = TAB_PROFILE.map(([depth, height]) => [-depth, height] as [number, number]);
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
    prism.translate([startX, 0, binHeightMm(spec.heightUnits) - TAB_HEIGHT_MM]),
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
  const interiorW = binFootprintMm(spec.gridX, spec.gridPitch) - 2 * D_WALL;
  const interiorL = binFootprintMm(spec.gridY, spec.gridPitch) - 2 * D_WALL;
  const columnSection = spec.footprint.kind === "custom"
    ? footprintInteriorSection(kernel, spec, circularSegments)
    : arena.track(new CrossSection([
        roundedRectPolygon(interiorW, interiorL, R_F2, circularSegments),
      ]));
  const column = arena.track(columnSection.extrude(binHeightMm(spec.heightUnits) + 1));
  return arena.track(placed.intersect(column));
}
