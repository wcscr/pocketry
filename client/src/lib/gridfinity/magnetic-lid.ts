import type { Manifold } from "manifold-3d";
import type { BinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT, BASE_BOTTOM_RADIUS, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, STACKING_LIP_DEPTH, STACKING_LIP_LINE, D_WALL, MAGNET_HOLE_DEPTH, binFootprintMm, binHeightMm, baseBottomDimensionsMm } from "@shared/gridfinity/standard";
import { LID_SKIRT_WALL_MM, LID_RIM_INSET_MM, LID_RIM_WALL_MM, LID_OVERLAP_MM, LID_SHOULDER_GAP_MM, hasOverlappingLid, hasFrictionLid, lidFitAdjustmentMm, LID_FRICTION_INTERFERENCE_MM, lidCapTopMm, lidBottomMm, LID_CLEARANCE_MM, LID_PAD_DEPTH_MM, LID_PAD_EXTENT_MM, lidMagnetCenters, magneticLidError } from "@shared/gridfinity/magnetic-lid";
import type { Kernel } from "@/lib/manifold/runtime";
import { baseHoleCutter } from "./holes";
import { roundedRectPolygon, baseProfilePolygon, type ProfilePolygon } from "./profiles";
import { buildStackingLip } from "./wall";
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
  const bore = baseHoleCutter(kernel, { magnet: true, screw: false, supportless: false, chamfer: false, crushRibs: spec.lidMagnetCrushRibs }, segments)!;
  return arena.track(Manifold.union(lidMagnetCenters(spec).map(({ x, y }) =>
    arena.track(bore.translate([x, y, bottomZ])),
  )));
}

/** Called after the wall, fill, and label tab are fused so none can refill a recess. */
export function addLidRetention(kernel: Kernel, spec: BinSpec, solid: Manifold, segments: number): Manifold {
  const { arena } = kernel;
  let supported = spec.lidMagnetHoles ? arena.track(solid.add(buildLidSupports(kernel, spec, segments))) : solid;
  if (hasOverlappingLid(spec)) supported = formInsetRim(kernel, spec, supported, segments);
  if (!spec.lidMagnetHoles) return supported;
  return arena.track(supported.subtract(lidBores(kernel, spec, segments, binHeightMm(spec.heightUnits) - MAGNET_HOLE_DEPTH)));
}

/** Replaces the upper outside wall with a supported, inward-stepped rim. */
function formInsetRim(kernel: Kernel, spec: BinSpec, solid: Manifold, segments: number): Manifold {
  const { arena } = kernel;
  const shoulder = binHeightMm(spec.heightUnits) - LID_OVERLAP_MM;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const neck = arena.track(new kernel.CrossSection([roundedRectPolygon(width - 2 * LID_RIM_INSET_MM, length - 2 * LID_RIM_INSET_MM, BASE_TOP_RADIUS - LID_RIM_INSET_MM, segments)]));
  // Cut beyond every wall facet: the layout outline and swept wall can have
  // slightly different tessellation, so an outline-sized cutter leaves slivers.
  const oversized = arena.track(kernel.CrossSection.square([width + 2, length + 2], true));
  const removed = arena.track(arena.track(arena.track(oversized.subtract(neck)).extrude(LID_OVERLAP_MM + 0.1)).translate([0, 0, shoulder]));
  return arena.track(arena.track(solid.subtract(removed)).add(buildInsetLidRim(kernel, spec, segments)));
}

/** The overlap rim is also reserved against pocket and finger-access cutters. */
export function buildInsetLidRim(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const { arena } = kernel;
  const shoulder = binHeightMm(spec.heightUnits) - LID_OVERLAP_MM;
  const r = BASE_TOP_RADIUS;
  const inside = r - LID_RIM_INSET_MM - LID_RIM_WALL_MM;
  const support = LID_RIM_INSET_MM + LID_RIM_WALL_MM - D_WALL;
  const rim = sweepRounded(kernel, [
    [r - D_WALL, -support], [r, -support], [r, 0],
    [r - LID_RIM_INSET_MM, 0], [r - LID_RIM_INSET_MM, LID_OVERLAP_MM - 0.4],
    [r - LID_RIM_INSET_MM - 0.4, LID_OVERLAP_MM], [inside, LID_OVERLAP_MM], [inside, 0],
  ], {
    widthMm: binFootprintMm(spec.gridX, spec.gridPitch) - 2 * r,
    lengthMm: binFootprintMm(spec.gridY, spec.gridPitch) - 2 * r,
  }, segments);
  return arena.track(rim.translate([0, 0, shoulder]));
}

