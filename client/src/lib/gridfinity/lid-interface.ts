import type { Manifold, Vec3 } from "manifold-3d";
import type { BinSpec } from "@shared/gridfinity/types";
import { binHeightMm } from "@shared/gridfinity/standard";
import { hasOverlappingLid, hasSpringLatch, usesCompliantInterface, lidCapTopMm, lidTopMm,
  lidBottomMm, INSET_LID_CAP_BOTTOM_MM, lidFitAdjustmentMm, LID_FRICTION_INTERFERENCE_MM } from "@shared/gridfinity/magnetic-lid";
import { lidInterfaceFrames, SPRING_THICKNESS_MM, FIN_THICKNESS_MM, FIN_CAP_GAP_MM, INTERFACE_WINDOW_WIDTH_MM,
  INTERFACE_BACK_MM, DETENT_ENGAGEMENT_MM, DETENT_RECESS_DEPTH_MM, type LidInterfaceFrame } from "@shared/gridfinity/lid-interface";
import type { Kernel } from "@/lib/manifold/runtime";

/** Original geometry based on the mechanisms illustrated in Slant3D's lid-design video.
 * Dimensions are prototype starting values, not a physically qualified spring design.
 * Local +y is the free travel direction, away from the bin's mating face at y=0.
 */
function box(kernel: Kernel, low: Vec3, high: Vec3): Manifold {
  const { arena, Manifold } = kernel;
  return arena.track(arena.track(Manifold.cube(high.map((v, i) => v - low[i]) as Vec3)).translate(low));
}

function place(kernel: Kernel, solid: Manifold, frame: LidInterfaceFrame, z = 0): Manifold {
  const { arena } = kernel;
  return arena.track(arena.track(arena.track(solid.scale([1, frame.direction, 1]))
    .translate([frame.along, frame.face, z])).rotate([0, 0, frame.angle]));
}

/** Extruded round-ended strip; rounded roots avoid sharp internal spring corners. */
function strip(kernel: Kernel, a: [number, number], b: [number, number], thickness: number,
  bottom: number, top: number, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const end = arena.track(Manifold.cylinder(top - bottom, thickness / 2, thickness / 2, segments));
  return arena.track(Manifold.hull([
    arena.track(end.translate([a[0], a[1], bottom])),
    arena.track(end.translate([b[0], b[1], bottom])),
  ]));
}

/** Smooth, symmetric entry/exit ramps allow a detent to release by lifting the lid. */
function contact(kernel: Kernel, frame: LidInterfaceFrame, engagement: number, recess: boolean, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const ellipsoid = arena.track(arena.track(Manifold.sphere(1, segments)).scale([
    recess ? 2 : 1.6, 0.35 + engagement, recess ? 0.95 : 0.65,
  ]));
  return arena.track(ellipsoid.translate([6.5, 0.35, frame.contactZ]));
}

function sideSpring(kernel: Kernel, frame: LidInterfaceFrame, top: number, segments: number): Manifold {
  return strip(kernel, [-10.6, 0.75], [8.6, 0.75], SPRING_THICKNESS_MM, frame.bottom, top, segments);
}

/** A folded strip connects one fixed end to a free detent head. No cap lies underneath it. */
function foldedSpring(kernel: Kernel, frame: LidInterfaceFrame, top: number, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const path: [number, number][] = [
    [-10.6, 0.75], [-8, 0.75], [-8, 1.95], [-6, 1.95], [-6, 0.6],
    [-4, 0.6], [-4, 1.95], [-2, 1.95], [-2, 0.6], [0, 0.6],
    [0, 1.95], [2, 1.95], [2, 1.2], [4.2, 1.2],
  ];
  const pieces = path.slice(1).map((p, i) => strip(kernel, path[i], p, SPRING_THICKNESS_MM, frame.bottom, top, segments));
  pieces.push(box(kernel, [3.8, 0.3, frame.bottom], [8.6, 2.1, top]));
  return arena.track(Manifold.union(pieces));
}

