// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import {
  BASE_HEIGHT,
  CHAMFER_ADDITIONAL_RADIUS,
  HOLE_DISTANCE_FROM_BOTTOM_EDGE,
  baseBottomDimensionsMm,
  GRID_DIMENSIONS_MM,
  LAYER_HEIGHT,
  MAGNET_HOLE_CRUSH_RIB_COUNT,
  MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS,
  MAGNET_HOLE_DEPTH,
  MAGNET_HOLE_RADIUS,
  SCREW_HOLE_RADIUS,
} from "@shared/gridfinity/standard";

import type { Kernel } from "@/lib/manifold/runtime";

import type { GridSize } from "./base";

/**
 * Magnet and screw hole cutters, ported from upstream
 * `gridfinity-rebuilt-holes.scad` `block_base_hole()` / `screw_hole()` /
 * `make_hole_printable()` and `base.scad` `_base_holes()` @ 910e22d8.
 *
 * Holes open on the **bottom** face (the print bed side): a magnet pocket
 * ⌀6.5 × 2.4 deep, and/or an M3 screw hole ⌀3 running the full 7 mm base
 * height — which pierces into the bin cavity on unfilled bins (a deliberate
 * genus change the tests pin).
 *
 * `supportless` reproduces upstream's sequential-bridging ceilings
 * (https://www.youtube.com/watch?v=W8FbHTcB05w): the hole's top layers are
 * progressively narrowed rectangles, so an FDM printer bridges each layer
 * over the one below instead of drooping over a circle. The magnet pocket
 * grows by the bridge layers' height so the nominal 2.4 mm stays clear.
 *
 * `crushRibs` reproduces upstream `ribbed_cylinder()`: the magnet bore's
 * radius follows a sine wave between the rib waist (⌀5.9) and the nominal
 * bore (⌀6.5), leaving eight inward lobes the magnet crushes on insertion —
 * a press fit with no glue. The Gridfinity Refined hole remains unported.
 * Deviations from upstream (dropped ±0.02 TOLLERANCE padding, fixed band
 * orientation) are in UPSTREAM.md.
 */

export interface HoleOptions {
  /** ⌀6.5 mm × 2.4 mm magnet pocket. */
  magnet: boolean;
  /** ⌀3 mm screw hole through the full base height. */
  screw: boolean;
  /** Sequential-bridging ceilings so hole tops print without supports. */
  supportless: boolean;
  /** 45° entry chamfer (+0.8 mm radius) on the bottom face. */
  chamfer: boolean;
  /** Sinusoidal crush ribs in the magnet bore for a glue-free press fit. */
  crushRibs?: boolean;
}

export const NO_HOLES: HoleOptions = {
  magnet: false,
  screw: false,
  supportless: false,
  chamfer: false,
  crushRibs: false,
};

/** The UI default when holes are enabled: printable ceilings, no chamfer. */
export function holeOptionsFromSpec(spec: {
  magnetHoles: boolean;
  screwHoles: boolean;
  magnetCrushRibs?: boolean;
}): HoleOptions {
  return {
    magnet: spec.magnetHoles,
    screw: spec.screwHoles,
    supportless: spec.magnetHoles || spec.screwHoles,
    chamfer: false,
    crushRibs: spec.magnetHoles && (spec.magnetCrushRibs ?? false),
  };
}

export function hasHoles(options: HoleOptions): boolean {
  return options.magnet || options.screw;
}

/**
 * Sequential-bridging stack: the top `layers` layers of a hole of
 * `outerRadius`, each an axis-aligned rectangle intersected with the hole's
 * cylinder, narrowing from the full diameter down to `innerDiameter` and
 * alternating direction — upstream `make_hole_printable()` built as a
 * positive instead of a double negative.
 *
 * Returns the pieces for z ∈ [ceilingZ, ceilingZ + layers·LAYER_HEIGHT].
 */
