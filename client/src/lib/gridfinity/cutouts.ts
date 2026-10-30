import { pocketColorAxis, pocketColorLocalAxis } from "@shared/gridfinity/pocket-color";
import { outsetColorBands, extrudeColorBands, sweepColorBands, floorColorMask } from "./pocket-color";
import { pegBottomExtensionMm } from "@shared/gridfinity/peg-bottom";
// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold, Vec2 } from "manifold-3d";
import { hasPocketTilt, pocketAxis } from "@shared/gridfinity/pocket-orientation";
import { hasRigidPocket, pocketRotation, rigidPocket, migrateProfilePocket } from "@shared/gridfinity/rigid-pocket";
import { pocketInsertionAxis, pocketInsertionError } from "@shared/gridfinity/pocket-insertion";
import { rotateObjectVector } from "@shared/gridfinity/object-pose";
import { buildObjectCavity } from "./object-cavity";
import { directionalInsertionCutter } from "./insertion-sweep";
import type { PocketInsertionPath } from "./validate-insertion-paths";
import { clipExtrusionBands, planarInsertionCutter } from "./planar-insertion-sweep";

import {
  effectiveDeepScoopDepthMm,
  effectiveFingerHoleDepthMm,
  effectiveFingerHoleTopFilletMm,
  effectiveFingerHoleBottomFilletMm,
  effectiveFingerHoleCornerRoundMm,
  flatEndedScoopRadiusMm,
  effectiveScoopDepthMm,
  fingerHoleFootprintRing,
  fingerHoleCircularSegments,
  FINGER_HOLE_PREVIEW_CHORD_TOLERANCE_MM,
  elongatedFingerHoleEndpoints,
  isElongatedFingerHole,
  hasFlatFingerHoleBottom,
  resolvePocketDepth,
  resolvePlacedPocketDepth,
  pocketName,
  transformOutlinePlacement,
  transformPointPlacement,
  type CutoutPlacement, type DepthSpec,
  type FingerHole,
  type ResolvedPocket,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { LAYER_HEIGHT } from "@shared/gridfinity/standard";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import type { BinSpec } from "@shared/gridfinity/types";
import type { ValidationIssue } from "@shared/gridfinity/validate";
import type { Outline, Ring } from "@shared/geometry/types";

import { toCrossSection } from "@/lib/geometry/offset";
import { simplifyRing } from "@/lib/geometry/simplify";
import type { Kernel } from "@/lib/manifold/runtime";

import type { BuildQuality } from "./bin";
import { buildProfileBottomCutout } from "./profile-bottom";
import { buildRoundedFingerAccessCutter } from "./finger-access-rounding";
import {
  bottomFilletCutter,
  type ExtrusionBand,
  FILLET_PROFILE_STEP_MM,
  topEdgeFilletCutter,
} from "./fillet-stack";

/**
 * Turns placed traced shapes into pocket cutters. Per cutout, in order:
 *
 *  1. vertex budget — traced outlines carry hundreds of points; RDP each
 *     ring down to the quality's budget (the count is surfaced in the UI so
 *     the trade-off stays legible, per the design doc);
 *  2. placement transform (mirror → rotate → translate, shared math);
 *  3. signed clearance offset with round joins — clearance runs BEFORE corner
 *     rounding on purpose: a 1 mm slot is 1.8 mm wide after clearance, but
 *     rounding first at r = 1 would erase it before clearance could save it;
 *  4. corner rounding as `−r` then `+r` round offsets (2D vertical-edge
 *     fillet), with `simplify` after every offset per manifold's guidance;
 *  5. a collapsed cross-section is *reported*, not thrown — narrow features
 *     legitimately vanish under offsets and the UI must say so;
 *  6. blind pockets extrude via the K-slice stepped bottom fillet; through
 *     cuts are plain extrusions with headroom below the bin and above the
 *     lip so both mouths stay open;
 *  7. an optional outward K-slice flare rounds the contour into the top
 *     surface without changing the vertical wall below it.
 *
 * Finger access features are built separately in the bin frame. Round scoops use
 * spherical caps, while deep scoops use straight vertical shafts ending in
 * rounded bottoms. The oblong version ends in a swept hemisphere
 * (half-cylinder plus rounded ends). Full spheres and cylinders overlap inside
 * the shafts for robust, watertight unions.
 *
 * Everything is tracked in `kernel.arena`; the caller owns disposal.
 */

/** Post-offset cleanup epsilon, same value the outline offsetter uses. */
const CLEANUP_EPSILON = 1e-6;

/** Escalating RDP tolerances start here (mm) and grow ×1.5 per attempt. */
const BUDGET_START_TOLERANCE_MM = 0.05;
const BUDGET_MAX_ATTEMPTS = 8;

export interface CutoutBuildReport {
  id: string;
  /** True when the cross-section collapsed under clearance/corner offsets. */
  emptied: boolean;
}

/**
 * Simplifies every ring of an outline to at most `maxRingVertices` points,
 * escalating the tolerance until it fits. Pure; also used by the panel to
 * show per-quality vertex counts.
 */
export function budgetOutline(outline: Outline, maxRingVertices: number): Outline {
  const budgetRing = (ring: Ring): Ring => {
    if (ring.length <= maxRingVertices) return ring;
    let tolerance = BUDGET_START_TOLERANCE_MM;
    let best = ring;
    for (let attempt = 0; attempt < BUDGET_MAX_ATTEMPTS; attempt++) {
      best = simplifyRing(ring, tolerance);
      if (best.length <= maxRingVertices) return best;
      tolerance *= 1.5;
    }
    return best;
  };
  return outline.map((shape) => ({
    outer: budgetRing(shape.outer),
    holes: shape.holes.map(budgetRing),
  }));
}

/** Total vertex count after budgeting — for the panel's count display. */
export function budgetedPointCount(outline: Outline, maxRingVertices: number): number {
  const budgeted = budgetOutline(outline, maxRingVertices);
  return budgeted.reduce(
    (sum, shape) =>
      sum + shape.outer.length + shape.holes.reduce((h, hole) => h + hole.length, 0),
    0,
  );
}

export interface CutoutCutters {
  cutters: Manifold[];
  /** Only explicitly through sections, before mixing with blind seats. */
  throughCutters?: Manifold[];
  /** Optional printable material immediately below each blind pocket floor. */
  floorInserts: Manifold[];
  /** Full subtraction regions for stable body partitioning; defaults to the bands. */
  floorRegions?: Manifold[];
  reports: CutoutBuildReport[];
  /** Actual top-rounding depth; pocket color starts below this band. */
  topFilletRadiusMm?: number;
  validationIssues?: ValidationIssue[];
  cutterGroups?: { id: string; cutters: Manifold[] }[];
  /** Original retained volumes, for checking the connectivity of the finished bin. */
  retainedGroups?: { id: string; volumes: Manifold[] }[];
  /** Continuous vertical insertion paths before floor limits or retained masks. */
  insertionPaths?: PocketInsertionPath[];
}

export interface CutoutBuildOptions {
  /** Builds this much solid material below each flat blind-pocket floor. */
  floorInsertThicknessMm?: number;
  /** Internal axial frame: extend the shaft enough to clear the real bin. */
  axialHeadroomMm?: number;
  /** Internal capture of the finite source before posing or insertion clearance. */
  sourceBands?: ExtrusionBand[];
  /** Internal material mask; never used for the actual cavity or validation. */
  colorOutsetMm?: number;
  /** Restrict the material mask's expansion to this local supporting axis. */
  colorAxis?: "x" | "y" | "z";
}

const BIN_LOCAL_PLACEMENT = {
  position: { x: 0, y: 0 },
  rotationDeg: 0,
  mirrored: false,
} as const;

/**
 * Radius of the sphere whose cap of height `h` has rim radius `a`:
 * R = (a² + h²) / 2h. At the top surface the cut is exactly the validated
 * `diameterMm` circle.
 */
export function scoopSphereRadiusMm(
  scoop: Pick<FingerHole, "diameterMm" | "depthMm">,
): number {
  const a = scoop.diameterMm / 2;
  const h = effectiveScoopDepthMm(scoop);
  return (a * a + h * h) / (2 * h);
}

/** One spherical cap below the top surface, centred in bin-local XY. */
function buildScoopCapAt(
  kernel: Kernel,
  scoop: FingerHole,
  centre: { x: number; y: number },
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena, Manifold: M } = kernel;
  const depth = effectiveScoopDepthMm(scoop);
  const sphereRadius = scoopSphereRadiusMm(scoop);
  const sphereCentreZ = pocket.infillTopZ + sphereRadius - depth;

  const sphere = arena.track(
    arena.track(M.sphere(sphereRadius, segments)).translate([
      centre.x,
      centre.y,
      sphereCentreZ,
    ]),
  );
  // Keep only the cap below the top surface: an intersection with a box has
  // no half-space semantics to get wrong.
  const keepBelow = arena.track(
    arena
      .track(
        M.cube(
          [2 * sphereRadius + 2, 2 * sphereRadius + 2, depth + 1],
          false,
        ),
      )
      .translate([
        centre.x - sphereRadius - 1,
        centre.y - sphereRadius - 1,
        pocket.infillTopZ - depth - 1,
      ]),
  );
  return arena.track(sphere.intersect(keepBelow));
}