/** A cap with a continuous thin skirt and a chamfered entry, without local edge cutouts. */
function buildOverlappingLid(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const { arena } = kernel;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const outer = arena.track(new kernel.CrossSection([roundedRectPolygon(width, length, BASE_TOP_RADIUS, segments)]));
  const bottom = -LID_OVERLAP_MM + LID_SHOULDER_GAP_MM;
  const r = BASE_TOP_RADIUS;
  const friction = hasFrictionLid(spec);
  const inner = r - LID_SKIRT_WALL_MM - (friction ? 0 : lidFitAdjustmentMm(spec));
  // The ridge envelope is clipped into spaced ribs below. The thin skirt
  // behind and between them remains continuous, with clearance at the corners.
  const contact = r - LID_RIM_INSET_MM - LID_FRICTION_INTERFERENCE_MM - lidFitAdjustmentMm(spec);
  const innerEdge: ProfilePolygon = friction ? [
    [inner, bottom + 2.4], [contact, bottom + 1.6],
    [contact, bottom + 1.2], [inner, bottom + 0.5],
  ] : [];
  const skirtProfile: ProfilePolygon = [
    [inner + 0.3, bottom], [r, bottom], [r, 0],
    [inner, 0], [inner, bottom + 0.3],
  ];
  const path = { widthMm: width - 2 * r, lengthMm: length - 2 * r };
  let skirt = sweepRounded(kernel, skirtProfile, path, segments);
  if (friction) {
    const grip = sweepRounded(kernel, [...skirtProfile.slice(0, 4), ...innerEdge, skirtProfile[4]], path, segments);
    skirt = addFrictionRibs(kernel, spec, skirt, grip, segments);
  }
  const capTop = lidCapTopMm(spec);
  return arena.track(arena.track(outer.extrude(capTop)).add(skirt));
}

/** Hollow locating skirt: a thin continuous wall can flex around the inset opening. */
function buildFrictionInsetLid(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const { arena, CrossSection } = kernel;
  const r = BASE_TOP_RADIUS;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  // Match the bin's actual straight inner face, including Gridfinity's built-in
  // clearance. Merely reducing the old extra clearance never makes contact.
  const contact = r - STACKING_LIP_DEPTH + STACKING_LIP_LINE[1][0]
    + LID_FRICTION_INTERFERENCE_MM + lidFitAdjustmentMm(spec);
  const capRadius = r - LID_CLEARANCE_MM;
  const outside = (radius: number): ProfilePolygon => [
    [0.9, 0], [radius, 0.9], [radius, 1.6],
    [1.6, 2.4], [1.6, 2.6], [capRadius, 4.45], [capRadius, BASE_PROFILE_HEIGHT],
  ];
  const smoothOutside = outside(1.6);
  const inside = smoothOutside.map(([x, z]): [number, number] => [x - LID_SKIRT_WALL_MM, z]).reverse();
  const path = { widthMm: width - 2 * r, lengthMm: length - 2 * r };
  const smooth = sweepRounded(kernel, [...smoothOutside, ...inside], path, segments);
  const grip = sweepRounded(kernel, [...outside(contact), ...inside], path, segments);
  const skirt = addFrictionRibs(kernel, spec, smooth, grip, segments);
  const capSection = arena.track(new CrossSection([roundedRectPolygon(
    width - 2 * LID_CLEARANCE_MM, length - 2 * LID_CLEARANCE_MM, capRadius, segments,
  )]));
  const cap = arena.track(arena.track(capSection.extrude(lidCapTopMm(spec) - BASE_PROFILE_HEIGHT)).translate([0, 0, BASE_PROFILE_HEIGHT]));
  return arena.track(skirt.add(cap));
}

