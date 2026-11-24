import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
import { pointInRing, pointOnSegment } from "@shared/geometry/rings";
import type { Outline, Point } from "@shared/geometry/types";
import type { CrossSection, Manifold } from "manifold-3d";

import {
  resolvePlacedPocketDepth,
  resolvePocketDepth,
  transformOutlinePlacement,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { BASE_TOP_RADIUS, binFootprintMm } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import { DEFAULT_SHADOW_INLAY_GAP_MM, shadowInlayGapSchema, shadowInlayUnavailableReason } from "@shared/gridfinity/shadow-inlay";
import {
  SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM,
  surfaceFitCheckStyleSchema,
  type SurfaceFitCheckStyle,
} from "@shared/gridfinity/fit-check";

import { toCrossSection } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";

import { buildBinWithCutouts, type BinLayout, type BuildQuality } from "./bin";
import {
  buildCutoutCutters,
  buildFingerHoleCutters,
  budgetOutline,
} from "./cutouts";
import { footprintOuterSection } from "./footprint-section";
import { roundedRectPolygon } from "./profiles";
import { bottomFilletCutter, FILLET_PROFILE_STEP_MM } from "./fillet-stack";
import {
  SURFACE_FIT_CHECK_MAX_THICKNESS_MM,
  SURFACE_FIT_CHECK_MIN_THICKNESS_MM,
} from "./worker-api";

const CLEANUP_EPSILON = 1e-6;
const FIT_VOLUME_TOLERANCE_MM3 = 1e-4;
const SEAT_PROBE_MM = 1e-4;
const MIN_SEAT_CONTACT_MM2 = 1e-6;

export const FIT_CHECK_MIN_DEPTH_MM = 0.5;
export const FIT_CHECK_MAX_DEPTH_MM = 30;

function toolSection(kernel: Kernel, outline: Outline, cutout: CutoutPlacement, quality: BuildQuality): CrossSection {
  const { arena } = kernel;
  const segments = quality.circularSegments;
  let section = toCrossSection(kernel, outline);
  const offset = (distance: number) => arena.track(
    arena.track(section.offset(distance, "Round", 2, segments)).simplify(CLEANUP_EPSILON),
  );
  if (!cutout.profileBottom) {
    if (cutout.clearanceMm !== 0) section = offset(cutout.clearanceMm);
    if (cutout.cornerRoundMm > 0) {
      section = offset(-cutout.cornerRoundMm);
      section = offset(cutout.cornerRoundMm);
    }
  }
  return section;
}

function checkToolThickness(depthMm: number, label: string): void {
  if (!Number.isFinite(depthMm) || depthMm < FIT_CHECK_MIN_DEPTH_MM || depthMm > FIT_CHECK_MAX_DEPTH_MM) {
    throw new Error(`${label} thickness must be ${FIT_CHECK_MIN_DEPTH_MM}–${FIT_CHECK_MAX_DEPTH_MM} mm.`);
  }
}

/** The original positive silhouette coupon, independent of the bin's floor. */
export function buildFitCheckSolid(
  kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement, depthMm: number, quality: BuildQuality,
): Manifold {
  checkToolThickness(depthMm, "Fit template");
  const filled = budgetOutline(shape.outlineMm, quality.cutoutVertexBudget ?? 150)
    .map(({ outer }) => ({ outer, holes: [] }));
  const outline = transformOutlinePlacement(filled, {
    position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false, scaleX: cutout.scaleX, scaleY: cutout.scaleY,
  });
  const section = toolSection(kernel, outline, cutout, quality);
  if (section.isEmpty()) throw new Error("The selected outline collapsed under its clearance and corner-round settings.");
  const solid = kernel.arena.track(section.extrude(depthMm));
  const status = solid.status();
  if (status !== "NoError") throw new Error(`buildFitCheckSolid: manifold reported ${status}`);
  return solid;
}

/** Project the solid's uniform-density centroid using signed tetrahedron moments. */
function centerOfMassXY(solid: Manifold): Point {
  const { triVerts, vertProperties, numProp } = solid.getMesh();
  const [originX, originY, originZ] = solid.boundingBox().min;
  let volume6 = 0;
  let momentX = 0;
  let momentY = 0;
  for (let index = 0; index < triVerts.length; index += 3) {
    const a = triVerts[index] * numProp;
    const b = triVerts[index + 1] * numProp;
    const c = triVerts[index + 2] * numProp;
    const ax = vertProperties[a] - originX, ay = vertProperties[a + 1] - originY, az = vertProperties[a + 2] - originZ;
    const bx = vertProperties[b] - originX, by = vertProperties[b + 1] - originY, bz = vertProperties[b + 2] - originZ;
    const cx = vertProperties[c] - originX, cy = vertProperties[c + 1] - originY, cz = vertProperties[c + 2] - originZ;
    const tetrahedron = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    volume6 += tetrahedron;
    momentX += tetrahedron * (ax + bx + cx);
    momentY += tetrahedron * (ay + by + cy);
  }
  return { x: originX + momentX / (4 * volume6), y: originY + momentY / (4 * volume6) };
}
/**
 * Builds a separate shadow inlay from the existing positive fit-template export.
 *
 * The traced outline already contains the Trace-page margin. This builder
 * then applies the pocket's additional clearance and vertical-corner round,
 * exactly as the bin cutter does. The bottom uses the same fillet profile and
 * radius clamp as the cavity, even when the inlay is thinner than that radius.
 * Interior islands remain clear; mirroring and scaling match the pocket, while
 * position and Z rotation are omitted for printing on the build plate.
 */
export function buildShadowInlaySolid(
  kernel: Kernel,
  spec: BinSpec,
  layout: BinLayout,
  cutoutId: string,
  depthMm: number,
  quality: BuildQuality,
  gapMm = DEFAULT_SHADOW_INLAY_GAP_MM,
): Manifold {
  checkToolThickness(depthMm, "Shadow inlay");
  const cutout = layout.cutouts.find((item) => item.id === cutoutId);
  const shape = cutout && layout.shapesById.get(cutout.shapeId);
  if (!cutout || !shape) throw new Error("Select a tool pocket before exporting its shadow inlay.");
  shadowInlayGapSchema.parse(gapMm);
  const unavailable = shadowInlayUnavailableReason(spec, shape, cutout, depthMm);
  if (unavailable) throw new Error(unavailable);

  const { arena } = kernel;
  const segments = quality.circularSegments;
  const { floorZ, axialDepthMm } = resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout);
  if (floorZ === null) throw new Error("This pocket has no supporting floor for a shadow inlay.");

  const budget = quality.cutoutVertexBudget ?? 150;
  const normalized = transformOutlinePlacement(budgetOutline(shape.outlineMm, budget), {
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: cutout.mirrored,
    scaleX: cutout.scaleX,
    scaleY: cutout.scaleY,
  });

  let section = toolSection(kernel, normalized, cutout, quality);
  if (gapMm > 0) {
    section = arena.track(arena.track(section.offset(-gapMm, "Round", 2, segments)).simplify(CLEANUP_EPSILON));
  }
  if (section.isEmpty()) {
    throw new Error(
      "The selected outline collapsed under its clearance and corner-round settings.",
    );
  }

  const radiusMm = Math.min(cutout.bottomFilletMm, (axialDepthMm ?? 0) / 2);
  const rounded = bottomFilletCutter(kernel, section, Math.max(depthMm, radiusMm), {
    radiusMm,
    profileStepMm: quality.filletProfileStepMm ?? FILLET_PROFILE_STEP_MM,
    circularSegments: segments,
  });
  let solid = arena.track(rounded.trimByPlane([0, 0, -1], -depthMm));
  const { x, y } = cutout.position;
  // An island can block the insert at any point in its vertical travel.
  // Project retained material above the seat and clear its whole footprint.
  const { retainedGroups } = buildCutoutCutters(kernel, layout.shapesById,
    layout.cutouts.filter((item) => item.role === "hole"), spec, quality);
  const retained = retainedGroups?.flatMap(({ volumes }) => volumes) ?? [];
  if (retained.length) {
    const clearances = retained
      .map((part) => arena.track(part.trimByPlane([0, 0, 1], floorZ + CLEANUP_EPSILON)))
      .filter((part) => !part.isEmpty())
      .map((part) => {
        const centered = arena.track(part.translate([-x, -y, 0]));
        const local = arena.track(centered.rotate([0, 0, -cutout.rotationDeg]));
        const footprint = arena.track(local.project());
        return gapMm > 0 ? arena.track(footprint.offset(gapMm, "Round", 2, segments)) : footprint;
      });
    if (clearances.length) {
      const clearance = arena.track(kernel.CrossSection.union(clearances));
      solid = arena.track(solid.subtract(arena.track(clearance.extrude(depthMm))));
    }
  }

  const status = solid.status();
  if (status !== "NoError" || solid.isEmpty() || solid.boundingBox().min[2] > CLEANUP_EPSILON) {
    if (status === "NoError") throw new Error("The shadow inlay has no flat seat after bottom rounding. Reduce the gap or bottom fillet.");
    throw new Error(`buildShadowInlaySolid: manifold reported ${status}`);
  }
  const rotated = arena.track(solid.rotate([0, 0, cutout.rotationDeg]));
  const seated = arena.track(rotated.translate([x, y, floorZ]));
  const { solid: bin } = buildBinWithCutouts(kernel, spec, layout, quality);
  if (arena.track(seated.intersect(bin)).volume() > FIT_VOLUME_TOLERANCE_MM3) {
    throw new Error("The shadow inlay does not fit in the finished pocket. Try increasing the edge gap or reducing the thickness.");
  }
  const insertTop = floorZ + depthMm;
  const binTop = bin.boundingBox().max[2];
  if (binTop > insertTop + CLEANUP_EPSILON) {
    // Lower sections are nested inside higher ones. Above the seated inlay,
    // extrude its top slice through the finished rim, preserving island holes.
    const footprint = arena.track(seated.slice(insertTop - CLEANUP_EPSILON));
    const shaft = arena.track(arena.track(footprint.extrude(binTop - insertTop)).translate([0, 0, insertTop]));
    if (arena.track(shaft.intersect(bin)).volume() > FIT_VOLUME_TOLERANCE_MM3) {
      throw new Error("The shadow inlay cannot pass through the pocket opening in the finished bin. Try increasing the edge gap.");
    }
  }
  const binSeat = arena.track(bin.slice(floorZ - SEAT_PROBE_MM));
  for (const piece of arena.trackAll(seated.decompose())) {
    const base = arena.track(piece.slice(floorZ + CLEANUP_EPSILON));
    const contact = arena.track(base.intersect(binSeat));
    if (contact.area() <= MIN_SEAT_CONTACT_MM2) {
      throw new Error("This pocket has no supporting floor for at least one shadow inlay piece after all bin cuts.");
    }
    // A piece can bridge a hole when its weight is inside the hull of its
    // contact patches. Weight on or outside a hull edge can tip the piece.
    const [polygon] = arena.track(contact.hull()).toPolygons();
    const hull = polygon.map(([x, y]) => ({ x, y }));
    const center = centerOfMassXY(piece);
    if (!pointInRing(hull, center) || hull.some((point, i) => pointOnSegment(point, hull[(i + 1) % hull.length], center, CLEANUP_EPSILON))) {
      throw new Error("A shadow inlay piece would tip because its remaining floor support is off-center.");
    }
  }
  return solid;
}

