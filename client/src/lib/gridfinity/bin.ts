// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { Manifold } from "manifold-3d";

import type {
  CutoutPlacement,
  FingerHole,
  TracedShape,
} from "@shared/gridfinity/cutout";
import {
  BASE_HEIGHT,
  BASE_TOP_RADIUS,
  binFootprintMm,
  binHeightMm,
  binTotalHeightMm,
  binWallHeightMm,
  STACKING_LIP_HEIGHT_ACTUAL,
  STACKING_LIP_SUPPORT_HEIGHT,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
} from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";

import type { Kernel } from "@/lib/manifold/runtime";

import { buildBase } from "./base";
import {
  buildCutoutCutters,
  buildFingerHoleCutters,
  type CutoutBuildReport,
} from "./cutouts";
import { holeOptionsFromSpec } from "./holes";
import { buildLabelTab } from "./label-tab";
import { buildLiteBase } from "./lite-base";
import { roundedRectPolygon } from "./profiles";
import { footprintOuterSection } from "./footprint-section";
import { buildStackingLip, buildWallRing } from "./wall";

/**
 * Bin assembly: base + wall + lip + optional infill, ported from upstream
 * `bin_render()` / `bin_render_infill()` in src/core/bin.scad @ 910e22d8.
 *
 * `buildBinParts` returns the pieces individually — the multicolor hook from
 * the plan: 3MF can express multiple objects, so keeping `{base, wall, lip,
 * infill}` apart costs nothing now and saves a restructuring later. Parts may
 * overlap (the infill spans the full footprint, the lip's support overlaps
 * the wall band, both as upstream builds them); `buildBin` fuses them for the
 * single-object export.
 *
 * Frame: XY-centred, z = 0 at the bottom of the base, z = `heightUnits·7` at
 * the nominal rim, lip above that.
 */

export interface BuildQuality {
  /** Segments per full circle for every arc. Multiple of 8, ≥ 16. */
  circularSegments: number;
  /**
   * Max vertices per cutout ring before offsetting (see cutouts.ts).
   * Optional so quality objects in older call sites stay valid; the cutter
   * builder falls back to the preview budget.
   */
  cutoutVertexBudget?: number;
  /**
   * Maximum vertical distance between sampled pocket-fillet bands. Preview
   * builds can use coarser bands; export retains the fabrication-quality
   * 0.1 mm profile independently of the eventual slicer layer height.
   */
  filletProfileStepMm?: number;
}

/** Coarse arcs and fillet bands for a responsive interactive preview. */
export const PREVIEW_QUALITY: BuildQuality = {
  circularSegments: 24,
  cutoutVertexBudget: 100,
  filletProfileStepMm: 0.5,
};

/** Fine arcs for export (~0.004 mm corner sag). */
export const EXPORT_QUALITY: BuildQuality = {
  circularSegments: 64,
  cutoutVertexBudget: 600,
  filletProfileStepMm: 0.1,
};

/** Default: three nominal 0.2 mm layers below each pocket-floor surface. */
export const MULTICOLOR_FLOOR_THICKNESS_MM = 0.6;
/** Default material depth down from the stacking-lip summit. */
export const MULTICOLOR_RIM_THICKNESS_MM = 1.25;
export const MULTICOLOR_MIN_THICKNESS_MM = 0.2;
export const MULTICOLOR_FLOOR_MAX_THICKNESS_MM = 3;
/** Full modeled lip depth, rounded down to a practical 0.01 mm UI increment. */
export const MULTICOLOR_RIM_MAX_THICKNESS_MM = Math.floor(
  (STACKING_LIP_HEIGHT_ACTUAL + STACKING_LIP_SUPPORT_HEIGHT_MM) * 100,
) / 100;

export interface BinParts {
  /** Sockets plus bridge, z ∈ [0, 7]. */
  base: Manifold;
  /** Plain wall ring, z ∈ [7, units·7]. `null` for 1u bins (zero height). */
  wall: Manifold | null;
  /** Stacking lip swept around the rim. `null` when `spec.lip` is "none". */
  lip: Manifold | null;
  /** Solid interior fill. `null` unless `spec.fill` is "solid" with room. */
  infill: Manifold | null;
}

