import type { Manifold, Vec3 } from "manifold-3d";
import type { BinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, STACKING_LIP_DEPTH, STACKING_LIP_LINE, STACKING_LIP_HEIGHT_ACTUAL, binWallThicknessMm, binFootprintMm, binHeightMm } from "@shared/gridfinity/standard";
import { INSET_LID_SKIRT_WALL_MM, overlapLidRimInsetMm, overlapLidWallMm, overlapRimWallMm, LID_OVERLAP_MM, LID_SHOULDER_GAP_MM, INSET_LID_CAP_BOTTOM_MM, hasOverlappingLid, hasFrictionLid, lidCapTopMm, lidBottomMm, LID_CLEARANCE_MM, lidPadDepthMm, lidPadExtentMm, lidMagnetCenters, magneticLidError } from "@shared/gridfinity/magnetic-lid";
import { magnetHoleDepthMm } from "@shared/gridfinity/magnets";
import type { Kernel } from "@/lib/manifold/runtime";
import { baseHoleCutter } from "./holes";
import { roundedRectPolygon, type ProfilePolygon } from "./profiles";
import { buildStackingLip } from "./wall";
import { sweepRounded } from "./sweep";
import { footprintOuterSection } from "./footprint-section";
import { usesCompliantInterface, hasSpringLatch, hasSideSprings, hasFilledOverlapLid, lidLocatingClearanceMm, lidContactPreloadMm, overlapRimCornerRadiusMm } from "@shared/gridfinity/magnetic-lid";
import { applyLidInterface, addLidDetentRecesses } from "./lid-interface";
import { lidContactRibPositions } from "@shared/gridfinity/lid-contact-ribs";

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
  const slopeTop = top - lidPadDepthMm(spec);
  const bottom = Math.max(BASE_HEIGHT, slopeTop - (lidPadExtentMm(spec) - binWallThicknessMm(spec)));
  // The part outside the footprint guarantees a joint to both rounded walls;
  // it is clipped off after the four corners have been placed.
  const outside = BASE_TOP_RADIUS + 1;
  const full = outside + lidPadExtentMm(spec);
  const small = full - (slopeTop - bottom);
  const square = arena.track(CrossSection.square([small, small]));
  const slope = arena.track(square.extrude(slopeTop - bottom, 0, 0, [full / small, full / small]));
  const pad = arena.track(arena.track(Manifold.cube([full, full, lidPadDepthMm(spec)])).translate([0, 0, slopeTop - bottom]));
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
  const bore = baseHoleCutter(kernel, { magnet: true, screw: false, supportless: false, chamfer: false, crushRibs: spec.lidMagnetCrushRibs, magnetDiameterMm: spec.magnetDiameterMm, magnetThicknessMm: spec.magnetThicknessMm }, segments)!;
  return arena.track(Manifold.union(lidMagnetCenters(spec).map(({ x, y }) =>
    arena.track(bore.translate([x, y, bottomZ])),
  )));
}

/** Called after the wall, fill, and label tab are fused so none can refill a recess. */
export function addLidRetention(kernel: Kernel, spec: BinSpec, solid: Manifold, segments: number): Manifold {
  const { arena } = kernel;
  let supported = spec.lidMagnetHoles ? arena.track(solid.add(buildLidSupports(kernel, spec, segments))) : solid;
  if (hasOverlappingLid(spec)) supported = formInsetRim(kernel, spec, supported, segments);
  supported = addLidDetentRecesses(kernel, spec, supported, segments);
  if (spec.lidMagnetHoles) supported = arena.track(supported.subtract(lidBores(kernel, spec, segments, binHeightMm(spec.heightUnits) - magnetHoleDepthMm(spec))));
  return addGripRecesses(kernel, spec, supported, segments);
}

