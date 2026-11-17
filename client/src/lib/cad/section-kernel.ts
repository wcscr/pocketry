import type { CrossSection } from "manifold-3d";

import { fitArcChain, flattenChain, type ArcChain } from "@shared/geometry/arc-chain";
import { roundingInset } from "@shared/geometry/inset-rounding";
import type { Outline, Ring } from "@shared/geometry/types";

import { polygonsToOutline, toCrossSection } from "@/lib/geometry/offset";
import { Arena } from "@/lib/manifold/arena";
// Type-only: the runtime is handed in by the caller, never imported here.
import type { Kernel, ManifoldToplevel } from "@/lib/manifold/runtime";

import type { SectionRegion } from "./section-chain";

/**
 * Pocket sections for the CAD export, computed with the same planar offsets
 * the print path uses.
 *
 * The solid modeler builds every solid, but it is not asked to offset traced
 * outlines: its planar offset fails on many of them, and a section that
 * differs from the print path's would defeat the point of the export. Manifold
 * (Clipper2) therefore produces the section as a polygon, which is then fitted
 * with lines and arcs for the modeler. This is the one place the CAD export
 * uses two kernels in a construction; see the kernel note in CLAUDE.md.
 */

/**
 * Samples per full circle for round joins. At half a degree per step a join
 * is distinguishable from a real corner, and the fit recovers its circle.
 */
export const SECTION_ARC_SEGMENTS = 720;

/** Largest distance between a fitted CAD section and the print path's section. */
export const SECTION_FIT_TOLERANCE_MM = 0.02;

/** Same post-offset cleanup the print path applies. */
const CLEANUP_EPSILON = 1e-6;

/** A pocket section ready for the modeler, with how closely it follows the print path. */
export interface FittedSection {
  regions: SectionRegion[];
  /**
   * Largest distance from the print path's section to the fitted boundary.
   * The fitted boundary never lies inside the print path's.
   */
  maxDeviationMm: number;
  /** Shortest boundary element, a measure of how well-conditioned the section is. */
  shortestElementMm: number;
  /** Lines and arcs in the fitted boundary. */
  elements: number;
}

export interface SectionKernel {
  /**
   * The pocket section for `outline`: clearance, then corner rounding as an
   * opening, exactly as the print path offsets it, fitted with lines and
   * arcs. Returns `null` when the section is empty (the pocket collapsed).
   */
  pocketSection(outline: Outline, clearanceMm: number, cornerRoundMm: number): FittedSection | null;
  /**
   * Volume the rounding rule removes from a pocket of this section, integrated
   * from planar insets. An independent figure to hold a rounded solid against.
   */
  roundingVolume(regions: readonly SectionRegion[], radius: number): number;
}

/** Chord error when a fitted boundary is handed back to the planar kernel. */
const FLATTEN_TOLERANCE_MM = 1e-4;

const flatten = (chain: ArcChain): Ring => flattenChain(chain, FLATTEN_TOLERANCE_MM);

function regionsToOutline(regions: readonly SectionRegion[]): Outline {
  return regions.map((region) => ({
    outer: flatten(region.outer),
    holes: region.holes.map(flatten),
  }));
}

/** Builds the section kernel over a loaded Manifold runtime. */
export function createSectionKernel(wasm: ManifoldToplevel): SectionKernel {
  /** Runs `work` with a planar kernel whose handles are released afterward. */
  const withPlanar = <T>(work: (kernel: Kernel) => T): T => {
    const arena = new Arena();
    try {
      return work({
        CrossSection: wasm.CrossSection,
        Manifold: wasm.Manifold,
        triangulate: wasm.triangulate,
        arena,
      });
    } finally {
      arena.dispose();
    }
  };

  const roundOffset = (kernel: Kernel, section: CrossSection, delta: number): CrossSection =>
    kernel.arena.track(
      kernel.arena
        .track(section.offset(delta, "Round", 2, SECTION_ARC_SEGMENTS))
        .simplify(CLEANUP_EPSILON),
    );

  /**
   * Fits `section` so the result never lies inside it: the section is first
   * grown by half the tolerance with mitered joins (which keep corners sharp
   * and arcs concentric), then fitted within the other half.
   */
  const fitOutside = (kernel: Kernel, section: CrossSection): FittedSection | null => {
    if (section.isEmpty()) return null;
    const half = SECTION_FIT_TOLERANCE_MM / 2;
    const grown = kernel.arena.track(section.offset(half, "Miter", 2, SECTION_ARC_SEGMENTS));
    const outline = polygonsToOutline(grown.toPolygons());
    if (!outline.length) return null;
    let worst = 0;
    let shortest = Infinity;
    let elements = 0;
    const fitRing = (ring: Ring): ArcChain => {
      const fitted = fitArcChain(ring, { toleranceMm: half });
      worst = Math.max(worst, fitted.maxDeviationMm);
      shortest = Math.min(shortest, fitted.shortestElementMm);
      elements += fitted.chain.length;
      return fitted.chain;
    };
    const regions = outline.map((shape) => ({
      outer: fitRing(shape.outer),
      holes: shape.holes.map(fitRing),
    }));
    return { regions, maxDeviationMm: half + worst, shortestElementMm: shortest, elements };
  };

  return {
    pocketSection(outline, clearanceMm, cornerRoundMm) {
      return withPlanar((kernel) => {
        let section = toCrossSection(kernel, outline);
        if (clearanceMm !== 0) section = roundOffset(kernel, section, clearanceMm);
        if (cornerRoundMm > 0) {
          section = roundOffset(kernel, roundOffset(kernel, section, -cornerRoundMm), cornerRoundMm);
        }
        return fitOutside(kernel, section);
      });
    },

    roundingVolume(regions, radius) {
      return withPlanar((kernel) => {
        const section = toCrossSection(kernel, regionsToOutline(regions));
        const area = section.area();
        const slices = 96;
        let removed = 0;
        for (let slice = 0; slice < slices; slice++) {
          const height = (radius * (slice + 0.5)) / slices;
          const inset = kernel.arena.track(
            section.offset(-roundingInset(radius, height), "Round", 2, 256),
          );
          removed += ((area - inset.area()) * radius) / slices;
        }
        return removed;
      });
    },
  };
}
