import type { CrossSection, Manifold } from "manifold-3d";

import {
  resolvePocketDepth,
  transformOutlinePlacement,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { BASE_TOP_RADIUS, binFootprintMm } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import {
  SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM,
  surfaceFitCheckStyleSchema,
  type SurfaceFitCheckStyle,
} from "@shared/gridfinity/fit-check";

import { toCrossSection } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";

import type { BuildQuality } from "./bin";
import type { BinLayout } from "./bin";
import {
  buildCutoutCutters,
  buildFingerHoleCutters,
  budgetOutline,
} from "./cutouts";
import { footprintOuterSection } from "./footprint-section";
import { roundedRectPolygon } from "./profiles";
import {
  SURFACE_FIT_CHECK_MAX_THICKNESS_MM,
  SURFACE_FIT_CHECK_MIN_THICKNESS_MM,
} from "./worker-api";

const CLEANUP_EPSILON = 1e-6;

export const FIT_CHECK_MIN_DEPTH_MM = 0.5;
export const FIT_CHECK_MAX_DEPTH_MM = 30;
/**
 * Builds a small, positive fit template from one selected pocket.
 *
 * The traced outline already contains the Trace-page margin. This builder
 * then applies the pocket's additional clearance and vertical-corner round,
 * exactly as the bin cutter does, before extruding it to the requested test
 * thickness. Interior rings are deliberately filled: the template represents
 * the tool's outside silhouette, not incidental holes detected inside it.
 * Finger access and top/bottom edge fillets are bin-only geometry and are not
 * part of this inexpensive silhouette check.
 */
export function buildFitCheckSolid(
  kernel: Kernel,
  shape: TracedShape,
  cutout: CutoutPlacement,
  depthMm: number,
  quality: BuildQuality,
): Manifold {
  if (
    !Number.isFinite(depthMm) ||
    depthMm < FIT_CHECK_MIN_DEPTH_MM ||
    depthMm > FIT_CHECK_MAX_DEPTH_MM
  ) {
    throw new Error(
      `Fit template thickness must be ${FIT_CHECK_MIN_DEPTH_MM}–${FIT_CHECK_MAX_DEPTH_MM} mm.`,
    );
  }

  const { arena } = kernel;
  const segments = quality.circularSegments;
  const budget = quality.cutoutVertexBudget ?? 150;
  const filled = budgetOutline(shape.outlineMm, budget).map((part) => ({
    outer: part.outer,
    holes: [],
  }));
  const normalized = transformOutlinePlacement(filled, {
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
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
  if (section.isEmpty()) {
    throw new Error(
      "The selected outline collapsed under its clearance and corner-round settings.",
    );
  }

  const solid = arena.track(section.extrude(depthMm));
  const status = solid.status();
  if (status !== "NoError") {
    throw new Error(`buildFitCheckSolid: manifold reported ${status}`);
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
 * footprint and separate finger-access holes.
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
              binFootprintMm(spec.gridX, spec.gridPitch),
              binFootprintMm(spec.gridY, spec.gridPitch),
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
