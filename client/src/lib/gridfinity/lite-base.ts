// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import {
  BASE_BRIDGE_HEIGHT,
  BASE_PROFILE_HEIGHT,
  BASE_TOP_RADIUS,
  binFootprintMm,
  D_WALL,
  gridPitchMm,
} from "@shared/gridfinity/standard";

import type { Kernel } from "@/lib/manifold/runtime";

import { baseCellSolid, type GridSize } from "./base";
import { baseProfilePolygon, roundedRectPolygon, type ProfilePolygon } from "./profiles";
import { sweepRounded } from "./sweep";

/**
 * The lite base, ported from upstream `gridfinity_base_lite()` /
 * `base_outer_shell()` / `_lite_bridge_chamfer()` @ 910e22d8: each socket
 * becomes a thin shell (the solid profile minus a copy shifted inward by the
 * wall thickness — upstream's non-optimized path, since `D_WALL >
 * BASE_BOTTOM_RADIUS`) over a thin floor, and the bridge plate becomes a
 * lattice with a rounded opening per cell, its inner edges chamfered so the
 * webs print without support.
 *
 * v1 fixes upstream's two parameters at their bin defaults: `wall_thickness
 * = D_WALL` and `bottom_thickness = 1.2 mm` (six slicer layers). Magnet and
 * screw holes are not yet supported on the lite base (upstream adds bosses
 * around them); validation surfaces the conflict and the builder ignores
 * them.
 *
 * Assembly-order note: the shell's top rim would exactly abut the lattice's
 * underside at z = 4.75, and abutting unions weld only where faces share
 * vertices — so the shell profile's top vertices are nudged 0.2 mm up into
 * the plate, hidden inside its material (the sealed-void lesson from the
 * hole ceilings, applied preemptively; `decompose()` in the tests keeps it
 * honest).
 */

/** Six slicer layers — the floor under each hollow socket. */
export const LITE_BOTTOM_THICKNESS_MM = 1.2;

/** Overlap pushed into the plate so shell↔plate welds volumetrically. */
const WELD_OVERLAP_MM = 0.2;

/** The shell band: solid profile minus itself shifted inward by the wall. */
function shellBandPolygons(kernel: Kernel): ProfilePolygon[] {
  const { CrossSection, arena } = kernel;
  const profile = baseProfilePolygon();
  const outer = arena.track(new CrossSection([profile]));
  const shifted = arena.track(
    new CrossSection([profile.map(([x, y]) => [x - D_WALL, y] as [number, number])]),
  );
  const band = arena.track(outer.subtract(shifted));
  return band
    .toPolygons()
    .map((polygon) =>
      polygon.map(([x, y]) =>
        y >= BASE_PROFILE_HEIGHT - 1e-9
          ? ([x, y + WELD_OVERLAP_MM] as [number, number])
          : ([x, y] as [number, number]),
      ),
    );
}

/** The hollow socket for one cell: shell sweep plus the thin floor. */
function liteCell(
  kernel: Kernel,
  circularSegments: number,
  grid: GridSize,
): Manifold {
  const { Manifold, arena } = kernel;
  const pitch = grid.gridPitch ?? "full";
  const cellMm = binFootprintMm(1, pitch);
  const pathMm = cellMm - 2 * BASE_TOP_RADIUS;

  const shells = shellBandPolygons(kernel).map((band) =>
    sweepRounded(kernel, band, { widthMm: pathMm, lengthMm: pathMm }, circularSegments),
  );

  const slab = arena.track(
    arena
      .track(Manifold.cube([cellMm + 2, cellMm + 2, LITE_BOTTOM_THICKNESS_MM], true))
      .translate([0, 0, LITE_BOTTOM_THICKNESS_MM / 2]),
  );
  const floor = arena.track(baseCellSolid(kernel, circularSegments, pitch).intersect(slab));

  return arena.track(Manifold.union([...shells, floor]));
}

/**
 * The bridge lattice: the full plate minus one rounded opening per cell,
 * inner edges chamfered (upstream `_lite_bridge_chamfer`), all clipped to
 * an inset so the outer rim keeps a full wall.
 */