/** Vertical mouth matching the exact plan-view rim and clearing any lip. */
function buildScoopMouth(
  kernel: Kernel,
  scoop: FingerHole,
  placement: Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored">,
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena } = kernel;
  const ring = fingerHoleFootprintRing(scoop, placement, segments);
  const section = toCrossSection(kernel, [{ outer: ring, holes: [] }]);

  // The mouth above the top surface is the exact round rim, extended
  // a half-layer down into the dish so the union overlaps volumetrically.
  const mouthBottomZ = pocket.infillTopZ - LAYER_HEIGHT / 2;
  return arena.track(
    arena.track(section.extrude(pocket.cutterTopZ - mouthBottomZ)).translate([
      0,
      0,
      mouthBottomZ,
    ]),
  );
}

/** Round, top-surface spherical-cap cutter. */
function buildRoundScoopCutter(
  kernel: Kernel,
  scoop: FingerHole,
  placement: Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored">,
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena } = kernel;
  const centre = transformPointPlacement(scoop.center, placement);
  const mouth = buildScoopMouth(kernel, scoop, placement, pocket, segments);
  const cap = buildScoopCapAt(kernel, scoop, centre, pocket, segments);
  return arena.track(cap.add(mouth));
}

/** Straight cylindrical shaft with an exposed hemispherical bottom. */
function buildDeepScoopCutter(
  kernel: Kernel,
  scoop: FingerHole,
  placement: Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored">,
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena, Manifold: M } = kernel;
  const centre = transformPointPlacement(scoop.center, placement);
  const radius = scoop.diameterMm / 2;
  const totalDepth = effectiveDeepScoopDepthMm(scoop);
  const sphereCentreZ = pocket.infillTopZ - totalDepth + radius;
  const sphere = arena.track(
    arena.track(M.sphere(radius, segments)).translate([
      centre.x,
      centre.y,
      sphereCentreZ,
    ]),
  );
  const ring = fingerHoleFootprintRing(scoop, placement, segments);
  const section = toCrossSection(kernel, [{ outer: ring, holes: [] }]);
  const shaft = arena.track(
    arena.track(section.extrude(pocket.cutterTopZ - sphereCentreZ)).translate([
      0,
      0,
      sphereCentreZ,
    ]),
  );
  // The sphere's upper half is contained inside the shaft, giving the union
  // volumetric overlap while exposing exactly its lower hemisphere.
  return arena.track(shaft.add(sphere));
}

/**
 * A shallow circular segment swept between flat ends. Sampling only the exposed
 * arc keeps even a wide, 1 mm-deep channel smooth and its mouth dimensions exact.
 */
function buildShallowFlatEndedScoopCutter(
  kernel: Kernel,
  scoop: FingerHole,
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena } = kernel;
  const { start, lengthMm } = elongatedFingerHoleEndpoints(scoop);
  const radius = flatEndedScoopRadiusMm(scoop);
  const halfWidth = scoop.diameterMm / 2;
  const halfAngle = Math.asin(halfWidth / radius);
  const arcSteps = Math.max(8, Math.ceil(segments / 4) * 2);
  const profile: Ring = [];
  for (let i = 0; i <= arcSteps; i++) {
    const angle = -halfAngle + (2 * halfAngle * i) / arcSteps;
    profile.push({
      x: radius * Math.sin(angle),
      y: 2 * radius * Math.sin(angle / 2) ** 2 - scoop.depthMm,
    });
  }
  // Exact rim corners and deepest point also avoid accumulated trig error.
  profile[0] = { x: -halfWidth, y: 0 };
  profile[arcSteps / 2] = { x: 0, y: -scoop.depthMm };
  profile[arcSteps] = { x: halfWidth, y: 0 };
  const headroom = pocket.cutterTopZ - pocket.infillTopZ;
  profile.push({ x: halfWidth, y: headroom }, { x: -halfWidth, y: headroom });
  const section = toCrossSection(kernel, [{ outer: profile, holes: [] }]);
  let cutter = arena.track(section.extrude(lengthMm));
  // Profile X -> bin width, profile Y -> height, extrusion Z -> channel axis.
  cutter = arena.track(cutter.rotate([90, 0, 0]));
  cutter = arena.track(cutter.rotate([0, 0, 90 + (scoop.rotationDeg ?? 0)]));
  return arena.track(cutter.translate([start.x, start.y, pocket.infillTopZ]));
}

