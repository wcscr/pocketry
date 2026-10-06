import type { Manifold } from "manifold-3d";
import type { BinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT, binHeightMm } from "@shared/gridfinity/standard";
import { pegBottomExtensionMm, pegBottomRootHeightMm, pegBridgeSpanMm, ultim8PegCenters, selectUltim8PegCenters, ULTIM8_COLLAR_HEIGHT_MM } from "@shared/gridfinity/peg-bottom";
import type { Kernel } from "@/lib/manifold/runtime";
import { footprintOuterSection } from "./footprint-section";

/** Upright printing: chamfered tips, straight shafts, then 45 degree roots.
 * Sloped mode fully covers the slab; bridged mode joins flared collars with
 * small bridges and a chamfered perimeter. Both are clipped to the footprint. Flat backing skips the roots and
 * exports inverted, with sparse pegs printed upward from the slab.
 */
export function buildPegBottom(
  kernel: Kernel, spec: BinSpec, segments: number,
  throughCutters: readonly Manifold[] = [],
): Manifold {
  if (!spec.pegBottom) throw new Error("Peg bottom settings are required.");
  const { Manifold, CrossSection, arena } = kernel;
  const { diameterMm, lengthMm, underside } = spec.pegBottom;
  if (underside === "bridged" && spec.footprint.kind !== "rectangle") {
    throw new Error("Short bridges require a rectangular footprint. Choose the sloped underside for a custom footprint.");
  }
  const rootHeight = pegBottomRootHeightMm(spec);
  const coneHeight = underside === "bridged" ? ULTIM8_COLLAR_HEIGHT_MM : rootHeight;
  const radius = diameterMm / 2;
  const latticeCenters = ultim8PegCenters(spec);
  if (!latticeCenters.length) throw new Error("This footprint has no room for ULTIM8 pegs. Enlarge the footprint or choose another bottom.");
  const outer = footprintOuterSection(kernel, spec, segments);
  const bottomZ = -pegBottomExtensionMm(spec);
  const through = throughCutters.length ? arena.track(Manifold.union(throughCutters)) : null;
  // Limit the projected outline to the underside. Tilted tools can sweep
  // sideways below the floor; top flares and blind split seats must not
  // accidentally remove pegs elsewhere.
  const belowSlab = through ? arena.track(arena.track(
    through.trimByPlane([0, 0, -1], 0),
  ).trimByPlane([0, 0, 1], bottomZ)) : null;
  const exclusion = belowSlab ? arena.track(belowSlab.project()) : null;
  const available = exclusion && !exclusion.isEmpty() ? latticeCenters.filter(({ x, y }) => {
    const shaft = arena.track(arena.track(CrossSection.circle(radius, segments)).translate([x, y]));
    return arena.track(shaft.intersect(exclusion)).area() <= 1e-8;
  }) : latticeCenters;
  const centers = selectUltim8PegCenters(spec, available);
  if (!centers.length) {
    throw new Error("Through pockets overlap every ULTIM8 peg. Move or resize the pockets, enlarge the footprint, or choose a flat bottom.");
  }
  const slabOpening = through ? arena.track(through.slice(0)) : null;
  const requiredTop = slabOpening ? arena.track(outer.subtract(slabOpening)) : outer;
  const topDiscs = centers.map(({ x, y }) => arena.track(
    arena.track(CrossSection.circle(radius + coneHeight, segments)).translate([x, y]),
  ));
  const supportedTop = arena.track(CrossSection.union(topDiscs));
  if (underside === "sloped" && arena.track(requiredTop.subtract(supportedTop)).area() > 1e-6) {
    throw new Error(centers.length < latticeCenters.length
      ? "Removing pegs beneath through pockets leaves an unsupported underside. Move or resize the pockets, enlarge the footprint, or choose another bottom."
      : "This footprint extends beyond the support-free peg roots. Use a wider footprint or another bottom.");
  }
  const chamfer = 0.4;
  const pegs = centers.map(({ x, y }) => {
    const tip = arena.track(arena.track(Manifold.cylinder(chamfer, radius - chamfer, radius, segments)).translate([x, y, bottomZ]));
    const shaft = arena.track(arena.track(Manifold.cylinder(lengthMm - chamfer, radius, radius, segments)).translate([x, y, bottomZ + chamfer]));
    if (underside === "flat") return arena.track(Manifold.union([tip, shaft]));
    const root = arena.track(arena.track(Manifold.cylinder(coneHeight, radius, radius + coneHeight, segments)).translate([x, y, -rootHeight]));
    return arena.track(Manifold.union([tip, shaft, root]));
  });
  if (underside === "bridged") {
    const pad = arena.track(CrossSection.hull(topDiscs));
    // Collars overlap throughout the regular lattice. Bound the spacing
    // between edge anchors instead of treating connected scallops as one span.
    if (pegBridgeSpanMm(latticeCenters) > 12) {
      throw new Error("This footprint needs long bridges. Choose the sloped underside instead.");
    }
    const rampHeight = rootHeight - coneHeight;
    const rampReach = arena.track(pad.offset(rampHeight, "Round", 2, segments));
    if (arena.track(requiredTop.subtract(rampReach)).area() > 1e-6) {
      throw new Error("Removing pegs beneath through pockets leaves an unsupported perimeter. Move or resize the pockets, or choose the sloped underside.");
    }
    const bridgeZ = -rampHeight;
    const padOpening = through ? arena.track(through.slice(bridgeZ)) : null;
    const requiredPad = padOpening ? arena.track(pad.subtract(padOpening)) : pad;
    // A missing interior anchor may turn a small lattice gap into a wide
    // bridge. Reject retained pad regions more than half the 12 mm span from
    // a collar; openings themselves are excluded from this support check.
    const bridgeReach = arena.track(supportedTop.offset(6, "Round", 2, segments));
    if (arena.track(requiredPad.subtract(bridgeReach)).area() > 1e-6) {
      throw new Error("Removing pegs beneath through pockets needs long bridges. Move or resize the pockets, or choose the sloped underside.");
    }
    const lowerCap = arena.track(arena.track(pad.extrude(0.01)).translate([0, 0, -rampHeight]));
    const upperCap = arena.track(outer.extrude(0.01));
    pegs.push(arena.track(Manifold.hull([lowerCap, upperCap])));
  }
  const roots = arena.track(Manifold.union(pegs));
  const clip = arena.track(arena.track(outer.extrude(pegBottomExtensionMm(spec) + 0.01)).translate([0, 0, bottomZ]));
  const clipped = arena.track(roots.intersect(clip));
  const slab = arena.track(outer.extrude(Math.min(BASE_HEIGHT, binHeightMm(spec.heightUnits))));
  return arena.track(clipped.add(slab));
}