/** Shallow access below the joint; the actual locating faces remain intact. */
function addGripRecesses(kernel: Kernel, spec: BinSpec, body: Manifold, segments: number): Manifold {
  if (!spec.lidGripRecess) return body;
  const { arena, Manifold } = kernel;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const alongX = width >= length;
  const along = alongX ? width : length;
  const face = (alongX ? length : width) / 2;
  const overlap = hasOverlappingLid(spec);
  const top = binHeightMm(spec.heightUnits) + (overlap ? -LID_OVERLAP_MM : STACKING_LIP_HEIGHT_ACTUAL);
  const depth = overlap ? Math.min(1.2, overlapLidRimInsetMm(spec) - 0.2) : 1.2;
  const bottom = overlap ? top - depth : binHeightMm(spec.heightUnits) + 2.5;
  const span = Math.min(14, along - 2 * BASE_TOP_RADIUS - 4);
  const outline = roundedRectPolygon(span, depth * 2, depth, segments);
  const scoop = arena.track(Manifold.hull([
    ...outline.map(([x, y]): Vec3 => [x, face + y, top + 0.01]),
    [-span / 2 + depth, face + 0.05, bottom], [span / 2 - depth, face + 0.05, bottom],
  ]));
  const cuts = [alongX ? 0 : 90, alongX ? 180 : 270].map(angle => arena.track(scoop.rotate([0, 0, angle])));
  return arena.track(body.subtract(arena.track(Manifold.union(cuts))));
}

/** Replaces the upper outside wall with a supported, inward-stepped rim. */
function formInsetRim(kernel: Kernel, spec: BinSpec, solid: Manifold, segments: number): Manifold {
  const { arena } = kernel;
  const shoulder = binHeightMm(spec.heightUnits) - LID_OVERLAP_MM;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  // Cut beyond every wall facet: the layout outline and swept wall can have
  // slightly different tessellation, so an outline-sized cutter leaves slivers.
  const oversized = arena.track(kernel.CrossSection.square([width + 2, length + 2], true));
  const upper = arena.track(arena.track(oversized.extrude(LID_OVERLAP_MM + 0.1)).translate([0, 0, shoulder]));
  // Trim to the complete rim envelope, including its chamfer, so original
  // wall material cannot leave raised slivers at the corners.
  const removed = arena.track(upper.subtract(overlapRimEnvelope(kernel, spec, segments)));
  return arena.track(arena.track(solid.subtract(removed)).add(buildInsetLidRim(kernel, spec, segments)));
}

/** Offset a rounded profile relative to its own mating datum. */
function lidContour(spec: BinSpec, inset: number, segments: number, datumInset: number, datumRadius: number): ProfilePolygon {
  return roundedRectPolygon(
    binFootprintMm(spec.gridX, spec.gridPitch) - 2 * inset,
    binFootprintMm(spec.gridY, spec.gridPitch) - 2 * inset,
    Math.max(0, datumRadius + datumInset - inset), segments,
  );
}

/** Exact planar transitions, including offsets greater than the outer corner radius. */
function lidLoft(kernel: Kernel, spec: BinSpec, stations: [number, number][], segments: number,
  datumInset = 0, datumRadius = BASE_TOP_RADIUS): Manifold {
  const { arena, Manifold, CrossSection } = kernel;
  const pieces: Manifold[] = [];
  for (let i = 1; i < stations.length; i++) {
    const [from, bottom] = stations[i - 1];
    const [to, top] = stations[i];
    if (from === to) {
      const section = arena.track(new CrossSection([lidContour(spec, from, segments, datumInset, datumRadius)]));
      pieces.push(arena.track(arena.track(section.extrude(top - bottom)).translate([0, 0, bottom])));
    } else {
      const points = [...lidContour(spec, from, segments, datumInset, datumRadius).map(([x, y]): Vec3 => [x, y, bottom]),
        ...lidContour(spec, to, segments, datumInset, datumRadius).map(([x, y]): Vec3 => [x, y, top])];
      pieces.push(arena.track(Manifold.hull(points)));
    }
  }
  return arena.track(Manifold.union(pieces));
}