/** Elongated shaft with a cylindrical bottom; oblongs also have spherical end caps. */
function buildElongatedScoopCutter(
  kernel: Kernel,
  scoop: FingerHole,
  placement: Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored">,
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena, Manifold: M } = kernel;
  const localEndpoints = elongatedFingerHoleEndpoints(scoop);
  const start = transformPointPlacement(localEndpoints.start, placement);
  const end = transformPointPlacement(localEndpoints.end, placement);
  const radius = scoop.diameterMm / 2;
  const totalDepth = effectiveDeepScoopDepthMm(scoop);
  const bottomCentreZ = pocket.infillTopZ - totalDepth + radius;

  const ring = fingerHoleFootprintRing(scoop, placement, segments);
  const section = toCrossSection(kernel, [{ outer: ring, holes: [] }]);
  const shaft = arena.track(
    arena.track(section.extrude(pocket.cutterTopZ - bottomCentreZ)).translate([
      0,
      0,
      bottomCentreZ,
    ]),
  );

  const span = Math.hypot(end.x - start.x, end.y - start.y);
  const angleDeg = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  let trough = arena.track(M.cylinder(span, radius, radius, segments));
  trough = arena.track(trough.rotate([0, 90, 0]));
  if (angleDeg !== 0) trough = arena.track(trough.rotate([0, 0, angleDeg]));
  trough = arena.track(trough.translate([start.x, start.y, bottomCentreZ]));

  // A finite cylinder supplies planar end faces without rounded caps.
  if (scoop.kind === "flat-ended-scoop") return arena.track(shaft.add(trough));

  const startSphere = arena.track(
    arena.track(M.sphere(radius, segments)).translate([
      start.x,
      start.y,
      bottomCentreZ,
    ]),
  );
  const endSphere = arena.track(
    arena.track(M.sphere(radius, segments)).translate([
      end.x,
      end.y,
      bottomCentreZ,
    ]),
  );
  const roundedBottom = arena.track(
    arena.track(startSphere.add(trough)).add(endSphere),
  );
  return arena.track(shaft.add(roundedBottom));
}

/** Builds independent bin-local finger access cutters. */
export function buildFingerHoleCutters(
  kernel: Kernel,
  fingerHoles: readonly FingerHole[],
  spec: BinSpec,
  quality: BuildQuality,
): Manifold[] {
  const { arena } = kernel;
  const cutters: Manifold[] = [];
  const filletProfileStepMm =
    quality.filletProfileStepMm ?? FILLET_PROFILE_STEP_MM;

  for (const hole of fingerHoles) {
    const segments = fingerHoleCircularSegments(hole, quality.circularSegments,
      quality.fingerHoleChordToleranceMm ?? FINGER_HOLE_PREVIEW_CHORD_TOLERANCE_MM);
    const pocket = resolvePocketDepth(spec, { mode: "mm", value: hole.depthMm });
    const cutDepth = effectiveFingerHoleDepthMm(hole);
    const effectiveTopFillet = effectiveFingerHoleTopFilletMm(hole);
    // Sample shallow curved bottoms directly so even a 1 mm cut preserves
    // its mouth width and exact depth, with or without top-edge rounding.
    const shallowCurved = hole.kind !== "flat-ended-scoop" && cutDepth < hole.diameterMm / 2;
    if (!hasFlatFingerHoleBottom(hole) &&
        (effectiveTopFillet > 0 || shallowCurved || effectiveFingerHoleCornerRoundMm(hole) > 0)) {
      cutters.push(buildRoundedFingerAccessCutter(kernel, hole, pocket.infillTopZ, pocket.cutterTopZ, {
        radiusMm: effectiveTopFillet,
        profileStepMm: filletProfileStepMm,
        circularSegments: segments,
      }));
      continue;
    }
    const ring = fingerHoleFootprintRing(
      hole,
      BIN_LOCAL_PLACEMENT,
      segments,
    );
    const section = toCrossSection(kernel, [{ outer: ring, holes: [] }]);
    let cutter: Manifold;
    if (hasFlatFingerHoleBottom(hole)) {
      const floorZ = pocket.floorZ ?? -pegBottomExtensionMm(spec) - 1;
      const effectiveBottomFillet = effectiveFingerHoleBottomFilletMm(hole);
      const localCutter = bottomFilletCutter(
        kernel,
        section,
        pocket.cutterTopZ - floorZ,
        {
          radiusMm: effectiveBottomFillet,
          profileStepMm: filletProfileStepMm,
          circularSegments: segments,
        },
      );
      cutter = arena.track(localCutter.translate([0, 0, floorZ]));
    } else if (hole.kind === "scoop") {
      cutter = buildRoundScoopCutter(
        kernel,
        hole,
        BIN_LOCAL_PLACEMENT,
        pocket,
        segments,
      );
    } else if (hole.kind === "deep-scoop") {
      cutter = buildDeepScoopCutter(
        kernel,
        hole,
        BIN_LOCAL_PLACEMENT,
        pocket,
        segments,
      );
    } else if (hole.kind === "flat-ended-scoop" && hole.depthMm < hole.diameterMm / 2) {
      cutter = buildShallowFlatEndedScoopCutter(kernel, hole, pocket, segments);
    } else if (isElongatedFingerHole(hole)) {
      cutter = buildElongatedScoopCutter(
        kernel,
        hole,
        BIN_LOCAL_PLACEMENT,
        pocket,
        segments,
      );
    } else {
      continue;
    }

    if (effectiveTopFillet > 0) {
      // Straight holes retain the existing floor fillet, adding only a smooth rim.
      const topRound = buildRoundedFingerAccessCutter(kernel, hole, pocket.infillTopZ, pocket.cutterTopZ, {
        radiusMm: effectiveTopFillet,
        profileStepMm: filletProfileStepMm,
        circularSegments: segments,
      });
      cutter = arena.track(cutter.add(topRound));
    }
    cutters.push(cutter);
  }
  return cutters;
}