/** The infill's height: wall minus the lip's inner support, clamped at 0. */
export function infillHeightMm(spec: BinSpec): number {
  const lipAllowance = spec.lip === "standard" ? STACKING_LIP_SUPPORT_HEIGHT : 0;
  return Math.max(binWallHeightMm(spec.heightUnits) - lipAllowance, 0);
}

/** Outer dimensions of the bin a spec describes, without building it. */
export function binDimensionsMm(spec: BinSpec): {
  widthMm: number;
  lengthMm: number;
  heightToRimMm: number;
  totalHeightMm: number;
} {
  return {
    widthMm: binFootprintMm(spec.gridX, spec.gridPitch),
    lengthMm: binFootprintMm(spec.gridY, spec.gridPitch),
    heightToRimMm: binHeightMm(spec.heightUnits),
    totalHeightMm: binTotalHeightMm(spec.heightUnits, spec.lip === "standard"),
  };
}

/** Builds the tagged parts of a bin, each tracked in `kernel.arena`. */
export function buildBinParts(
  kernel: Kernel,
  spec: BinSpec,
  quality: BuildQuality,
): BinParts {
  const { CrossSection, arena } = kernel;
  const segments = quality.circularSegments;

  // Lite bases ignore holes (no bosses yet); validation surfaces the clash.
  const base = spec.liteBase
    ? buildLiteBase(kernel, spec, segments)
    : buildBase(
        kernel,
        spec,
        segments,
        spec.gridPitch === "full" ? holeOptionsFromSpec(spec) : undefined,
      );
  let wall = buildWallRing(kernel, spec, segments);
  const lip = spec.lip === "standard"
    ? buildStackingLip(kernel, spec, segments, quality.filletProfileStepMm)
    : null;

  // The label tab fuses into the wall part: it is wall material, and keeping
  // BinParts' tag set stable preserves the multicolor hook unchanged.
  const tab = buildLabelTab(kernel, spec, segments);
  if (tab) {
    wall = wall ? arena.track(wall.add(tab)) : tab;
  }

  let infill: Manifold | null = null;
  const fillHeight = infillHeightMm(spec);
  if (spec.fill === "solid" && fillHeight > 0) {
    // Full footprint like upstream (minus their preview-only TOLLERANCE
    // shave): overlapping the wall is deliberate, the union dedupes it.
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
    infill = arena.track(
      arena.track(section.extrude(fillHeight)).translate([0, 0, BASE_HEIGHT]),
    );
  }

  return { base, wall, lip, infill };
}

export interface BinLayout {
  shapesById: ReadonlyMap<string, TracedShape>;
  cutouts: readonly CutoutPlacement[];
  fingerHoles: readonly FingerHole[];
}

export interface BinMaterialParts {
  /** Main bin with every requested contrasting volume removed. */
  body: Manifold;
  /** Thin printable volumes directly below the exposed pocket floors. */
  pocketFloors: Manifold | null;
  /** Thin printable crest cut from the top of the stacking lip. */
  stackingRim: Manifold | null;
}

export interface BuildBinWithCutoutsOptions {
  /** Enables a non-overlapping printable pocket-floor material volume. */
  floorInsertThicknessMm?: number;
  /** Enables a non-overlapping printable stacking-rim crest volume. */
  rimInsertThicknessMm?: number;
}

/**
 * Builds a bin and subtracts the layout's pocket cutters from the fused
 * solid. When requested for multi-color export, thin floor and rim volumes
 * are clipped from that final solid and removed from the returned body so all
 * printable material objects remain watertight and non-overlapping.
 */
