import type { Manifold } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";
import type { ExtrusionBand } from "./fillet-stack";
import { sweepCrossSection } from "./planar-insertion-sweep";

/** Expand native extrusion bands for a colored lining. Working on their 2D
 * sections avoids a costly whole-mesh Minkowski sum. The lateral and axial
 * thickness is measured in the object's frame, with rounded lateral corners.
 * This mask only partitions existing material: it is never a cavity cutter. */
export function outsetColorBands(kernel: Kernel, bands: readonly ExtrusionBand[],
  thickness: number, circularSegments: number,
): ExtrusionBand[] {
  return bands.map(band => ({
    section: kernel.arena.track(band.section.offset(thickness, "Round", 2, circularSegments)),
    bottom: band.bottom - thickness,
    height: band.height + 2 * thickness,
  }));
}

export function extrudeColorBands(kernel: Kernel, bands: readonly ExtrusionBand[]): Manifold {
  return kernel.arena.track(kernel.Manifold.union(bands.map(band => kernel.arena.track(
    kernel.arena.track(band.section.extrude(band.height)).translate([0, 0, band.bottom]),
  ))));
}

/** Continuous color reach along one object axis. Sweep the native sections
 * before posing/clearing the pocket, so no Float32 face reconstruction enters
 * the material CSG. Extending every band also handles features thinner than
 * the color depth, where a translated copy would leave an uncolored gap. */
export function sweepColorBands(kernel: Kernel, bands: readonly ExtrusionBand[],
  axis: "x" | "y" | "z", distance: number,
): ExtrusionBand[] {
  return bands.map(band => axis === "z" ? {
    ...band,
    // Keep the floor material off walls parallel to this axis. A 0.01 mm
    // setback avoids coincident wall sheets after the insertion sweep is
    // rounded to Float32, without changing the cavity or axial color depth.
    section: kernel.arena.track(band.section.offset(-0.01, "Miter")),
    bottom: band.bottom + Math.min(0, distance), height: band.height + Math.abs(distance),
  } : {
    ...band, section: sweepCrossSection(kernel, band.section, axis === "x" ? [distance, 0] : [0, distance]),
  });
}