/** Build the complete shaft in its own frame, including split seats and color
 * bands, then rotate it. Headroom is measured along the axis so the far side
 * of the opening always clears the actual rim. */
function buildOrientedCutout(
  kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement, spec: BinSpec,
  quality: BuildQuality, options: CutoutBuildOptions,
): CutoutCutters {
  const { arena } = kernel;
  const axis = pocketAxis(cutout);
  if (axis.z < 0.01) throw new Error("Reduce the combined pocket tilt so its axis can exit through the top.");
  const split = cutout.split ? resolvePocketSplit(shape.outlineMm, cutout.split.boundary) : null;
  if (split?.error) throw new Error(split.error);
  const depths = cutout.split?.depths ?? [cutout.depth];
  const resolved = depths.map((depth, i) => resolvePlacedPocketDepth(spec, depth,
    { outlineMm: split?.regions?.[i] ?? shape.outlineMm }, cutout));
  if (resolved.some(p => p.axialDepthMm !== null && (p.axialDepthMm <= 0 || (p.highestFloorZ ?? 0) >= p.infillTopZ))) {
    throw new Error("Increase pocket depth, lower Z, or reduce tilt: the whole pocket floor must sit below the opening.");
  }
  const real = resolved[0];
  const extent = Math.max(Math.abs(shape.bboxMm.minX), Math.abs(shape.bboxMm.maxX)) * cutout.scaleX
    + Math.max(Math.abs(shape.bboxMm.minY), Math.abs(shape.bboxMm.maxY)) * cutout.scaleY
    + Math.abs(cutout.clearanceMm) + cutout.topFilletMm + 2;
  const anchorZ = real.infillTopZ + (cutout.zOffsetMm ?? 0);
  const headroom = Math.max(0, (real.cutterTopZ - anchorZ + extent) / axis.z) + 2;
  const maxDepth = Math.max(anchorZ / axis.z + extent / axis.z, ...resolved.map(p => p.axialDepthMm ?? 0));
  // A positive virtual floor lets the ordinary builder construct full color
  // bands. Only the local frame changes; the real bin is never resized.
  const localSpec = { ...spec, heightUnits: Math.ceil((maxDepth + 20) / 7) };
  const localTop = resolvePocketDepth(localSpec, { mode: "through" }).infillTopZ;
  const axialDepths = resolved.map(p => p.axialDepthMm === null
    ? { mode: "through" as const } : { mode: "mm" as const, value: p.axialDepthMm });
  const localCutout: CutoutPlacement = { ...cutout, tilt: undefined, zOffsetMm: undefined, rotationDeg: 0,
    position: { x: 0, y: 0 }, topFilletMm: 0, depth: axialDepths[0],
    split: cutout.split ? { ...cutout.split, depths: [axialDepths[0], axialDepths[1]] } : undefined };
  const built = buildCutoutCutters(kernel, new Map([[shape.id, shape]]), [localCutout], localSpec, quality,
    { ...options, axialHeadroomMm: headroom });
  const place = (solid: Manifold): Manifold => {
    let result = arena.track(solid.translate([0, 0, -localTop]));
    result = arena.track(result.rotate([cutout.tilt?.xDeg ?? 0, 0, 0]));
    result = arena.track(result.rotate([0, cutout.tilt?.yDeg ?? 0, 0]));
    result = arena.track(result.rotate([0, 0, cutout.rotationDeg]));
    return arena.track(result.translate([cutout.position.x, cutout.position.y, anchorZ]));
  };
  const cutters = built.cutters.map(place);
  let topFilletRadiusMm = 0;
  if (cutout.topFilletMm > 0 && cutters.length > 0) {
    const union = arena.track(kernel.Manifold.union(cutters));
    const mouth = arena.track(union.slice(real.infillTopZ));
    const verticalDepth = Math.min(...resolved.map(p => p.highestFloorZ === null ? Infinity : p.infillTopZ - p.highestFloorZ));
    const radius = Math.min(cutout.topFilletMm, verticalDepth / 2);
    if (radius > 0 && !mouth.isEmpty()) {
      // The opening can move across a tilted floor within the rounding depth.
      // Projecting the top outline down creates a flat trench at the exit.
      // Follow the unrounded cavity at each height instead.
      const flare = topEdgeFilletCutter(kernel, height =>
        arena.track(union.slice(real.infillTopZ - radius + height + 1e-7)), { radiusMm: radius,
        profileStepMm: quality.filletProfileStepMm ?? FILLET_PROFILE_STEP_MM,
        circularSegments: quality.circularSegments });
      cutters.push(arena.track(flare.translate([0, 0, real.infillTopZ - radius])));
      topFilletRadiusMm = radius;
    }
  }
  return { cutters, throughCutters: built.throughCutters?.map(place), floorInserts: built.floorInserts.map(place), reports: built.reports, topFilletRadiusMm };
}

