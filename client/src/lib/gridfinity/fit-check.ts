import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
import type { CrossSection, Manifold } from "manifold-3d";

import {
  resolvePlacedPocketDepth,
  resolvePocketDepth,
  transformOutlinePlacement,
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
export function buildFitCheckSolid(
  kernel: Kernel,
  spec: BinSpec,
  layout: BinLayout,
  cutoutId: string,
  depthMm: number,
  quality: BuildQuality,
  gapMm = DEFAULT_SHADOW_INLAY_GAP_MM,
): Manifold {
  if (
    !Number.isFinite(depthMm) ||
    depthMm < FIT_CHECK_MIN_DEPTH_MM ||
    depthMm > FIT_CHECK_MAX_DEPTH_MM
  ) {
    throw new Error(
      `Shadow inlay thickness must be ${FIT_CHECK_MIN_DEPTH_MM}–${FIT_CHECK_MAX_DEPTH_MM} mm.`,
    );
  }
  const cutout = layout.cutouts.find((item) => item.id === cutoutId);
  const shape = cutout && layout.shapesById.get(cutout.shapeId);
  if (!cutout || !shape) throw new Error("Select a tool pocket before exporting its shadow inlay.");
  shadowInlayGapSchema.parse(gapMm);
  const unavailable = shadowInlayUnavailableReason(spec, shape, cutout, depthMm);
  if (unavailable) throw new Error(unavailable);

  const { arena } = kernel;
  const segments = quality.circularSegments;
  const { floorZ, infillTopZ } = resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout);
  if (floorZ === null) throw new Error("This pocket has no supporting floor for a shadow inlay.");
  const { cutters, retainedGroups } = buildCutoutCutters(
    kernel, layout.shapesById,
    [cutout, ...layout.cutouts.filter((item) => item.role === "hole")],
    spec, quality,
  );
  const cavity = cutters[0];
  if (!cavity || cavity.isEmpty()) {
    throw new Error("The selected outline collapsed or has no remaining cavity.");
  }
  const mouth = arena.track(cavity.slice(infillTopZ - CLEANUP_EPSILON));
  if (mouth.isEmpty()) {
    throw new Error("This pocket has no opening at the fill surface for a shadow inlay.");
  }
  if (floorZ + depthMm > cavity.boundingBox().max[2] + CLEANUP_EPSILON) {
    throw new Error("The shadow inlay is thicker than the available pocket cavity.");
  }

  const budget = quality.cutoutVertexBudget ?? 150;
  const normalized = transformOutlinePlacement(budgetOutline(shape.outlineMm, budget), {
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: cutout.mirrored,
    scaleX: cutout.scaleX,
    scaleY: cutout.scaleY,
  });

  let section = toCrossSection(kernel, normalized);
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
  if (gapMm > 0) {
    section = arena.track(arena.track(section.offset(-gapMm, "Round", 2, segments)).simplify(CLEANUP_EPSILON));
  }
  if (section.isEmpty()) {
    throw new Error(
      "The selected outline collapsed under its clearance and corner-round settings.",
    );
  }

  const pocketDepth = cutout.depth.mode === "mm" ? cutout.depth.value
    : cutout.depth.sourceDepthMm ?? resolvePocketDepth(spec, cutout.depth).depthMm ?? 0;
  const radiusMm = Math.min(cutout.bottomFilletMm, pocketDepth / 2);
  const rounded = bottomFilletCutter(kernel, section, Math.max(depthMm, radiusMm), {
    radiusMm,
    profileStepMm: quality.filletProfileStepMm ?? FILLET_PROFILE_STEP_MM,
    circularSegments: segments,
  });
  let solid = arena.track(rounded.trimByPlane([0, 0, -1], -depthMm));
  const { x, y } = cutout.position;
  // An island can block the insert at any point in its vertical travel.
  // Project retained material above the seat and clear its whole footprint.
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
    throw new Error(`buildFitCheckSolid: manifold reported ${status}`);
  }
  const rotated = arena.track(solid.rotate([0, 0, cutout.rotationDeg]));
  const seated = arena.track(rotated.translate([x, y, floorZ]));
  if (arena.track(seated.subtract(cavity)).volume() > FIT_VOLUME_TOLERANCE_MM3) {
    throw new Error("The shadow inlay does not fit in the pocket cavity. Try increasing the edge gap or reducing the thickness.");
  }
  const insertTop = floorZ + depthMm;
  if (insertTop < infillTopZ - CLEANUP_EPSILON) {
    // The rounded insert widens toward its top. Above that height its vertical
    // sweep is the extrusion of its widest section, including island clearance.
    // A mesh projection can fill through-holes where opposite faces meet.
    // Slice the top band so its kept-hole clearances survive the sweep.
    const footprint = arena.track(seated.slice(insertTop - CLEANUP_EPSILON));
    const shaft = arena.track(arena.track(footprint.extrude(infillTopZ - insertTop)).translate([0, 0, insertTop]));
    if (arena.track(shaft.subtract(cavity)).volume() > FIT_VOLUME_TOLERANCE_MM3) {
      throw new Error("The shadow inlay cannot pass through the pocket opening. Try increasing the edge gap.");
    }
  }
  // Other pockets or finger access cuts can remove the selected pocket's
  // nominal floor. Test contact with the bin after the whole layout is cut.
  const { bodySolid } = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [] }, layout, quality);
  const binSeat = arena.track(bodySolid.slice(floorZ - SEAT_PROBE_MM));
  const inlayBase = arena.track(seated.slice(floorZ + CLEANUP_EPSILON));
  if (arena.track(inlayBase.intersect(binSeat)).area() <= MIN_SEAT_CONTACT_MM2) {
    throw new Error("This pocket has no supporting floor for a shadow inlay after all bin cuts.");
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
