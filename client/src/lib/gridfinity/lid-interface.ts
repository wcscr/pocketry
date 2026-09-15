import type { Manifold, Vec2, Vec3 } from "manifold-3d";
import type { BinSpec } from "@shared/gridfinity/types";
import { binHeightMm } from "@shared/gridfinity/standard";
import { hasOverlappingLid, hasSpringLatch, usesCompliantInterface,
  lidBottomMm, INSET_LID_CAP_BOTTOM_MM, lidFitAdjustmentMm, LID_FRICTION_INTERFERENCE_MM } from "@shared/gridfinity/magnetic-lid";
import { lidInterfaceFrames, SPRING_THICKNESS_MM, FIN_THICKNESS_MM, INTERFACE_CAP_GAP_MM,
  INTERFACE_BACK_MM, LATCH_BACK_MM, LATCH_SPRING_HALF_HEIGHT_MM, LATCH_COVER_THICKNESS_MM,
  DETENT_ENGAGEMENT_MM, DETENT_RECESS_DEPTH_MM, type LidInterfaceFrame } from "@shared/gridfinity/lid-interface";
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
function contact(kernel: Kernel, frame: LidInterfaceFrame, engagement: number, recess: boolean, segments: number, x: number): Manifold {
  const { arena, Manifold } = kernel;
  const ellipsoid = arena.track(arena.track(Manifold.sphere(1, segments)).scale([
    recess ? 2 : 1.6, 0.35 + engagement, recess ? 0.95 : 0.65,
  ]));
  return arena.track(ellipsoid.translate([x, 0.35, frame.contactZ]));
}

function sideSpring(kernel: Kernel, frame: LidInterfaceFrame, top: number, segments: number): Manifold {
  return strip(kernel, [-10.6, 0.75], [8.1, 0.75], SPRING_THICKNESS_MM, frame.bottom, top, segments);
}

/** Three rounded folds stack along +y, perpendicular to the mating edge.
 * The head retracts toward the root at the back of its covered chamber.
 */
function foldedSpring(kernel: Kernel, frame: LidInterfaceFrame, top: number, segments: number): Manifold {
  const { arena, CrossSection } = kernel;
  const path: [number, number][] = [[0, 1.4], [0, 2], [3, 2]];
  const steps = Math.max(8, segments / 2);
  const turn = (x: number, y: number, direction: 1 | -1) => {
    for (let i = 1; i <= steps; i++) {
      const angle = -Math.PI / 2 + direction * Math.PI * i / steps;
      path.push([x + Math.cos(angle), y + Math.sin(angle)]);
    }
  };
  turn(3, 3, 1);
  path.push([-3, 4]);
  turn(-3, 5, -1);
  path.push([3, 6]);
  turn(3, 7, 1);
  path.push([0, 8], [0, LATCH_BACK_MM + 0.3]);
  // Offset the already rounded centerline in 2D, then extrude once. This
  // preserves the curved U bends without hundreds of 3D capsule booleans.
  const normals = path.slice(1).map((p, i): Vec2 => {
    const dx = p[0] - path[i][0], dy = p[1] - path[i][1];
    const length = Math.hypot(dx, dy);
    return [-dy / length, dx / length];
  });
  const offset = (sign: number): Vec2[] => path.map((p, i) => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    const scale = sign * SPRING_THICKNESS_MM / 2 / (1 + a[0] * b[0] + a[1] * b[1]);
    return [p[0] + (a[0] + b[0]) * scale, p[1] + (a[1] + b[1]) * scale];
  });
  const section = arena.track(new CrossSection([[...offset(-1), ...offset(1).reverse()]]));
  const spring = arena.track(arena.track(section.extrude(top - frame.bottom)).translate([0, 0, frame.bottom]));
  // Bevel both leading edges so the head clears the chamber's printed bridges.
  const head = arena.track(kernel.Manifold.hull([-3, 3].flatMap(x => [
    [x, 0.3, frame.bottom + 0.2], [x, 0.5, frame.bottom], [x, 1.6, frame.bottom],
    [x, 1.6, top], [x, 0.5, top], [x, 0.3, top - 0.2],
  ] as Vec3[])));
  return arena.track(spring.add(head));
}

/** Closed above and below; only the centered plunger aperture opens at the edge. */
function latchHousing(kernel: Kernel, frame: LidInterfaceFrame, capBottom: number): Manifold {
  const { arena, Manifold } = kernel;
  const half = frame.width / 2;
  const floorTop = frame.bottom - INTERFACE_CAP_GAP_MM;
  const floorBottom = Math.max(0, floorTop - LATCH_COVER_THICKNESS_MM);
  const ceiling = frame.contactZ + LATCH_SPRING_HALF_HEIGHT_MM + INTERFACE_CAP_GAP_MM;
  const roofTop = capBottom + 0.05;
  const back = LATCH_BACK_MM + 0.8;
  // The lower cover follows the locator's entry slope, keeping it clear of
  // the bin while hiding the spring when the lid is viewed from underneath.
  const floor = arena.track(Manifold.hull([floorBottom, floorTop].flatMap(z =>
    [-half - 0.8, half + 0.8].flatMap(x => [
      [x, 0.3 + floorTop - z, z], [x, back, z],
    ] as Vec3[]))));
  const pieces = [floor,
    box(kernel, [-half - 0.8, 0.3, ceiling], [half + 0.8, back, roofTop]),
    box(kernel, [-half - 0.8, LATCH_BACK_MM, floorBottom], [half + 0.8, back, roofTop]),
  ];
  for (const x of [-half - 0.8, half]) {
    pieces.push(box(kernel, [x, 0.3, floorTop], [x + 0.8, back, roofTop]));
  }
  // A 0.3 mm gap surrounds the 6 mm head, screening the folds from the side.
  for (const [left, right] of [[-half - 0.8, -3.3], [3.3, half + 0.8]]) {
    pieces.push(box(kernel, [left, 0.3, floorTop], [right, 1.1, ceiling]));
  }
  return arena.track(Manifold.union(pieces));
}