/** Builds one cutter per cutout, skipping (and reporting) collapsed ones. */
function buildCutoutCuttersInternal(
  kernel: Kernel,
  shapesById: ReadonlyMap<string, TracedShape>,
  cutouts: readonly CutoutPlacement[],
  spec: BinSpec,
  quality: BuildQuality,
  options: CutoutBuildOptions = {},
): CutoutCutters {
  const { arena } = kernel;
  const cutters: Manifold[] = [];
  const throughCutters: Manifold[] = [];
  const floorInserts: Manifold[] = [];
  const reports: CutoutBuildReport[] = [];
  let topFilletRadiusMm = 0;
  const segments = quality.circularSegments;
  const budget = quality.cutoutVertexBudget ?? 150;
  const filletProfileStepMm =
    quality.filletProfileStepMm ?? FILLET_PROFILE_STEP_MM;

  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    if (!shape) {
      // Validation owns the user-facing error; the builder just skips.
      reports.push({ id: cutout.id, emptied: true });
      continue;
    }

    if (hasPocketTilt(cutout) || (cutout.zOffsetMm ?? 0) !== 0) {
      const tilted = buildOrientedCutout(kernel, shape, cutout, spec, quality, options);
      cutters.push(...tilted.cutters);
      throughCutters.push(...(tilted.throughCutters ?? []));
      floorInserts.push(...tilted.floorInserts);
      reports.push(...tilted.reports);
      topFilletRadiusMm = Math.max(topFilletRadiusMm, tilted.topFilletRadiusMm ?? 0);
      continue;
    }

    if (cutout.split) {
      const resolved = resolvePocketSplit(shape.outlineMm, cutout.split.boundary);
      if (resolved.error) throw new Error(`“${pocketName(cutout, shape)}”: ${resolved.error}`);
      const [a, b] = cutout.split.boundary.map(p => transformPointPlacement(p, cutout));
      // Mirroring reverses left/right in world space; section identity remains
      // attached to the authored outline even under nonuniform scaling.
      const sign = cutout.mirrored ? -1 : 1;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / length * sign;
      const ny = (b.x - a.x) / length * sign;
      const sectionDepthsMm = cutout.split.depths.map(depth => resolvePocketDepth(spec, depth).depthMm ?? Infinity);
      const shallowIndex = sectionDepthsMm[0] <= sectionDepthsMm[1] ? 0 : 1;
      const sameDepth = sectionDepthsMm[0] === sectionDepthsMm[1];
      // One opening means one top round, limited by the shallowest section.
      const topFilletMm = Math.min(cutout.topFilletMm, Math.max(0, sectionDepthsMm[shallowIndex] / 2));
      let emptied = false;
      for (const [index, depth] of cutout.split.depths.entries()) {
        if (sameDepth && index !== shallowIndex) continue;
        const partBands: ExtrusionBand[] | undefined = options.sourceBands ? [] : undefined;
        const part = buildCutoutCutters(kernel, shapesById, [{ ...cutout, split: undefined, depth, topFilletMm }], spec, quality,
          { ...options, sourceBands: partBands });
        topFilletRadiusMm = Math.max(topFilletRadiusMm, part.topFilletRadiusMm ?? 0);
        if (sameDepth) {
          if (partBands) options.sourceBands!.push(...partBands);
          cutters.push(...part.cutters);
          throughCutters.push(...(part.throughCutters ?? []));
          floorInserts.push(...part.floorInserts);
          emptied ||= part.reports.some(report => report.emptied);
          continue;
        }
        const side = index === 0 ? 1 : -1;
        const trim = (solid: Manifold) => arena.track(solid.trimByPlane(
          [nx * side, ny * side, 0], (nx * a.x + ny * a.y) * side,
        ));
        // Round the original perimeter first, then trim. Treating the split
        // as an outside edge would create an unwanted rounded ridge at the seam.
        const sectionCutters = part.cutters.map(trim);
        emptied ||= part.reports.some(report => report.emptied) || sectionCutters.every(cutter => cutter.isEmpty());
        // Clear the entire opening to the shallow depth, then extend only the
        // deep side. Opposing trims of independently built solids can disagree
        // by a rounding error and leave a zero-thickness wall above the shelf.
        cutters.push(...(index === shallowIndex ? part.cutters : sectionCutters));
        throughCutters.push(...(part.throughCutters ?? []).map(trim));
        if (partBands) options.sourceBands!.push(...(index === shallowIndex ? partBands
          : clipExtrusionBands(kernel, partBands, [nx * side, ny * side], (nx * a.x + ny * a.y) * side)));
        floorInserts.push(...part.floorInserts.map(trim));
      }
      reports.push({ id: cutout.id, emptied });
      continue;
    }

    const budgeted = budgetOutline(shape.outlineMm, budget);
    const placed = transformOutlinePlacement(budgeted, cutout);

    let section = toCrossSection(kernel, placed);
    if (cutout.clearanceMm !== 0) {
      section = arena.track(
        arena
          .track(section.offset(cutout.clearanceMm, "Round", 2, segments))
          .simplify(CLEANUP_EPSILON),
      );
    }
    if (cutout.cornerRoundMm > 0) {
      section = arena.track(
        arena
          .track(section.offset(-cutout.cornerRoundMm, "Round", 2, segments))
          .simplify(CLEANUP_EPSILON),
      );
      section = arena.track(
        arena
          .track(section.offset(cutout.cornerRoundMm, "Round", 2, segments))
          .simplify(CLEANUP_EPSILON),
      );
    }

    if (section.isEmpty()) {
      reports.push({ id: cutout.id, emptied: true });
      continue;
    }
    reports.push({ id: cutout.id, emptied: false });

    const pocket = resolvePocketDepth(spec, cutout.depth);
    if (options.axialHeadroomMm !== undefined) pocket.cutterTopZ = pocket.infillTopZ + options.axialHeadroomMm;
    let cutter: Manifold;
    if (pocket.floorZ === null) {
      // Through cut: from below the bin to above the lip.
      cutter = arena.track(
        arena.track(section.extrude(pocket.cutterTopZ + pegBottomExtensionMm(spec) + 2)).translate([0, 0, -pegBottomExtensionMm(spec) - 1]),
      );
    } else {
      const effectiveFillet = Math.min(
        cutout.bottomFilletMm,
        (pocket.depthMm ?? 0) / 2,
      );
      const requestedInsertThickness = options.floorInsertThicknessMm ?? 0;
      const insertThickness = Math.min(
        Math.max(requestedInsertThickness, 0),
        Math.max(pocket.floorZ, 0),
      );
      if (insertThickness > 0) {
        const floorSection =
          effectiveFillet > 0
            ? arena.track(
                arena
                  .track(
                    section.offset(
                      -effectiveFillet,
                      "Round",
                      2,
                      segments,
                    ),
                  )
                  .simplify(CLEANUP_EPSILON),
              )
            : section;
        if (!floorSection.isEmpty()) {
          floorInserts.push(
            arena.track(
              arena
                .track(floorSection.extrude(insertThickness))
                .translate([0, 0, pocket.floorZ - insertThickness]),
            ),
          );
        }
      }
      const bands: ExtrusionBand[] | undefined = options.sourceBands ? [] : undefined;
      const localCutter = bottomFilletCutter(kernel, section, pocket.cutterTopZ - pocket.floorZ, {
        radiusMm: Math.max(effectiveFillet, 0),
        profileStepMm: filletProfileStepMm,
        circularSegments: segments,
      }, bands);
      if (bands) options.sourceBands!.push(...bands.map(band => ({ ...band,
        bottom: band.bottom + pocket.floorZ! })));
      cutter = arena.track(localCutter.translate([0, 0, pocket.floorZ]));
    }

    const effectiveTopFillet = Math.min(
      cutout.topFilletMm,
      pocket.depthMm === null ? cutout.topFilletMm : pocket.depthMm / 2,
    );
    if (effectiveTopFillet > 0) {
      const topRound = topEdgeFilletCutter(kernel, section, {
        radiusMm: effectiveTopFillet,
        profileStepMm: filletProfileStepMm,
        circularSegments: segments,
      });
      const positionedTopRound = arena.track(
        topRound.translate([0, 0, pocket.infillTopZ - effectiveTopFillet]),
      );
      cutter = arena.track(cutter.add(positionedTopRound));
      topFilletRadiusMm = Math.max(topFilletRadiusMm, effectiveTopFillet);
    }
    cutters.push(cutter);
    if (cutout.depth.mode === "through") throughCutters.push(cutter);
  }

  return { cutters, throughCutters, floorInserts, reports, topFilletRadiusMm };
}