/** Rounded contact patches on the mating face only; no cuts through the visible edge. */
function addFrictionRibs(kernel: Kernel, spec: BinSpec, smooth: Manifold, grip: Manifold, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const bottom = lidBottomMm(spec) - 0.1;
  const mask = arena.track(Manifold.cylinder(lidCapTopMm(spec) - bottom, 3, 3, segments));
  const masks: Manifold[] = [];
  for (const angle of [0, 90, 180, 270]) {
    const span = (angle % 180 === 0 ? width : length) - 2 * BASE_TOP_RADIUS;
    const halfDepth = (angle % 180 === 0 ? length : width) / 2;
    // Keep contact away from stiff corners; longer walls get repeated ribs.
    const usable = Math.max(0, span - 16);
    const count = Math.max(1, Math.ceil(usable / 24));
    for (let index = 0; index < count; index++) {
      const along = count === 1 ? 0 : usable * (index / (count - 1) - 0.5);
      masks.push(arena.track(arena.track(mask.translate([along, halfDepth - 2.6, bottom])).rotate([0, 0, angle])));
    }
  }
  const patches = arena.track(grip.intersect(arena.track(Manifold.union(masks))));
  return arena.track(smooth.add(patches));
}

/** Lid in closed orientation: z=0 is the magnet mating face. */
export function buildMagneticLid(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  assertLid(spec);
  const { arena, Manifold, CrossSection } = kernel;
  let lid: Manifold;
  if (hasOverlappingLid(spec)) {
    lid = buildOverlappingLid(kernel, spec, segments);
  } else if (hasFrictionLid(spec)) {
    lid = buildFrictionInsetLid(kernel, spec, segments);
  } else {
    const clearance = LID_CLEARANCE_MM - lidFitAdjustmentMm(spec);
    const width = binFootprintMm(spec.gridX, spec.gridPitch) - 2 * clearance;
    const length = binFootprintMm(spec.gridY, spec.gridPitch) - 2 * clearance;
    const bottomW = baseBottomDimensionsMm(width);
    const bottomL = baseBottomDimensionsMm(length);
    const edge = sweepRounded(kernel, baseProfilePolygon(), {
      widthMm: bottomW - 2 * BASE_BOTTOM_RADIUS,
      lengthMm: bottomL - 2 * BASE_BOTTOM_RADIUS,
    }, segments);
    const fill = arena.track(arena.track(Manifold.cube([bottomW - BASE_BOTTOM_RADIUS, bottomL - BASE_BOTTOM_RADIUS, BASE_PROFILE_HEIGHT], true)).translate([0, 0, BASE_PROFILE_HEIGHT / 2]));
    const capSection = arena.track(new CrossSection([roundedRectPolygon(width, length, BASE_TOP_RADIUS, segments)]));
    const cap = arena.track(arena.track(capSection.extrude(lidCapTopMm(spec) - BASE_PROFILE_HEIGHT)).translate([0, 0, BASE_PROFILE_HEIGHT]));
    lid = arena.track(Manifold.union([edge, fill, cap]));

  }
  if (spec.magneticLidTop === "stacking") {
    // A full supported lip is embedded into the cap. Four millimetres of cap
    // keep its 3.8 mm support entirely above the magnet mating face.
    const lip = buildStackingLip(kernel, { ...spec, heightUnits: 2 }, segments);
    lid = arena.track(lid.add(arena.track(lip.translate([0, 0, lidCapTopMm(spec) - 14]))));
  }
  if (spec.lidMagnetHoles) lid = arena.track(lid.subtract(lidBores(kernel, spec, segments, 0)));
  if (lid.status() !== "NoError" || lid.isEmpty()) throw new Error("Magnetic lid could not be built.");
  return lid;
}

/** Flat outer face on the bed, with the magnet recesses and any skirt facing up. */
export function magneticLidForPrint(kernel: Kernel, lid: Manifold, spec: BinSpec): Manifold {
  const { arena } = kernel;
  return spec.magneticLidTop === "stacking"
    ? arena.track(lid.translate([0, 0, -lidBottomMm(spec)]))
    : arena.track(arena.track(lid.rotate([180, 0, 0])).translate([0, 0, lidCapTopMm(spec)]));
}