/**
 * Builds a thin, build-plate-ready copy of the bin's complete pocket-layout
 * surface. The plate uses the real outer footprint and every pocket/finger
 * cutter at the actual infill-top elevation, so spacing, clearance, top-edge
 * rounds and access features match the bin. It deliberately builds none of
 * the base, wall height, label tab or stacking lip. Outline style keeps only
 * 5 mm material bands around the tool openings, independent of the bin's
 * footprint and separate finger access features.
 */
export function buildSurfaceFitCheckSolid(
  kernel: Kernel,
  spec: BinSpec,
  layout: BinLayout,
  thicknessMm: number,
  quality: BuildQuality,
  style: SurfaceFitCheckStyle = "full",
): Manifold {
  surfaceFitCheckStyleSchema.parse(style);
  if (
    !Number.isFinite(thicknessMm) ||
    thicknessMm < SURFACE_FIT_CHECK_MIN_THICKNESS_MM ||
    thicknessMm > SURFACE_FIT_CHECK_MAX_THICKNESS_MM
  ) {
    throw new Error(
      `Surface fit test thickness must be ${SURFACE_FIT_CHECK_MIN_THICKNESS_MM}–${SURFACE_FIT_CHECK_MAX_THICKNESS_MM} mm.`,
    );
  }

  const { Manifold, CrossSection, arena } = kernel;
  const segments = quality.circularSegments;
  const surfaceZ = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  const builtCutouts = buildCutoutCutters(
    kernel,
    layout.shapesById,
    layout.cutouts,
    spec,
    quality,
  );
  const allCutters = style === "outline"
    ? builtCutouts.cutters
    : [
        ...builtCutouts.cutters,
        ...buildFingerHoleCutters(kernel, layout.fingerHoles, spec, quality),
      ];
  const cutter = allCutters.length === 0 ? null
    : allCutters.length === 1 ? allCutters[0]
    : arena.track(Manifold.union(allCutters));
  let section: CrossSection;
  if (style === "outline") {
    if (!cutter) throw new Error("Add a tool pocket to export tool outlines.");
    // Grow the tool openings outwards by 5 mm. Using the cutters preserves
    // clearance and rounded edges, without adding a bin-perimeter band or
    // clipping a tool's band when it is near the bin edge.
    const openings = arena.track(
      arena.track(cutter.slice(surfaceZ - CLEANUP_EPSILON)).simplify(CLEANUP_EPSILON),
    );
    section = arena.track(
      arena.track(openings.offset(SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM, "Round", 2, segments))
        .simplify(CLEANUP_EPSILON),
    );
  } else {
    section = spec.footprint.kind === "custom"
      ? footprintOuterSection(kernel, spec, segments)
      : arena.track(
          new CrossSection([
            roundedRectPolygon(
              binWidthMm(spec),
              binLengthMm(spec),
              BASE_TOP_RADIUS,
              segments,
            ),
          ]),
        );
  }
  let plate = arena.track(
    arena.track(section.extrude(thicknessMm)).translate([
      0,
      0,
      surfaceZ - thicknessMm,
    ]),
  );

  if (cutter) {
    plate = arena.track(plate.subtract(cutter));
  }

  // Rest the test surface on z=0 regardless of the source bin's height.
  const printable = arena.track(plate.translate([0, 0, thicknessMm - surfaceZ]));
  const status = printable.status();
  if (status !== "NoError" || printable.isEmpty()) {
    throw new Error(
      status === "NoError"
        ? "Surface fit test has no printable material after applying the pockets."
        : `buildSurfaceFitCheckSolid: manifold reported ${status}`,
    );
  }
  return printable;
}
