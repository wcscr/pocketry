// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import {
  effectiveDeepScoopDepthMm,
  effectiveScoopDepthMm,
  fingerHoleFootprintRing,
  oblongDeepScoopEndpoints,
  resolvePocketDepth,
  transformOutlinePlacement,
  transformPointPlacement,
  type CutoutPlacement,
  type FingerHole,
  type ResolvedPocket,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { LAYER_HEIGHT } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import type { Outline, Ring } from "@shared/geometry/types";

import { toCrossSection } from "@/lib/geometry/offset";
import { simplifyRing } from "@/lib/geometry/simplify";
import type { Kernel } from "@/lib/manifold/runtime";

import type { BuildQuality } from "./bin";
import {
  bottomFilletCutter,
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
 *  3. `+clearance` offset with round joins — clearance runs BEFORE corner
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
 * Finger holes are built separately in the bin frame. Round scoops use
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
  /** Optional printable material immediately below each blind pocket floor. */
  floorInserts: Manifold[];
  reports: CutoutBuildReport[];
}

export interface CutoutBuildOptions {
  /** Builds this much solid material below each flat blind-pocket floor. */
  floorInsertThicknessMm?: number;
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

/** Capsule shaft with a swept-hemisphere trough bottom. */
function buildOblongDeepScoopCutter(
  kernel: Kernel,
  scoop: FingerHole,
  placement: Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored">,
  pocket: ResolvedPocket,
  segments: number,
): Manifold {
  const { arena, Manifold: M } = kernel;
  const localEndpoints = oblongDeepScoopEndpoints(scoop);
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
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  const angleDeg = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  let trough = arena.track(M.cylinder(span, radius, radius, segments));
  trough = arena.track(trough.rotate([0, 90, 0]));
  if (angleDeg !== 0) trough = arena.track(trough.rotate([0, 0, angleDeg]));
  trough = arena.track(trough.translate([start.x, start.y, bottomCentreZ]));

  const roundedBottom = arena.track(
    arena.track(startSphere.add(trough)).add(endSphere),
  );
  return arena.track(shaft.add(roundedBottom));
}

/** Builds independent bin-local finger-hole cutters. */
export function buildFingerHoleCutters(
  kernel: Kernel,
  fingerHoles: readonly FingerHole[],
  spec: BinSpec,
  quality: BuildQuality,
): Manifold[] {
  const { arena } = kernel;
  const cutters: Manifold[] = [];
  const segments = quality.circularSegments;

  for (const hole of fingerHoles) {
    const pocket = resolvePocketDepth(spec, { mode: "mm", value: hole.depthMm });
    if (hole.kind === "straight") {
      const floorZ = pocket.floorZ ?? -1;
      const circle = arena.track(
        arena
          .track(kernel.CrossSection.circle(hole.diameterMm / 2, segments))
          .translate([hole.center.x, hole.center.y]),
      );
      cutters.push(
        arena.track(
          arena
            .track(circle.extrude(pocket.cutterTopZ - floorZ))
            .translate([0, 0, floorZ]),
        ),
      );
    } else if (hole.kind === "scoop") {
      cutters.push(
        buildRoundScoopCutter(
          kernel,
          hole,
          BIN_LOCAL_PLACEMENT,
          pocket,
          segments,
        ),
      );
    } else if (hole.kind === "deep-scoop") {
      cutters.push(
        buildDeepScoopCutter(
          kernel,
          hole,
          BIN_LOCAL_PLACEMENT,
          pocket,
          segments,
        ),
      );
    } else if (hole.kind === "oblong-deep-scoop") {
      cutters.push(
        buildOblongDeepScoopCutter(
          kernel,
          hole,
          BIN_LOCAL_PLACEMENT,
          pocket,
          segments,
        ),
      );
    }
  }
  return cutters;
}

/** Builds one cutter per cutout, skipping (and reporting) collapsed ones. */
export function buildCutoutCutters(
  kernel: Kernel,
  shapesById: ReadonlyMap<string, TracedShape>,
  cutouts: readonly CutoutPlacement[],
  spec: BinSpec,
  quality: BuildQuality,
  options: CutoutBuildOptions = {},
): CutoutCutters {
  const { arena } = kernel;
  const cutters: Manifold[] = [];
  const floorInserts: Manifold[] = [];
  const reports: CutoutBuildReport[] = [];
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

    const budgeted = budgetOutline(shape.outlineMm, budget);
    const placed = transformOutlinePlacement(budgeted, cutout);

    let section = toCrossSection(kernel, placed);
    if (cutout.clearanceMm > 0) {
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
    let cutter: Manifold;
    if (pocket.floorZ === null) {
      // Through cut: from below the bin to above the lip.
      cutter = arena.track(
        arena.track(section.extrude(pocket.cutterTopZ + 2)).translate([0, 0, -1]),
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
      const localCutter = bottomFilletCutter(kernel, section, pocket.cutterTopZ - pocket.floorZ, {
        radiusMm: Math.max(effectiveFillet, 0),
        profileStepMm: filletProfileStepMm,
        circularSegments: segments,
      });
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
    }
    cutters.push(cutter);
  }

  return { cutters, floorInserts, reports };
}
