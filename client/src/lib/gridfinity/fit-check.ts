import type { Manifold } from "manifold-3d";

import {
  transformOutlinePlacement,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";

import { toCrossSection } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";

import type { BuildQuality } from "./bin";
import { budgetOutline } from "./cutouts";

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