function bridgedCeiling(
  kernel: Kernel,
  outerRadius: number,
  innerDiameter: number,
  ceilingZ: number,
  layers: number,
  circularSegments: number,
): Manifold[] {
  const { Manifold, arena } = kernel;
  const outerDiameter = 2 * outerRadius;
  const calculationLayers = Math.max(layers - 1, 1);
  const perLayerDifference = (outerDiameter - innerDiameter) / calculationLayers;

  // Each piece dips half a layer into the piece below it. Footprints nest
  // (layer k ⊆ layer k−1 ⊆ the hole cylinder), so the overlap changes no
  // geometry — but a union of merely *abutting* pieces welds only where the
  // touching faces share vertices, and these box faces share none; without
  // the overlap the layers come out as separate shells and the subtraction
  // leaves sealed voids in the ceiling.
  const overlap = LAYER_HEIGHT / 2;

  const pieces: Manifold[] = [];
  for (let layer = 1; layer <= layers; layer++) {
    const isLast = layer === layers && layers > 1;
    // Bands run the full remaining width one way and narrow the other; the
    // final layer is the inner square.
    const along = outerDiameter - perLayerDifference * (layer - 1);
    const across = isLast ? along : outerDiameter - perLayerDifference * layer;
    const size: [number, number] =
      isLast || layer % 2 === 1 ? [along, across] : [across, along];

    const bottom = ceilingZ + (layer - 1) * LAYER_HEIGHT - overlap;
    const height = LAYER_HEIGHT + overlap;
    const slab = arena.track(
      arena
        .track(Manifold.cube([size[0], size[1], height], true))
        .translate([0, 0, bottom + height / 2]),
    );
    const cylinder = arena.track(
      arena
        .track(Manifold.cylinder(height, outerRadius, outerRadius, circularSegments))
        .translate([0, 0, bottom]),
    );
    pieces.push(arena.track(slab.intersect(cylinder)));
  }
  return pieces;
}

/**
 * The crush-rib bore cross-section, upstream `ribbed_circle()`:
 * r(θ) = waist + range·(1 + sin(ribs·θ)) with range = (bore − waist)/2, so
 * the radius oscillates between the rib waist and the nominal bore with
 * `ribs` inward lobes. Sampled at a multiple of the rib count so every lobe
 * gets the same vertices and the seam closes cleanly.
 */
export function ribbedCirclePolygon(
  outerRadius: number,
  innerRadius: number,
  ribs: number,
  circularSegments: number,
): [number, number][] {
  const range = (outerRadius - innerRadius) / 2;
  const offset = innerRadius + range;
  const samples = ribs * Math.max(8, Math.ceil(circularSegments / ribs));
  const points: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const theta = (2 * Math.PI * i) / samples;
    const radius = offset + range * Math.sin(ribs * theta);
    points.push([radius * Math.cos(theta), radius * Math.sin(theta)]);
  }
  return points;
}

/** 45° entry cone at z = 0, capped at the given height. */
function entryChamfer(
  kernel: Kernel,
  holeRadius: number,
  maxHeight: number,
  circularSegments: number,
): Manifold {
  const { Manifold, arena } = kernel;
  const baseRadius = holeRadius + CHAMFER_ADDITIONAL_RADIUS;
  const height = Math.min(maxHeight, baseRadius);
  return arena.track(
    Manifold.cylinder(height, baseRadius, baseRadius - height, circularSegments),
  );
}

/**
 * One hole cluster (magnet and/or screw) at the origin, opening downward from
 * z = 0. Returns null when no hole type is enabled.
 */
