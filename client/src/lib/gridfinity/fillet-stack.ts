// Type-only import: the kernel is injected (see `Kernel` in ../manifold/runtime).
import type { CrossSection, Manifold } from "manifold-3d";

import type { Kernel } from "@/lib/manifold/runtime";

/**
 * Stepped bottom fillet for pocket cutters — the plan's answer to its top
 * risk: an *exact* bottom fillet on a traced outline is O(N) manifolds for N
 * ring vertices, catastrophic at N ≈ 1000, while a K-slice offset stack costs
 * K Clipper2 offsets regardless of N. The mesh profile uses its own 0.1 mm
 * maximum vertical step plus a quality-dependent angular minimum; it is not
 * tied to the eventual slicer's layer height.
 *
 * G1 carries this as a prototype with a benchmark against a synthetic
 * 200-vertex ring (see fillet-stack.test.ts); the G3 cutout builder will call
 * it with real traced outlines.
 */

export interface FilletOptions {
  /** Fillet radius where the pocket wall meets the floor. */
  radiusMm: number;
  /** Maximum vertical distance between sampled profile bands. */
  profileStepMm: number;
  /** Segments per full circle for the offset's round joins. */
  circularSegments: number;
}

/** Mesh resolution for vertical fillet profiles; independent of print layers. */
export const FILLET_PROFILE_STEP_MM = 0.1;

/** Same post-offset cleanup epsilon the outline offsetter uses. */
const CLEANUP_EPSILON = 1e-6;

/** Avoid an exact step multiple such as 2.8 / 0.2 becoming 14.000000000000002. */
function filletSliceCount(
  radiusMm: number,
  profileStepMm: number,
  circularSegments: number,
): number {
  return Math.max(
    1,
    // Equal-angle bands have their largest vertical span near a tangent;
    // πr/2n bounds that span by profileStepMm.
    Math.ceil((Math.PI * radiusMm) / (2 * profileStepMm) - 1e-9),
    Math.ceil(circularSegments / 4),
  );
}

/** Slider arithmetic must not change topology at an otherwise identical value. */
function stableRadiusMm(radiusMm: number): number {
  return Number(radiusMm.toFixed(9));
}

/**
 * Builds a pocket cutter for `section`, `depthMm` tall with its **floor at
 * z = 0**, whose bottom `radiusMm` is a stepped fillet: each step's
 * cross-section is the section inset by the circle sag at the step's *bottom*,
 * so the stepped surface stays on the material side of the smooth fillet
 * (steps leave material, never eat past the true fillet). Consecutive pieces
 * overlap internally; merely abutting different offset polygons at one face
 * is not a reliable Manifold union and caused radius-dependent missing bands.
 *
 * Narrow features collapse under the inward offset and simply drop out of the
 * lowest slices — the same intended behaviour as the outline offsetter.
 */
export function bottomFilletCutter(
  kernel: Kernel,
  section: CrossSection,
  depthMm: number,
  options: FilletOptions,
): Manifold {
  const { Manifold, arena } = kernel;
  const { profileStepMm, circularSegments } = options;
  const radiusMm = stableRadiusMm(options.radiusMm);

  if (!(depthMm > 0)) throw new Error(`bottomFilletCutter: depth must be > 0, got ${depthMm}`);
  if (radiusMm < 0) throw new Error(`bottomFilletCutter: negative radius ${radiusMm}`);
  if (radiusMm > depthMm) {
    throw new Error(
      `bottomFilletCutter: radius ${radiusMm} exceeds depth ${depthMm} — clamp it to depth`,
    );
  }
  if (!(profileStepMm > 0)) {
    throw new Error(
      `bottomFilletCutter: profile step must be > 0, got ${profileStepMm}`,
    );
  }

  if (radiusMm === 0) {
    return arena.track(section.extrude(depthMm));
  }

  const pieces: Manifold[] = [];
  if (depthMm > radiusMm) {
    pieces.push(
      arena.track(
        arena.track(section.extrude(depthMm - radiusMm)).translate([0, 0, radiusMm]),
      ),
    );
  }

  const sliceCount = filletSliceCount(
    radiusMm,
    profileStepMm,
    circularSegments,
  );
  for (let slice = 0; slice < sliceCount; slice++) {
    const startAngle = ((Math.PI / 2) * slice) / sliceCount;
    const endAngle = ((Math.PI / 2) * (slice + 1)) / sliceCount;
    const bottom = radiusMm * (1 - Math.cos(startAngle));
    const top = radiusMm * (1 - Math.cos(endAngle));
    const sliceHeight = top - bottom;
    const overlap = sliceHeight / 2;
    // Circle sag: how far the fillet surface sits inside the nominal wall at
    // this height above the floor.
    const inset = radiusMm * (1 - Math.sin(startAngle));
    const shrunk =
      inset === 0
        ? section
        : arena.track(
            arena
              .track(section.offset(-inset, "Round", 2, circularSegments))
              .simplify(CLEANUP_EPSILON),
          );
    if (shrunk.isEmpty()) continue;
    pieces.push(
      arena.track(
        arena.track(shrunk.extrude(sliceHeight + overlap)).translate([0, 0, bottom]),
      ),
    );
  }

  if (pieces.length === 0) {
    throw new Error(
      "bottomFilletCutter: section collapsed under the fillet inset — nothing to cut",
    );
  }
  return arena.track(Manifold.union(pieces));
}

/**
 * Builds the outward flare that rounds a pocket wall into its top surface.
 * The returned cutter spans z=0..radiusMm; callers place its top at the
 * pocket's surface and union it with the ordinary pocket cutter.
 *
 * Each printed layer samples the circle at its top, so the surface reaches
 * the full requested radius while the approximation can over-cut by no more
 * than one layer height.
 */
export function topEdgeFilletCutter(
  kernel: Kernel,
  section: CrossSection,
  options: FilletOptions,
): Manifold {
  const { Manifold, arena } = kernel;
  const { profileStepMm, circularSegments } = options;
  const radiusMm = stableRadiusMm(options.radiusMm);
  if (!(radiusMm > 0)) {
    throw new Error(`topEdgeFilletCutter: radius must be > 0, got ${radiusMm}`);
  }
  if (!(profileStepMm > 0)) {
    throw new Error(
      `topEdgeFilletCutter: profile step must be > 0, got ${profileStepMm}`,
    );
  }

  const pieces: Manifold[] = [];
  const sliceCount = filletSliceCount(
    radiusMm,
    profileStepMm,
    circularSegments,
  );
  for (let slice = 0; slice < sliceCount; slice++) {
    const startAngle = ((Math.PI / 2) * slice) / sliceCount;
    const endAngle = ((Math.PI / 2) * (slice + 1)) / sliceCount;
    const bottom = radiusMm * Math.sin(startAngle);
    const top = radiusMm * Math.sin(endAngle);
    const sliceHeight = top - bottom;
    const overlap = sliceHeight / 2;
    const outset = radiusMm * (1 - Math.cos(endAngle));
    const expanded = arena.track(
      arena
        .track(section.offset(outset, "Round", 2, circularSegments))
        .simplify(CLEANUP_EPSILON),
    );
    if (expanded.isEmpty()) continue;
    pieces.push(
      arena.track(
        arena
          .track(expanded.extrude(sliceHeight + overlap))
          .translate([0, 0, bottom]),
      ),
    );
  }

  if (pieces.length === 0) {
    throw new Error("topEdgeFilletCutter: expanded section is empty");
  }
  return arena.track(Manifold.union(pieces));
}
