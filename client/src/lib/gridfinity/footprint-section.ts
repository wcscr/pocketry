import type { CrossSection } from "manifold-3d";

import {
  footprintInteriorRingMm,
  footprintOuterRingMm,
  type FootprintSpec,
} from "@shared/gridfinity/footprint";

import type { Kernel } from "@/lib/manifold/runtime";

function sectionFromRing(kernel: Kernel, ring: ReturnType<typeof footprintOuterRingMm>): CrossSection {
  return kernel.arena.track(
    new kernel.CrossSection([
      ring.map(({ x, y }) => [x, y] as [number, number]),
    ]),
  );
}

export function footprintOuterSection(
  kernel: Kernel,
  spec: FootprintSpec,
  circularSegments: number,
): CrossSection {
  return sectionFromRing(kernel, footprintOuterRingMm(spec, circularSegments));
}

export function footprintInteriorSection(
  kernel: Kernel,
  spec: FootprintSpec,
  circularSegments: number,
): CrossSection {
  return sectionFromRing(kernel, footprintInteriorRingMm(spec, circularSegments));
}