export function baseHoleCutter(
  kernel: Kernel,
  options: HoleOptions,
  circularSegments: number,
): Manifold | null {
  const { Manifold, arena } = kernel;
  if (!hasHoles(options)) return null;

  const pieces: Manifold[] = [];

  if (options.magnet) {
    // Extra layers make room for the bridged ceiling above the nominal depth.
    const extraLayers = options.supportless ? (options.screw ? 2 : 3) : 0;
    const depth = MAGNET_HOLE_DEPTH + extraLayers * LAYER_HEIGHT;

    /** The bore up to `height`: ribbed for a press fit, plain otherwise. */
    const bore = (height: number): Manifold => {
      if (!options.crushRibs) {
        return arena.track(
          Manifold.cylinder(height, MAGNET_HOLE_RADIUS, MAGNET_HOLE_RADIUS, circularSegments),
        );
      }
      const section = arena.track(
        new kernel.CrossSection([
          ribbedCirclePolygon(
            MAGNET_HOLE_RADIUS,
            MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS,
            MAGNET_HOLE_CRUSH_RIB_COUNT,
            circularSegments,
          ),
        ]),
      );
      return arena.track(section.extrude(height));
    };

    if (options.supportless) {
      const ceilingZ = depth - extraLayers * LAYER_HEIGHT;
      pieces.push(
        bore(ceilingZ),
        ...bridgedCeiling(
          kernel,
          MAGNET_HOLE_RADIUS,
          options.screw ? 2 * SCREW_HOLE_RADIUS : 2,
          ceilingZ,
          extraLayers,
          circularSegments,
        ),
      );
    } else {
      pieces.push(bore(depth));
    }
    if (options.chamfer) {
      pieces.push(entryChamfer(kernel, MAGNET_HOLE_RADIUS, MAGNET_HOLE_DEPTH, circularSegments));
    }
  }

  if (options.screw) {
    const depth = BASE_HEIGHT;
    if (options.supportless) {
      const layers = 3;
      const ceilingZ = depth - layers * LAYER_HEIGHT;
      pieces.push(
        arena.track(
          Manifold.cylinder(ceilingZ, SCREW_HOLE_RADIUS, SCREW_HOLE_RADIUS, circularSegments),
        ),
        ...bridgedCeiling(kernel, SCREW_HOLE_RADIUS, 1, ceilingZ, layers, circularSegments),
      );
    } else {
      pieces.push(
        arena.track(
          Manifold.cylinder(depth, SCREW_HOLE_RADIUS, SCREW_HOLE_RADIUS, circularSegments),
        ),
      );
    }
    if (options.chamfer && !options.magnet) {
      pieces.push(entryChamfer(kernel, SCREW_HOLE_RADIUS, depth, circularSegments));
    }
  }

  return arena.track(Manifold.union(pieces));
}

/**
 * Every hole cluster for a whole base: four per cell, centred
 * `HOLE_DISTANCE_FROM_BOTTOM_EDGE` in from the bottom footprint's edges
 * (upstream `_base_holes()`: 13 mm from each cell centre, 26 mm apart —
 * the gridfinity.xyz spec grid). Returns null when no holes are enabled.
 */
export function baseHoleCutters(
  kernel: Kernel,
  grid: GridSize,
  options: HoleOptions,
  circularSegments: number,
): Manifold | null {
  const { Manifold, arena } = kernel;
  // Fractional sockets are too small for this four-per-cell pattern. Upstream
  // switches to a separate corner-only layout; until that is ported, the
  // validator warns and the geometry stays solid rather than overlapping
  // cutters into a corrupt base.
  if (grid.gridPitch && grid.gridPitch !== "full") return null;
  const cluster = baseHoleCutter(kernel, options, circularSegments);
  if (cluster === null) return null;

  const offset = baseBottomDimensionsMm() / 2 - HOLE_DISTANCE_FROM_BOTTOM_EDGE; // 13
  const pieces: Manifold[] = [];
  for (let i = 0; i < grid.gridX; i++) {
    for (let j = 0; j < grid.gridY; j++) {
      const cellX = (i - (grid.gridX - 1) / 2) * GRID_DIMENSIONS_MM;
      const cellY = (j - (grid.gridY - 1) / 2) * GRID_DIMENSIONS_MM;
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ] as const) {
        pieces.push(
          arena.track(cluster.translate([cellX + sx * offset, cellY + sy * offset, 0])),
        );
      }
    }
  }
  return arena.track(Manifold.union(pieces));
}