/** Parallel angled fingers with a tapered lower entry and clear gaps between blades. */
function fins(kernel: Kernel, spec: BinSpec, frame: LidInterfaceFrame, top: number, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const engagement = LID_FRICTION_INTERFERENCE_MM + lidFitAdjustmentMm(spec);
  const pieces: Manifold[] = [];
  const reach = INTERFACE_BACK_MM + 0.3 - (FIN_THICKNESS_MM / 2 - engagement);
  // Equal material and air measured perpendicular to the angled blades.
  // Project that spacing along the edge so the 0.6 mm fins have 0.6 mm gaps.
  const pitch = 2 * FIN_THICKNESS_MM * Math.hypot(3, reach) / reach;
  const count = Math.max(1, Math.floor((frame.width - 3.6) / pitch) + 1);
  for (let i = 0; i < count; i++) {
    const along = (i - (count - 1) / 2) * pitch;
    pieces.push(strip(kernel, [along - 1.5, INTERFACE_BACK_MM + 0.3],
      [along + 1.5, FIN_THICKNESS_MM / 2 - engagement], FIN_THICKNESS_MM, frame.bottom, top, segments));
  }
  // Clip the fin tips to an entry ramp. The working faces above it retain the selected fit.
  const ramp = arena.track(Manifold.hull(([-frame.width / 2 - 1, frame.width / 2 + 1]).flatMap(x => [
    [x, -1, frame.bottom - 0.1], [x, 0.6, frame.bottom - 0.1],
    [x, -engagement, frame.bottom + 0.75], [x, -1, frame.bottom + 0.75],
  ] as Vec3[])));
  return arena.track(arena.track(Manifold.union(pieces)).subtract(ramp));
}

/** All moving interfaces sit beneath a solid cap with a printable release gap. */
export function applyLidInterface(kernel: Kernel, spec: BinSpec, lid: Manifold, segments: number): Manifold {
  if (!usesCompliantInterface(spec)) return lid;
  const { arena, Manifold } = kernel;
  const capBottom = hasOverlappingLid(spec) ? 0 : INSET_LID_CAP_BOTTOM_MM;
  const isFins = spec.lidInterface === "angled-fins";
  const isLatch = hasSpringLatch(spec);
  const windows: Manifold[] = [], mechanisms: Manifold[] = [];
  for (const frame of lidInterfaceFrames(spec)) {
    const back = isLatch ? LATCH_BACK_MM : INTERFACE_BACK_MM;
    const half = frame.width / 2;
    const opening = box(kernel, [-half, -0.65, lidBottomMm(spec) - 0.1],
      [half, back, capBottom]);
    windows.push(place(kernel, opening, frame));
    const top = isLatch ? frame.contactZ + LATCH_SPRING_HALF_HEIGHT_MM : capBottom - INTERFACE_CAP_GAP_MM;
    // Fingers attach only at their roots. A release gap below the cap lets
    // them bend sideways instead of being welded to it along their length.
    const backingTop = capBottom + 0.05;
    let mechanism: Manifold;
    if (isFins) mechanism = fins(kernel, spec, frame, top, segments);
    else {
      mechanism = isLatch ? foldedSpring(kernel, frame, top, segments) : sideSpring(kernel, frame, top, segments);
      const engagement = (isLatch ? DETENT_ENGAGEMENT_MM : LID_FRICTION_INTERFERENCE_MM) + lidFitAdjustmentMm(spec);
      mechanism = arena.track(mechanism.add(contact(kernel, frame, engagement, false, segments, isLatch ? 0 : 6.5)));
    }
    const housing = isLatch ? latchHousing(kernel, frame, capBottom)
      : box(kernel, [-half - 0.8, back, frame.bottom], [half + 0.8, back + 0.8, backingTop]);
    mechanisms.push(place(kernel, arena.track(mechanism.add(housing)), frame));
  }
  const opened = arena.track(lid.subtract(arena.track(Manifold.union(windows))));
  return arena.track(opened.add(arena.track(Manifold.union(mechanisms))));
}

/** Matching body recesses use a fixed envelope, so fit tuning only needs a new lid. */
export function addLidDetentRecesses(kernel: Kernel, spec: BinSpec, body: Manifold, segments: number): Manifold {
  if (!hasSpringLatch(spec)) return body;
  const { arena, Manifold } = kernel;
  const recesses = lidInterfaceFrames(spec).map(frame => place(kernel,
    contact(kernel, frame, DETENT_RECESS_DEPTH_MM, true, segments, 0), frame, binHeightMm(spec.heightUnits)));
  return arena.track(body.subtract(arena.track(Manifold.union(recesses))));
}

/** Reserve the load-bearing rim around each detent against pocket and finger-access cuts. */
export function lidDetentKeepout(kernel: Kernel, spec: BinSpec): Manifold {
  const { arena, Manifold } = kernel;
  return arena.track(Manifold.union(lidInterfaceFrames(spec).map(frame => place(kernel,
    box(kernel, [-2.5, -2.1, frame.contactZ - 1.1], [2.5, 0.05, frame.contactZ + 1.1]),
    frame, binHeightMm(spec.heightUnits)))));
}