/** Generate in the outline's own frame, then apply one reusable rigid pose.
 * Optional clearance sweeps the finite object upward in the selected direction.
 * Top-edge rounding belongs to the bin surface intersection, not that cap. */
export function buildRigidPocket(kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement,
  spec: BinSpec, quality: BuildQuality, options: CutoutBuildOptions = {}, top = Infinity,
): CutoutCutters {
  const { arena, Manifold } = kernel;
  // Keep the rest of the preview editable while an axial path is horizontal.
  // Shared validation reports the error and exports reject it before building.
  if (pocketInsertionError(cutout)) return { cutters: [], floorInserts: [], floorRegions: [],
    reports: [{ id: cutout.id, emptied: false }] };
  const realTop = resolvePocketDepth(spec, cutout.depth).infillTopZ;
  const depthSpecs = cutout.split?.depths ?? [cutout.depth];
  const dimensions = depthSpecs.map(d => d.mode === "mm" ? d.value
    : d.sourceDepthMm ?? (d.mode === "remaining" ? realTop-d.floorThicknessMm : realTop));
  const localSpec = { ...spec, lip: "none" as const, fillHeightPercent: 100,
    heightUnits: Math.ceil((Math.max(...dimensions)+20)/7) };
  const localTop = resolvePocketDepth(localSpec,cutout.depth).infillTopZ;
  const depths = dimensions.map(value => ({mode:"mm" as const,value}));
  const local = {...cutout,position:{x:0,y:0},rotationDeg:0,tilt:undefined,
    elevationMm:undefined,zOffsetMm:undefined,insertionMode:undefined,depth:depths[0],topFilletMm:0,
    split:cutout.split ? {...cutout.split,depths:[depths[0],depths[1]] as [typeof depths[number],typeof depths[number]]} : undefined};
  const lateralAxis = cutout.insertionMode === "axis" && cutout.insertionAxis && cutout.insertionAxis !== "z"
    ? cutout.insertionAxis : null;
  const padding = options.colorOutsetMm ?? 0;
  const sourceBands: ExtrusionBand[] | undefined = lateralAxis || padding > 0 ? [] : undefined;
  const built = buildCutoutCuttersInternal(kernel,new Map([[shape.id,shape]]),[local],localSpec,quality,{axialHeadroomMm:0,sourceBands});
  const finiteBands = sourceBands?.map(band => ({ ...band, bottom: band.bottom - localTop }));
  const anchor = arena.track(Manifold.union(built.cutters.map(s => arena.track(s.translate([0,0,-localTop])))));
  const colorBasis = options.colorAxis === "x" ? {x:1,y:0,z:0}
    : options.colorAxis === "y" ? {x:0,y:1,z:0} : {x:0,y:0,z:1};
  const colorSign = rotateObjectVector(colorBasis, pocketRotation(cutout)).z < 0 ? 1 : -1;
  const localBands = padding > 0 && finiteBands
    ? options.colorAxis ? sweepColorBands(kernel, finiteBands, options.colorAxis, colorSign * padding)
      : outsetColorBands(kernel, finiteBands, padding, quality.circularSegments)
    : finiteBands;
  const expanded = padding > 0 && localBands ? extrudeColorBands(kernel, localBands) : anchor;
  const sourceIsClipped = depthSpecs.some(depth => depth.mode === "remaining"
    && depth.floorThicknessMm > (cutout.elevationMm ?? 0));
  const source = padding > 0 && options.colorAxis
    ? floorColorMask(kernel, expanded, anchor, options.colorAxis, colorSign * padding, sourceIsClipped, finiteBands!) : expanded;
  const pose = { rotation: pocketRotation(cutout), position: cutout.position, elevationMm: cutout.elevationMm ?? 0 };
  // Sweep the complete source before clipping; a submerged cap must still open
  // through the surface, while an object wholly above the bin leaves no cut.
  let cutter = buildObjectCavity(kernel, source, pose, cutout.insertionMode ? Infinity : top, anchor);
  const projectedSource = cutter && cutout.insertionMode === "vertical" ? arena.track(arena.track(cutter.project()).simplify(0.0001)) : null;
  // Sweep native sections in the authored frame: X/Y extend each horizontal
  // band, while Z extends the shaft. Complex photo traces otherwise require
  // hundreds of thousands of triangle prisms. Keep the finite source anchor.
  let insertionSource = source;
  let lateralDelta: Vec2 | null = null;
  if (cutter && cutout.insertionMode === "axis") {
    const axis = pocketInsertionAxis(cutout);
    const ceiling = Math.max(realTop, cutter.boundingBox().max[2], Number.isFinite(top) ? top : realTop) + 1;
    const travel = (ceiling - cutter.boundingBox().min[2]) / axis.z;
    if (lateralAxis && localBands) {
      const basis = lateralAxis === "x" ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      const sign = rotateObjectVector(basis, pose.rotation).z < 0 ? -1 : 1;
      lateralDelta = lateralAxis === "x" ? [travel * sign, 0] : [0, travel * sign];
      if (!cutout.split || !depthSpecs.some(depth => depth.mode === "remaining")) {
        // Each swept band already contains its original section. Adding the
        // source again creates coincident sheets that collapse in STL's Float32
        // coordinates, even when indexed kernel topology remains manifold.
        insertionSource = planarInsertionCutter(kernel, localBands, lateralDelta);
      }
    } else {
      const localUp = rotateObjectVector({ x: 0, y: 0, z: 1 }, pose.rotation).z > 0;
      // Slice inside the common straight shaft, above every bottom fillet.
      // Extend this cap without rebuilding the rounded source: the very long
      // shafts needed near horizontal must not perturb the original seat.
      const capZ = -Math.min(...dimensions) / 4;
      const cap = arena.track(source.slice(capZ));
      if (localUp) {
        const shaft = arena.track(arena.track(cap.extrude(travel - capZ)).translate([0, 0, capZ]));
        insertionSource = arena.track(source.add(shaft));
      } else {
        // Inverted insertion carries the full top cap past every lower seat,
        // clearing its bottom rounding and any split-depth shelf along the way.
        const bottom = source.boundingBox().min[2] - travel;
        insertionSource = arena.track(arena.track(cap.extrude(-bottom)).translate([0, 0, bottom]));
      }
    }
    cutter = buildObjectCavity(kernel, insertionSource, pose, Infinity, anchor);
  }
  const insertionVolumes: Manifold[] = [];
  const excludedFromInsertion: Manifold[] = [];
  const throughCutters: Manifold[] = [];
  const clearAndLimit = (posed: Manifold, depth: DepthSpec): Manifold => {
    let result = posed;
    if (cutout.insertionMode === "vertical") {
      if (!result.isEmpty()) {
        const ceiling = Math.max(realTop, result.boundingBox().max[2], Number.isFinite(top) ? top : realTop) + 1;
        result = directionalInsertionCutter(kernel, result, ceiling, pocketInsertionAxis(cutout));
        // Keep the already-built path for collision validation against the
        // finished bin. Geometry above the bin intersects no material.
        if (!padding) {
          insertionVolumes.push(result);
          // The sweep's Float32 facets can sit slightly below a floor
          // they merely touch. Avoid constructing degenerate contact slivers.
          if (depth.mode === "remaining" && depth.floorThicknessMm > result.boundingBox().min[2] + 0.0001) {
            excludedFromInsertion.push(arena.track(result.trimByPlane([0,0,-1], -depth.floorThicknessMm)));
          }
        }
      }
    }
    // Apply the floor constraint to the generated cavity, never the source.
    // Rebuilding after raising the object therefore restores its whole profile.
    const colorReach = options.colorAxis
      ? padding * pocketColorAxis({...cutout,colorFloorAxis:options.colorAxis}).z : padding;
    if (depth.mode === "remaining") result = arena.track(result.trimByPlane([0,0,1],depth.floorThicknessMm-colorReach));
    if (Number.isFinite(top)) result = arena.track(result.trimByPlane([0,0,-1],-top));
    if (depth.mode === "through" && !result.isEmpty()) {
      // Extend only an actual slab opening into the peg underside. The finite
      // source and its rigid pose stay unchanged; raising it restores the pegs.
      if (spec.pegBottom) {
        const opening = arena.track(result.slice(0));
        if (!opening.isEmpty()) {
          const extension = pegBottomExtensionMm(spec) + 1;
          const below = arena.track(arena.track(opening.extrude(extension + 0.01))
            .translate([0, 0, -extension]));
          result = arena.track(result.add(below));
        }
      }
      throughCutters.push(result);
    }
    return result;
  };
  if (cutter && cutout.split && depthSpecs.some(d => d.mode === "remaining" || (spec.pegBottom && d.mode === "through"))) {
    const local = {...cutout,position:{x:0,y:0},rotationDeg:0};
    const [a,b] = cutout.split.boundary.map(p => transformPointPlacement(p,local));
    const length = Math.hypot(b.x-a.x,b.y-a.y);
    const pieces = depthSpecs.flatMap((depth,i) => {
      const sign = (cutout.mirrored ? -1 : 1)*(i === 0 ? 1 : -1);
      const nx = -(b.y-a.y)/length*sign, ny = (b.x-a.x)/length*sign;
      const part = lateralDelta && localBands
        ? planarInsertionCutter(kernel,
          clipExtrusionBands(kernel, localBands, [nx, ny], nx*a.x+ny*a.y), lateralDelta)
        : arena.track(insertionSource.trimByPlane([nx,ny,0],nx*a.x+ny*a.y));
      const posed = buildObjectCavity(kernel,part,pose,Infinity,anchor);
      return posed ? [clearAndLimit(posed,depth)] : [];
    });
    cutter = arena.track(Manifold.union(pieces));
  } else if (cutter) {
    cutter = clearAndLimit(cutter,cutout.depth);
  }
  // A source raised entirely clear of the bin leaves no cavity or floor-color
  // region. Empty-solid bounds cannot be used to construct a material column.
  if (cutter?.isEmpty()) cutter = null;
  const seatedCutter = cutter;
  let topFilletRadiusMm = 0;
  if (seatedCutter && cutout.topFilletMm > 0 && seatedCutter.boundingBox().max[2] >= realTop - 1e-8) {
    // Slice after posing and joining the split seats. Only the opening that
    // actually reaches the fill gets a rim; submerged caps stay finite. Keep
    // clearance, corner/bottom rounding and the deeper seats in the source.
    const mouth = arena.track(seatedCutter.slice(realTop - 1e-7));
    const radius = Math.min(cutout.topFilletMm, ...dimensions.map(d => d / 2),
      Math.max(0, realTop - seatedCutter.boundingBox().min[2]) / 2);
    if (radius > 0 && !mouth.isEmpty()) {
      // The opening can move across a tilted floor within the rounding depth.
      // Projecting the top outline down creates a flat trench at the exit.
      // Follow the unrounded cavity at each height instead.
      const flare = topEdgeFilletCutter(kernel, height =>
        arena.track(seatedCutter.slice(realTop - radius + height + 1e-7)), { radiusMm: radius,
        profileStepMm: quality.filletProfileStepMm ?? FILLET_PROFILE_STEP_MM,
        circularSegments: quality.circularSegments });
      cutter = arena.track(seatedCutter.add(arena.track(flare.translate([0, 0, realTop - radius]))));
      topFilletRadiusMm = radius;
    }
  }
  const floorInserts: Manifold[] = [], floorRegions: Manifold[] = [];
  const distance = Math.min(options.floorInsertThicknessMm ?? 0, Math.max(0, seatedCutter?.boundingBox().min[2] ?? pose.elevationMm));
  if (cutter && seatedCutter && distance > 0 && (cutout.insertionMode || depthSpecs.some(d => d.mode !== "mm"))) {
    // Resolve the finite underside band before intersecting it with the bin.
    // A full-height translated cavity shares its vertical faces with the cut;
    // partitioning that mask against the finished bin leaves zero-volume wall
    // sheets that render in the floor color. Subtracting the original cavity
    // here cancels those faces, including internal split-seat walls.
    let region = arena.track(seatedCutter.translate([0,0,-distance]));
    if (cutout.bottomFilletMm > 0) {
      // Remove projection seams before the inset expands sub-micron slits
      // into visible uncolored stripes across an otherwise continuous floor.
      const projection = projectedSource ?? arena.track(arena.track(seatedCutter.project()).simplify(0.0001));
      const floorOutline = arena.track(projection.offset(-cutout.bottomFilletMm,"Round",2,quality.circularSegments));
      const bounds = region.boundingBox();
      const floorColumn = arena.track(arena.track(floorOutline.extrude(bounds.max[2]-bounds.min[2]+2)).translate([0,0,bounds.min[2]-1]));
      region = arena.track(region.intersect(floorColumn));
    }
    floorInserts.push(arena.track(region.subtract(seatedCutter)));
    // The body still subtracts the full mask: subtracting the finite lining
    // from an already-cut cavity would reintroduce coincident floor faces.
    floorRegions.push(region);
  } else if (cutter && distance > 0) {
    const axes = [{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}].map(v => rotateObjectVector(v, pose.rotation));
    const below = arena.track(source.translate(axes.map(v => -distance * v.z) as [number,number,number]));
    const band = arena.track(below.subtract(source));
    const insert = buildObjectCavity(kernel, band, pose, top, anchor);
    const region = buildObjectCavity(kernel, below, pose, top, anchor);
    if (insert) floorInserts.push(insert);
    if (region) floorRegions.push(region);
  }
  return { cutters: cutter ? [cutter] : [], throughCutters, floorInserts, floorRegions, topFilletRadiusMm,
    validationIssues: [], insertionPaths: insertionVolumes.length
      ? [{ id: cutout.id, volumes: insertionVolumes, excluded: excludedFromInsertion }] : [],
    reports: [{ id: cutout.id, emptied: source.isEmpty() }] };
}

