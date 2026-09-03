import type { Manifold } from "manifold-3d";

import {
  resolvePocketDepth,
  transformOutlinePlacement,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { BASE_TOP_RADIUS, binFootprintMm } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";

import { toCrossSection } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";

import type { BuildQuality } from "./bin";
import type { BinLayout } from "./bin";
import { buildCutoutCutters, budgetOutline } from "./cutouts";
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
  });

  let section = toCrossSection(kernel, normalized);
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
 * the base, wall height, label tab or stacking lip.
 */
export function buildSurfaceFitCheckSolid(
  kernel: Kernel,
  spec: BinSpec,
  layout: BinLayout,
  thicknessMm: number,
  quality: BuildQuality,
): Manifold {
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
  const section = spec.footprint.kind === "custom"
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
  let plate = arena.track(
    arena.track(section.extrude(thicknessMm)).translate([
      0,
      0,
      surfaceZ - thicknessMm,
    ]),
  );

  const builtCutouts = buildCutoutCutters(
    kernel,
    layout.shapesById,
    layout.cutouts,
    spec,
    quality,
  );
  if (builtCutouts.cutters.length > 0) {
    const cutter = builtCutouts.cutters.length === 1
      ? builtCutouts.cutters[0]
      : arena.track(Manifold.union(builtCutouts.cutters));
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