export function buildBinWithCutouts(
  kernel: Kernel,
  spec: BinSpec,
  layout: BinLayout | null,
  quality: BuildQuality,
  options: BuildBinWithCutoutsOptions = {},
): {
  parts: BinParts;
  solid: Manifold;
  materialParts: BinMaterialParts | null;
  cutoutReports: CutoutBuildReport[];
} {
  const { Manifold, arena } = kernel;
  const base = buildBin(kernel, spec, quality);
  let solid = base.solid;
  let floorInserts: Manifold[] = [];
  let reports: CutoutBuildReport[] = [];
  if (layout && (layout.cutouts.length > 0 || layout.fingerHoles.length > 0)) {
    const builtCutouts = buildCutoutCutters(
      kernel,
      layout.shapesById,
      layout.cutouts,
      spec,
      quality,
      { floorInsertThicknessMm: options.floorInsertThicknessMm },
    );
    floorInserts = builtCutouts.floorInserts;
    reports = builtCutouts.reports;
    const allCutters = [
      ...builtCutouts.cutters,
      ...buildFingerHoleCutters(kernel, layout.fingerHoles, spec, quality),
    ];
    if (allCutters.length > 0) {
      const cutter =
        allCutters.length === 1
          ? allCutters[0]
          : arena.track(Manifold.union(allCutters));
      solid = arena.track(base.solid.subtract(cutter));
    }
  }
  const status = solid.status();
  if (status !== "NoError") {
    throw new Error(`buildBinWithCutouts: manifold reported ${status}`);
  }

  let materialParts: BinMaterialParts | null = null;
  let pocketFloors: Manifold | null = null;
  if (floorInserts.length > 0) {
    const requestedFloors =
      floorInserts.length === 1
        ? floorInserts[0]
        : arena.track(Manifold.union(floorInserts));
    const clippedFloors = arena.track(requestedFloors.intersect(solid));
    if (!clippedFloors.isEmpty()) pocketFloors = clippedFloors;
  }

  let stackingRim: Manifold | null = null;
  if (
    base.parts.lip &&
    options.rimInsertThicknessMm !== undefined &&
    Number.isFinite(options.rimInsertThicknessMm) &&
    options.rimInsertThicknessMm > 0
  ) {
    const topZ = binTotalHeightMm(spec.heightUnits, true);
    const requestedRim = arena.track(
      base.parts.lip.trimByPlane(
        [0, 0, 1],
        topZ - options.rimInsertThicknessMm,
      ),
    );
    let clippedRim = arena.track(requestedRim.intersect(solid));
    if (pocketFloors) {
      clippedRim = arena.track(clippedRim.subtract(pocketFloors));
    }
    if (!clippedRim.isEmpty()) stackingRim = clippedRim;
  }

  const accents = [pocketFloors, stackingRim].filter(
    (part): part is Manifold => part !== null,
  );
  if (accents.length > 0) {
    const accent =
      accents.length === 1 ? accents[0] : arena.track(Manifold.union(accents));
    const body = arena.track(solid.subtract(accent));
    if (
      body.status() !== "NoError" ||
      accents.some((part) => part.status() !== "NoError")
    ) {
      throw new Error("buildBinWithCutouts: multi-color material split failed");
    }
    materialParts = { body, pocketFloors, stackingRim };
  }

  return { parts: base.parts, solid, materialParts, cutoutReports: reports };
}

/**
 * Preview section cut: keeps the half-space `axis ≤ offsetMm` so the camera
 * can look into the pockets. `trimByPlane(normal, offset)` keeps the side
 * the normal points toward, so keeping "below" means a negated normal and
 * offset.
 */
export function applySectionCut(
  kernel: Kernel,
  solid: Manifold,
  section: { axis: "x" | "y"; offsetMm: number },
): Manifold {
  const normal: [number, number, number] =
    section.axis === "x" ? [-1, 0, 0] : [0, -1, 0];
  return kernel.arena.track(solid.trimByPlane(normal, -section.offsetMm));
}

/** Builds a bin and fuses it into one watertight solid. */
export function buildBin(
  kernel: Kernel,
  spec: BinSpec,
  quality: BuildQuality,
): { parts: BinParts; solid: Manifold } {
  const { Manifold, arena } = kernel;
  const parts = buildBinParts(kernel, spec, quality);
  const present = [parts.base, parts.wall, parts.lip, parts.infill].filter(
    (part): part is Manifold => part !== null,
  );
  const solid = arena.track(Manifold.union(present));

  const status = solid.status();
  if (status !== "NoError") {
    // A silent bad solid would surface as a corrupt print hours later; fail
    // loudly at build time instead.
    throw new Error(`buildBin: manifold reported ${status}`);
  }
  return { parts, solid };
}