/** Build holes as independent volumes, then protect them from every pocket cutter.
 * Never union them back into the bin: an exclusion cannot create material outside
 * the original bin or fill base hardware recesses. All generated handles use Arena.
 */
export function buildCutoutCutters(kernel: Kernel, shapesById: ReadonlyMap<string, TracedShape>, cutouts: readonly CutoutPlacement[], spec: BinSpec, quality: BuildQuality, options: CutoutBuildOptions = {}): CutoutCutters {
  const groups = cutouts.filter(cutout => !cutout.depthPending).map(source => {
    // Recursive split/tilt construction builds the volume, independently of its role.
    const cutout = { ...source, role: undefined };
    const shape = shapesById.get(cutout.shapeId);
    // Custom coverage replaces the legacy floor mask. Avoid building an
    // expensive tilted mask that will immediately be discarded.
    const colorAxis = pocketColorLocalAxis(cutout);
    const customColor = cutout.colorCoverage === "interior" || colorAxis !== null;
    const cavityOptions = customColor ? { ...options, floorInsertThicknessMm: 0 } : options;
    const built: CutoutCutters = cutout.profileBottom && shape
      ? buildProfileBottomCutout(kernel, shape, cutout, spec, cavityOptions.floorInsertThicknessMm)
      : (hasRigidPocket(cutout) || cutout.insertionMode) && shape
        ? buildRigidPocket(kernel, shape, rigidPocket(cutout, shape, spec), spec, quality, cavityOptions, resolvePocketDepth(spec, cutout.depth).cutterTopZ)
        : buildCutoutCuttersInternal(kernel, shapesById, [cutout], spec, quality, cavityOptions);
    const thickness = options.floorInsertThicknessMm ?? 0;
    if (shape && source.role !== "hole" && thickness > 0 && built.cutters.length > 0) {
      if (customColor) {
        const colorPocket = rigidPocket(migrateProfilePocket(cutout), shape, spec);
        // Floor-only color belongs to the finite object's supporting surface.
        // Sweeping this mask through the insertion path also paints clearance
        // walls far above that surface when the color axis is tilted.
        const maskPocket = cutout.colorCoverage === "interior" ? {...colorPocket, topFilletMm: 0}
          : {...colorPocket, insertionMode: undefined, topFilletMm: 0};
        const expanded = buildRigidPocket(kernel, shape, maskPocket, spec, quality,
          { colorOutsetMm: thickness, colorAxis: cutout.colorCoverage === "interior" ? undefined : colorAxis ?? undefined },
          resolvePocketDepth(spec, cutout.depth).cutterTopZ);
        const top = resolvePocketDepth(spec, cutout.depth).infillTopZ;
        const regions = expanded.cutters.map(region => kernel.arena.track(region.trimByPlane([0,0,-1], -top)));
        built.floorInserts = regions;
        built.floorRegions = regions;
      }
      const topRadius = built.topFilletRadiusMm ?? 0;
      if (topRadius > 0) {
        // Keep the complete rounded entry in the bin material. Trim both
        // masks together so the color boundary cannot leave a gap in the body.
        const ceiling = resolvePocketDepth(spec, cutout.depth).infillTopZ - topRadius;
        const belowRounding = (regions: Manifold[]) => regions
          .map(region => kernel.arena.track(region.trimByPlane([0,0,-1], -ceiling)))
          .filter(region => !region.isEmpty());
        built.floorRegions = belowRounding(built.floorRegions ?? built.floorInserts);
        built.floorInserts = belowRounding(built.floorInserts);
      }
    }
    return { id: cutout.id, role: source.role, built };
  });
  const masks = groups.filter(g => g.role === "hole").flatMap(g => g.built.cutters);
  const mask = masks.length ? kernel.arena.track(kernel.Manifold.union(masks)) : null;
  const protect = (solids: Manifold[]) => mask
    ? solids.map(solid => kernel.arena.track(solid.subtract(mask))).filter(solid => !solid.isEmpty()) : solids;
  const pockets = groups.filter(g => g.role !== "hole").map(g => ({ ...g, built: { ...g.built,
    throughCutters: protect(g.built.throughCutters ?? []),
    cutters: protect(g.built.cutters), floorInserts: protect(g.built.floorInserts),
    floorRegions: protect(g.built.floorRegions ?? g.built.floorInserts),
  } }));
  return { topFilletRadiusMm: Math.max(0, ...pockets.map(g => g.built.topFilletRadiusMm ?? 0)),
    cutters: pockets.flatMap(g => g.built.cutters), throughCutters: pockets.flatMap(g => g.built.throughCutters),
    floorInserts: pockets.flatMap(g => g.built.floorInserts),
    floorRegions: pockets.flatMap(g => g.built.floorRegions), reports: groups.flatMap(g => g.built.reports),
    validationIssues: groups.flatMap(g => g.built.validationIssues ?? []),
    insertionPaths: pockets.flatMap(g => (g.built.insertionPaths ?? []).map(path => ({ ...path,
      excluded: [...path.excluded, ...(mask ? path.volumes.map(volume => kernel.arena.track(volume.intersect(mask))) : [])],
    }))),
    cutterGroups: pockets.map(g => ({ id: g.id, cutters: g.built.cutters })),
    retainedGroups: groups.filter(g => g.role === "hole").map(g => ({ id: g.id, volumes: g.built.cutters })) };
}