function overlapRimEnvelope(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const shoulder = binHeightMm(spec.heightUnits) - LID_OVERLAP_MM;
  const inset = overlapLidRimInsetMm(spec);
  return lidLoft(kernel, spec, [[inset, shoulder], [inset, shoulder + LID_OVERLAP_MM - 0.4],
    [inset + 0.4, shoulder + LID_OVERLAP_MM]], segments, inset, overlapRimCornerRadiusMm(spec));
}

/** The overlap rim is also reserved against pocket and finger-access cutters. */
export function buildInsetLidRim(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const { arena } = kernel;
  const shoulder = binHeightMm(spec.heightUnits) - LID_OVERLAP_MM;
  const r = BASE_TOP_RADIUS;
  const rimInset = overlapLidRimInsetMm(spec);
  const inside = r - rimInset - overlapRimWallMm(spec);
  const support = Math.max(0, rimInset + overlapRimWallMm(spec) - binWallThicknessMm(spec));
  if (spec.lidWallThicknessMm === undefined || inside <= 0 || support === 0) {
    const bottom = Math.max(BASE_HEIGHT, shoulder - support);
    const innerInset = rimInset + overlapRimWallMm(spec);
    const lower = bottom < shoulder ? lidLoft(kernel, spec, [[0, bottom], [0, shoulder]], segments) : null;
    const upper = overlapRimEnvelope(kernel, spec, segments);
    const cavity = lidLoft(kernel, spec, [
      ...(bottom < shoulder ? [[innerInset - (shoulder - bottom), bottom] as [number, number]] : []),
      [innerInset, shoulder], [innerInset, shoulder + LID_OVERLAP_MM]], segments,
      spec.lidWallThicknessMm === undefined ? innerInset : 0);
    return arena.track((lower ? arena.track(lower.add(upper)) : upper).subtract(cavity));
  }
  const rim = sweepRounded(kernel, [
    [r - binWallThicknessMm(spec), -support], [r, -support], [r, 0],
    [r - rimInset, 0], [r - rimInset, LID_OVERLAP_MM - 0.4],
    [r - rimInset - 0.4, LID_OVERLAP_MM], [inside, LID_OVERLAP_MM], [inside, 0],
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
  const contactRibs = friction && !usesCompliantInterface(spec);
  const rimInset = overlapLidRimInsetMm(spec);
  const locatingOffset = friction ? 0 : LID_CLEARANCE_MM - lidLocatingClearanceMm(spec);
  if (spec.lidWallThicknessMm === undefined) {
    const wall = overlapLidWallMm(spec) + locatingOffset;
    const contactInset = rimInset + lidContactPreloadMm(spec);
    const envelope = lidLoft(kernel, spec, [[0, bottom], [0, 0]], segments);
    const opening = lidLoft(kernel, spec, [[wall - 0.3, bottom], [wall, bottom + 0.3], [wall, 0]],
      segments, rimInset, overlapRimCornerRadiusMm(spec));
    let skirt = arena.track(envelope.subtract(opening));
    if (contactRibs) {
      const gripOpening = lidLoft(kernel, spec, [[wall - 0.3, bottom], [wall, bottom + 0.3],
        [wall, bottom + 0.5], [contactInset, bottom + 1.2], [contactInset, bottom + 1.6],
        [wall, bottom + 2.4], [wall, 0]], segments, rimInset, overlapRimCornerRadiusMm(spec));
      skirt = addFrictionRibs(kernel, spec, skirt, arena.track(envelope.subtract(gripOpening)), segments);
    }
    return arena.track(arena.track(outer.extrude(lidCapTopMm(spec))).add(skirt));
  }
  const inner = r - overlapLidWallMm(spec) - locatingOffset;
  // The ridge envelope is clipped into spaced ribs below. The thin skirt
  // behind and between them remains continuous, with clearance at the corners.
  const contact = r - rimInset - lidContactPreloadMm(spec);
  const innerEdge: ProfilePolygon = contactRibs ? [
    [inner, bottom + 2.4], [contact, bottom + 1.6],
    [contact, bottom + 1.2], [inner, bottom + 0.5],
  ] : [];
  const skirtProfile: ProfilePolygon = [
    [inner + 0.3, bottom], [r, bottom], [r, 0],
    [inner, 0], [inner, bottom + 0.3],
  ];
  const path = { widthMm: width - 2 * r, lengthMm: length - 2 * r };
  let skirt = sweepRounded(kernel, skirtProfile, path, segments);
  if (contactRibs) {
    const grip = sweepRounded(kernel, [...skirtProfile.slice(0, 4), ...innerEdge, skirtProfile[4]], path, segments);
    skirt = addFrictionRibs(kernel, spec, skirt, grip, segments);
  }
  const capTop = lidCapTopMm(spec);
  return arena.track(arena.track(outer.extrude(capTop)).add(skirt));
}

/** Support the stacking cap from the bed, retaining its rim and magnet-pad channels. */
function overlapCenterFill(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const rimInside = overlapLidRimInsetMm(spec) + overlapRimWallMm(spec);
  const insideRadius = spec.lidWallThicknessMm === undefined ? BASE_TOP_RADIUS : Math.max(0, BASE_TOP_RADIUS - rimInside);
  const inset = rimInside + LID_CLEARANCE_MM;
  const bottom = lidBottomMm(spec);
  const fill = lidLoft(kernel, spec, [[inset + 0.3, bottom], [inset, bottom + 0.3], [inset, 0]],
    segments, rimInside, insideRadius);
  // Nonmagnetic lids also fit shared bases with the default corner magnet pads.
  // Dormant magnet-size preferences retain the standard pad envelope. Leave the
  // disabled side-spring prototype's existing enclosure floor unchanged.
  if (hasSideSprings(spec)) return fill;
  const halfW = binFootprintMm(spec.gridX, spec.gridPitch) / 2;
  const halfL = binFootprintMm(spec.gridY, spec.gridPitch) / 2;
  const extent = lidPadExtentMm(spec) + LID_CLEARANCE_MM;
  const corner = arena.track(Manifold.cube([extent, extent, -bottom + 0.1]));
  const keepouts = [-1, 1].flatMap(sx => [-1, 1].map(sy => arena.track(corner.translate([
    sx < 0 ? -halfW : halfW - extent, sy < 0 ? -halfL : halfL - extent, bottom - 0.05,
  ]))));
  return arena.track(fill.subtract(arena.track(Manifold.union(keepouts))));
}

/** Thin locating skirt, or a filled underside around working spring chambers. */
function buildFrictionInsetLid(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  const { arena, CrossSection } = kernel;
  const r = BASE_TOP_RADIUS;
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  // Match the bin's actual straight inner face, including Gridfinity's built-in
  // clearance. Merely reducing the old extra clearance never makes contact.
  const contact = r - STACKING_LIP_DEPTH + STACKING_LIP_LINE[1][0]
    + lidContactPreloadMm(spec);
  const shoulderRadius = r - LID_CLEARANCE_MM;
  const bottom = lidBottomMm(spec);
  const outside = (radius: number): ProfilePolygon => [
    [0.9 + (radius - 0.9) * bottom / 0.9, bottom], [radius, 0.9], [radius, 1.6],
    [1.6, 2.4], [1.6, 2.6], [shoulderRadius, 4.45], [shoulderRadius, BASE_PROFILE_HEIGHT],
  ];
  // Relieve the rigid corners of fin lids so the blades carry the fit.
  const smoothOutside = outside(spec.lidInterface === "angled-fins" ? 1.35 : 1.6);
  const inside = smoothOutside.map(([x, z]): [number, number] => [x - INSET_LID_SKIRT_WALL_MM, z]).reverse();
  const path = { widthMm: width - 2 * r, lengthMm: length - 2 * r };
  // Fill down to the enclosure floors for a continuous, flush underside.
  // applyLidInterface cuts the spring chambers afterward, preserving their
  // moving parts and release gaps inside this otherwise solid locator.
  const smooth = hasSpringLatch(spec) || hasSideSprings(spec) || spec.magneticLidTop === "stacking"
    ? lidLoft(kernel, spec, smoothOutside.map(([radius, z]) => [r - radius, z]), segments)
    : sweepRounded(kernel, [...smoothOutside, ...inside], path, segments);
  const grip = sweepRounded(kernel, [...outside(contact), ...inside], path, segments);
  const skirt = usesCompliantInterface(spec) ? smooth : addFrictionRibs(kernel, spec, smooth, grip, segments);
  const capSection = arena.track(new CrossSection([roundedRectPolygon(
    width, length, r, segments,
  )]));
  const cap = arena.track(arena.track(capSection.extrude(lidCapTopMm(spec) - INSET_LID_CAP_BOTTOM_MM)).translate([0, 0, INSET_LID_CAP_BOTTOM_MM]));
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
    const halfDepth = (angle % 180 === 0 ? length : width) / 2;
    for (const along of lidContactRibPositions(spec, angle % 180 === 0 ? "x" : "y")) {
      masks.push(arena.track(arena.track(mask.translate([along, halfDepth - 2.6, bottom])).rotate([0, 0, angle])));
    }
  }
  const patches = arena.track(grip.intersect(arena.track(Manifold.union(masks))));
  return arena.track(smooth.add(patches));
}

/** Lid in closed orientation: z=0 is the magnet mating face. */
export function buildMagneticLid(kernel: Kernel, spec: BinSpec, segments: number): Manifold {
  assertLid(spec);
  const { arena, CrossSection } = kernel;
  let lid: Manifold;
  if (hasOverlappingLid(spec)) {
    lid = buildOverlappingLid(kernel, spec, segments);
    if (hasFilledOverlapLid(spec)) lid = arena.track(lid.add(overlapCenterFill(kernel, spec, segments)));
  } else if (hasFrictionLid(spec)) {
    lid = buildFrictionInsetLid(kernel, spec, segments);
  } else {
    const clearance = lidLocatingClearanceMm(spec);
    const width = binFootprintMm(spec.gridX, spec.gridPitch);
    const length = binFootprintMm(spec.gridY, spec.gridPitch);
    const faceRadius = BASE_TOP_RADIUS - STACKING_LIP_DEPTH + STACKING_LIP_LINE[1][0] - clearance;
    const locator = lidLoft(kernel, spec, [[BASE_TOP_RADIUS - 0.9, 0],
      [BASE_TOP_RADIUS - faceRadius, 0.9], [BASE_TOP_RADIUS - faceRadius, 2.5],
      [BASE_TOP_RADIUS - faceRadius - (INSET_LID_CAP_BOTTOM_MM - 2.5), INSET_LID_CAP_BOTTOM_MM]], segments);
    const capSection = arena.track(new CrossSection([roundedRectPolygon(width, length, BASE_TOP_RADIUS, segments)]));
    // Extend the cap down around the locator. Moving the whole lid down would
    // collide with existing bin pads and misalign the paired magnet faces.
    const cap = arena.track(arena.track(capSection.extrude(lidCapTopMm(spec) - INSET_LID_CAP_BOTTOM_MM)).translate([0, 0, INSET_LID_CAP_BOTTOM_MM]));
    lid = arena.track(locator.add(cap));
  }
  if (spec.magneticLidTop === "stacking") {
    // A full supported lip is embedded into the cap. Four millimetres of cap
    // keep its 3.8 mm support entirely above the magnet mating face.
    const lip = buildStackingLip(kernel, { ...spec, heightUnits: 2 }, segments);
    lid = arena.track(lid.add(arena.track(lip.translate([0, 0, lidCapTopMm(spec) - 14]))));
  }
  if (spec.lidMagnetHoles) lid = arena.track(lid.subtract(lidBores(kernel, spec, segments, 0)));
  lid = applyLidInterface(kernel, spec, lid, segments);
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