function liteLattice(
  kernel: Kernel,
  grid: GridSize,
  circularSegments: number,
): Manifold {
  const { CrossSection, Manifold, arena } = kernel;
  const pitch = grid.gridPitch ?? "full";
  const pitchMm = gridPitchMm(pitch);
  const widthMm = binFootprintMm(grid.gridX, pitch);
  const lengthMm = binFootprintMm(grid.gridY, pitch);
  const cellMm = binFootprintMm(1, pitch);

  const plate = arena.track(
    arena
      .track(
        new CrossSection([
          roundedRectPolygon(widthMm, lengthMm, BASE_TOP_RADIUS, circularSegments),
        ]).extrude(BASE_BRIDGE_HEIGHT),
      )
      .translate([0, 0, BASE_PROFILE_HEIGHT]),
  );

  const openingSection = arena.track(
    new CrossSection([
      roundedRectPolygon(
        cellMm - 2 * D_WALL,
        cellMm - 2 * D_WALL,
        BASE_TOP_RADIUS - D_WALL,
        circularSegments,
      ),
    ]),
  );
  const opening = arena.track(
    arena
      .track(openingSection.extrude(BASE_BRIDGE_HEIGHT + 2))
      .translate([0, 0, BASE_PROFILE_HEIGHT - 1]),
  );

  // Chamfer under each opening's rim: a triangle rising from the opening
  // edge to the plate top over one wall thickness.
  const chamferProfile: ProfilePolygon = [
    [BASE_TOP_RADIUS - D_WALL, 0],
    [BASE_TOP_RADIUS, BASE_BRIDGE_HEIGHT],
    [BASE_TOP_RADIUS - D_WALL, BASE_BRIDGE_HEIGHT],
  ];
  const chamfer = arena.track(
    sweepRounded(
      kernel,
      chamferProfile,
      { widthMm: cellMm - 2 * BASE_TOP_RADIUS, lengthMm: cellMm - 2 * BASE_TOP_RADIUS },
      circularSegments,
    ).translate([0, 0, BASE_PROFILE_HEIGHT]),
  );

  const cutters: Manifold[] = [];
  for (let i = 0; i < grid.gridX; i++) {
    for (let j = 0; j < grid.gridY; j++) {
      const x = (i - (grid.gridX - 1) / 2) * pitchMm;
      const y = (j - (grid.gridY - 1) / 2) * pitchMm;
      cutters.push(
        arena.track(opening.translate([x, y, 0])),
        arena.track(chamfer.translate([x, y, 0])),
      );
    }
  }

  // The chamfers reach exactly the cell edge; clipping every cutter to the
  // plate inset keeps the outer rim wall intact (upstream intersects with
  // `grid_size_mm − 2·wall`).
  const inset = arena.track(
    arena
      .track(
        new CrossSection([
          roundedRectPolygon(
            widthMm - 2 * D_WALL,
            lengthMm - 2 * D_WALL,
            BASE_TOP_RADIUS - D_WALL,
            circularSegments,
          ),
        ]).extrude(BASE_BRIDGE_HEIGHT + 2),
      )
      .translate([0, 0, BASE_PROFILE_HEIGHT - 1]),
  );
  const clipped = arena.track(arena.track(Manifold.union(cutters)).intersect(inset));
  return arena.track(plate.subtract(clipped));
}

/** The complete lite base: hollow sockets under the chamfered lattice. */
export function buildLiteBase(
  kernel: Kernel,
  grid: GridSize,
  circularSegments: number,
): Manifold {
  const { Manifold, arena } = kernel;
  const pitchMm = gridPitchMm(grid.gridPitch ?? "full");
  const cell = liteCell(kernel, circularSegments, grid);
  const pieces: Manifold[] = [liteLattice(kernel, grid, circularSegments)];
  for (let i = 0; i < grid.gridX; i++) {
    for (let j = 0; j < grid.gridY; j++) {
      const x = (i - (grid.gridX - 1) / 2) * pitchMm;
      const y = (j - (grid.gridY - 1) / 2) * pitchMm;
      pieces.push(arena.track(cell.translate([x, y, 0])));
    }
  }
  return arena.track(Manifold.union(pieces));
}