/** Parallel angled fingers with a tapered lower entry and clear gaps between blades. */
function fins(kernel: Kernel, spec: BinSpec, frame: LidInterfaceFrame, top: number, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const engagement = LID_FRICTION_INTERFERENCE_MM + lidFitAdjustmentMm(spec);
  const pieces: Manifold[] = [];
  for (let along = -7.2; along <= 7.21; along += 2.4) {
    pieces.push(strip(kernel, [along - 1.5, INTERFACE_BACK_MM + 0.3],
      [along + 1.5, FIN_THICKNESS_MM / 2 - engagement], FIN_THICKNESS_MM, frame.bottom, top, segments));
  }
  // Clip the fin tips to an entry ramp. The working faces above it retain the selected fit.
  const ramp = arena.track(Manifold.hull(([-11, 11] as const).flatMap(x => [
    [x, -1, frame.bottom - 0.1], [x, 0.6, frame.bottom - 0.1],
    [x, -engagement, frame.bottom + 0.75], [x, -1, frame.bottom + 0.75],
  ] as Vec3[])));
  return arena.track(arena.track(Manifold.union(pieces)).subtract(ramp));
}

/** Through-slots isolate spring beams in XY; fins retain the solid top of the lid. */
export function applyLidInterface(kernel: Kernel, spec: BinSpec, lid: Manifold, segments: number): Manifold {
  if (!usesCompliantInterface(spec)) return lid;
  const { arena, Manifold } = kernel;
  const capBottom = hasOverlappingLid(spec) ? 0 : INSET_LID_CAP_BOTTOM_MM;
  const isFins = spec.lidInterface === "angled-fins";
  const windows: Manifold[] = [], mechanisms: Manifold[] = [];
  for (const frame of lidInterfaceFrames(spec)) {
    const opening = box(kernel, [-INTERFACE_WINDOW_WIDTH_MM / 2, -0.65, lidBottomMm(spec) - 0.1],
      [INTERFACE_WINDOW_WIDTH_MM / 2, INTERFACE_BACK_MM, isFins ? capBottom : lidTopMm(spec) + 0.1]);
    windows.push(place(kernel, opening, frame));
    const top = isFins ? capBottom - FIN_CAP_GAP_MM : lidCapTopMm(spec);
    // Fingers attach only at their roots. A release gap below the cap lets
    // them bend sideways instead of being welded to it along their length.
    const backingTop = isFins ? capBottom + 0.05 : top;
    const backing = box(kernel, [-11, INTERFACE_BACK_MM, frame.bottom], [11, INTERFACE_BACK_MM + 0.8, backingTop]);
    let mechanism: Manifold;
    if (isFins) mechanism = fins(kernel, spec, frame, top, segments);
    else {
      mechanism = hasSpringLatch(spec) ? foldedSpring(kernel, frame, top, segments) : sideSpring(kernel, frame, top, segments);
      const engagement = (hasSpringLatch(spec) ? DETENT_ENGAGEMENT_MM : LID_FRICTION_INTERFERENCE_MM) + lidFitAdjustmentMm(spec);
      mechanism = arena.track(mechanism.add(contact(kernel, frame, engagement, false, segments)));
    }
    mechanisms.push(place(kernel, arena.track(mechanism.add(backing)), frame));
  }
  const opened = arena.track(lid.subtract(arena.track(Manifold.union(windows))));
  return arena.track(opened.add(arena.track(Manifold.union(mechanisms))));
}

/** Matching body recesses use a fixed envelope, so fit tuning only needs a new lid. */
export function addLidDetentRecesses(kernel: Kernel, spec: BinSpec, body: Manifold, segments: number): Manifold {
  if (!hasSpringLatch(spec)) return body;
  const { arena, Manifold } = kernel;
  const recesses = lidInterfaceFrames(spec).map(frame => place(kernel,
    contact(kernel, frame, DETENT_RECESS_DEPTH_MM, true, segments), frame, binHeightMm(spec.heightUnits)));
  return arena.track(body.subtract(arena.track(Manifold.union(recesses))));
}

/** Reserve the load-bearing rim around each detent against pocket and finger-access cuts. */
export function lidDetentKeepout(kernel: Kernel, spec: BinSpec): Manifold {
  const { arena, Manifold } = kernel;
  return arena.track(Manifold.union(lidInterfaceFrames(spec).map(frame => place(kernel,
    box(kernel, [4, -2.1, frame.contactZ - 1.1], [9, 0.05, frame.contactZ + 1.1]),
    frame, binHeightMm(spec.heightUnits)))));
}
