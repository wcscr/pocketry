// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import {
  BASE_BOTTOM_RADIUS,
  BASE_BRIDGE_HEIGHT,
  BASE_PROFILE_HEIGHT,
  BASE_TOP_RADIUS,
  baseBottomDimensionsMm,
  binFootprintMm,
  gridPitchMm,
  type GridPitch,
} from "@shared/gridfinity/standard";
import {
  cellCenterMm,
  occupiedCells,
  type BinFootprint,
} from "@shared/gridfinity/footprint";

import type { Kernel } from "@/lib/manifold/runtime";

import { baseHoleCutters, hasHoles, NO_HOLES, type HoleOptions } from "./holes";
import { baseProfilePolygon, roundedRectPolygon } from "./profiles";
import { sweepRounded } from "./sweep";
import { footprintOuterSection } from "./footprint-section";

/**
 * The Gridfinity base: one swept socket per grid cell plus the bridge plate
 * that ties them into a single printable bottom. Ports upstream
 * `base_solid()` / `_base_bridge_solid()` / `gridfinityBase()` from
 * src/core/base.scad @ 910e22d8 (holes are applied below; thumbscrews remain deferred).
 *
 * Geometry is XY-centred on the origin — grid cells at ±multiples of 42 mm —
 * with z = 0 at the bottom of the base, because that is the frame the 2D
 * layout editor and the 3D preview will share.
 */

export interface GridSize {
  gridX: number;
  gridY: number;
  /** Defaults to the standard 42 mm pitch for legacy call sites. */
  gridPitch?: GridPitch;
  footprint?: BinFootprint;
}

/**
 * One 41.5 × 41.5 base socket, z ∈ [0, 4.75], XY-centred.
 *
 * The profile gasket is swept around a 34 mm path (bottom footprint minus two
 * bottom radii) and the interior squared off by a centre block. The block is
 * `BASE_BOTTOM_RADIUS` oversize (34.8) exactly like upstream — overlapping a
 * union is cheaper and more robust than meeting the gasket's inner face
 * edge-to-edge.
 */
export function baseCellSolid(
  kernel: Kernel,
  circularSegments: number,
  pitch: GridPitch = "full",
): Manifold {
  const { Manifold, arena } = kernel;

  const topMm = binFootprintMm(1, pitch);
  const bottomMm = baseBottomDimensionsMm(topMm);
  const pathMm = bottomMm - 2 * BASE_BOTTOM_RADIUS;
  const gasket = sweepRounded(
    kernel,
    baseProfilePolygon(),
    { widthMm: pathMm, lengthMm: pathMm },
    circularSegments,
  );

  const fillMm = bottomMm - BASE_BOTTOM_RADIUS;
  const fill = arena.track(
    arena
      .track(Manifold.cube([fillMm, fillMm, BASE_PROFILE_HEIGHT], true))
      .translate([0, 0, BASE_PROFILE_HEIGHT / 2]),
  );

  return arena.track(Manifold.union([gasket, fill]));
}

/**
 * The complete base for a bin: `gridX × gridY` sockets on the 42 mm pitch,
 * bridged from z = 4.75 to z = 7 by a plate spanning the whole footprint
 * (rounded to {@link BASE_TOP_RADIUS}, flush with the sockets' top edges).
 * Magnet/screw holes, when enabled, are subtracted four per cell.
 */
export function buildBase(
  kernel: Kernel,
  grid: GridSize,
  circularSegments: number,
  holes: HoleOptions = NO_HOLES,
): Manifold {
  const { CrossSection, Manifold, arena } = kernel;
  if (!Number.isInteger(grid.gridX) || grid.gridX < 1 || !Number.isInteger(grid.gridY) || grid.gridY < 1) {
    throw new Error(`buildBase: grid must be positive integers, got ${grid.gridX}×${grid.gridY}`);
  }

  const pitch = grid.gridPitch ?? "full";
  const pitchMm = gridPitchMm(pitch);
  const cell = baseCellSolid(kernel, circularSegments, pitch);
  const pieces: Manifold[] = [];
  for (const occupied of occupiedCells(grid)) {
    const { x, y } = cellCenterMm(grid, occupied);
    pieces.push(arena.track(cell.translate([x, y, 0])));
  }

  const widthMm = binFootprintMm(grid.gridX, pitch);
  const lengthMm = binFootprintMm(grid.gridY, pitch);
  const bridgeSection = grid.footprint?.kind === "custom"
    ? footprintOuterSection(kernel, grid, circularSegments)
    : arena.track(
        new CrossSection([
          roundedRectPolygon(widthMm, lengthMm, BASE_TOP_RADIUS, circularSegments),
        ]),
      );
  pieces.push(
    arena.track(
      arena
        .track(bridgeSection.extrude(BASE_BRIDGE_HEIGHT))
        .translate([0, 0, BASE_PROFILE_HEIGHT]),
    ),
  );

  const solid = arena.track(Manifold.union(pieces));
  if (!hasHoles(holes)) return solid;

  const cutters = baseHoleCutters(kernel, grid, holes, circularSegments);
  if (cutters === null) return solid;
  return arena.track(solid.subtract(cutters));
}
