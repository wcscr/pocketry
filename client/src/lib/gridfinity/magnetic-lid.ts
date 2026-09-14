import type { Manifold } from "manifold-3d";
import type { BinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT, BASE_BOTTOM_RADIUS, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, D_WALL, MAGNET_HOLE_DEPTH, binFootprintMm, binHeightMm, baseBottomDimensionsMm } from "@shared/gridfinity/standard";
import { LID_CLEARANCE_MM, LID_PAD_DEPTH_MM, LID_PAD_EXTENT_MM, lidMagnetCenters, magneticLidError } from "@shared/gridfinity/magnetic-lid";
import type { Kernel } from "@/lib/manifold/runtime";
import { baseHoleCutter } from "./holes";
import { baseProfilePolygon } from "./profiles";
import { sweepRounded } from "./sweep";
import { footprintOuterSection } from "./footprint-section";

function assertLid(spec: BinSpec): void {
  if (!spec.magneticLid) throw new Error("Enable the magnetic lid first.");
  const error = magneticLidError(spec);
  if (error) throw new Error(error);
}

/** Corner pads grow inward at 45 degrees, ending with a solid roof below the recess. */
export function buildLidSupports(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  assertLid(spec);
  const { arena, Manifold, CrossSection } = kernel;
  const top = binHeightMm(spec.heightUnits);
  const halfW = binFootprintMm(spec.gridX, spec.gridPitch) / 2;
  const halfL = binFootprintMm(spec.gridY, spec.gridPitch) / 2;
  const slopeTop = top - LID_PAD_DEPTH_MM;
  const bottom = Math.max(BASE_HEIGHT, slopeTop - (LID_PAD_EXTENT_MM - D_WALL));
  // The part outside the footprint guarantees a joint to both rounded walls;
  // it is clipped off after the four corners have been placed.
  const outside = BASE_TOP_RADIUS + 1;
  const full = outside + LID_PAD_EXTENT_MM;
  const small = full - (slopeTop - bottom);
  const square = arena.track(CrossSection.square([small, small]));
  const slope = arena.track(square.extrude(slopeTop - bottom, 0, 0, [full / small, full / small]));
  const pad = arena.track(arena.track(Manifold.cube([full, full, LID_PAD_DEPTH_MM])).translate([0, 0, slopeTop - bottom]));
  const corner = arena.track(slope.add(pad));
  const pieces = [0, 90, 180, 270].map(angle => {
    const atOrigin = arena.track(corner.translate([-outside, -outside, bottom]));
    const rotated = arena.track(atOrigin.rotate([0, 0, angle]));
    const sx = angle === 0 || angle === 270 ? -1 : 1;
    const sy = angle === 0 || angle === 90 ? -1 : 1;
    return arena.track(rotated.translate([sx * halfW, sy * halfL, 0]));
  });
  const clip = arena.track(footprintOuterSection(kernel, spec, segments).extrude(top));
  return arena.track(arena.track(Manifold.union(pieces)).intersect(clip));
}

/** Reuse the base bore, without its downward-print bridging ceiling: these holes print facing up. */
function lidBores(kernel: Kernel, spec: BinSpec, segments: number, bottomZ: number): Manifold {
  const { arena, Manifold } = kernel;
  const bore = baseHoleCutter(kernel, { magnet: true, screw: false, supportless: false, chamfer: false }, segments)!;
  return arena.track(Manifold.union(lidMagnetCenters(spec).map(({ x, y }) =>
    arena.track(bore.translate([x, y, bottomZ])),
  )));
}

/** Called after the wall, fill, and label tab are fused so none can refill a recess. */
export function addLidRetention(kernel: Kernel, spec: BinSpec, solid: Manifold, segments: number): Manifold {
  const { arena } = kernel;
  const supported = arena.track(solid.add(buildLidSupports(kernel, spec, segments)));
  return arena.track(supported.subtract(lidBores(kernel, spec, segments, binHeightMm(spec.heightUnits) - MAGNET_HOLE_DEPTH)));
}

/**
 * Flat-topped lid in its closed orientation, z=0 at the mating face. The
 * existing base profile locates it in the stacking lip; extra 0.2 mm per
 * side clearance is independent of the shared magnet recess dimensions.
 * Original Pocketry design, assembled from the already attributed primitives.
 */
export function buildMagneticLid(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  assertLid(spec);
  const { arena, Manifold } = kernel;
  const width = binFootprintMm(spec.gridX, spec.gridPitch) - 2 * LID_CLEARANCE_MM;
  const length = binFootprintMm(spec.gridY, spec.gridPitch) - 2 * LID_CLEARANCE_MM;
  const bottomW = baseBottomDimensionsMm(width);
  const bottomL = baseBottomDimensionsMm(length);
  const edge = sweepRounded(kernel, baseProfilePolygon(), {
    widthMm: bottomW - 2 * BASE_BOTTOM_RADIUS,
    lengthMm: bottomL - 2 * BASE_BOTTOM_RADIUS,
  }, segments);
  const fill = arena.track(arena.track(Manifold.cube([bottomW - BASE_BOTTOM_RADIUS, bottomL - BASE_BOTTOM_RADIUS, BASE_PROFILE_HEIGHT], true)).translate([0, 0, BASE_PROFILE_HEIGHT / 2]));
  let lid = arena.track(edge.add(fill));
  lid = arena.track(lid.subtract(lidBores(kernel, spec, segments, 0)));
  // A shallow nail recess in the front edge, opening from underneath and
  // leaving the flat outer face intact for printing face-down.
  const notch = arena.track(arena.track(Manifold.cylinder(BASE_PROFILE_HEIGHT - 0.6, 6, 6, segments)).translate([0, -length / 2 - 3, 0]));
  lid = arena.track(lid.subtract(notch));
  if (lid.status() !== "NoError" || lid.isEmpty()) throw new Error("Magnetic lid could not be built.");
  return lid;
}

/** The flat face is on the bed and all four recesses face up: no hole ceilings to bridge. */
export function magneticLidForPrint(kernel: Kernel, lid: Manifold): Manifold {
  const { arena } = kernel;
  return arena.track(arena.track(lid.rotate([180, 0, 0])).translate([0, 0, BASE_PROFILE_HEIGHT]));
}
