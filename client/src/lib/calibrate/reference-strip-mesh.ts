import type { Kernel } from "@/lib/manifold/runtime";
import { extractMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf, type ThreeMfObject } from "@/lib/mesh/threemf";
import { REFERENCE_STRIP, referenceStripBlackCells } from "./reference-strip";

/**
 * White carrier with flush black inlays in the last two 0.2 mm layers. The
 * paper coordinates are flipped in Y exactly once so the top view decodes
 * the same marker orientation. Parts fill the carrier without overlapping.
 */
export function referenceStripMeshes(kernel: Kernel): ThreeMfObject[] {
  const { arena, Manifold } = kernel;
  const { lengthMm, widthMm, thicknessMm, inkDepthMm } = REFERENCE_STRIP;
  const cells = referenceStripBlackCells().map(({ x, y, size }) => {
    const cube = arena.track(Manifold.cube([size, size, inkDepthMm]));
    return arena.track(cube.translate([x, widthMm - y - size, thicknessMm - inkDepthMm]));
  });
  const black = arena.track(Manifold.union(cells));
  const blank = arena.track(Manifold.cube([lengthMm, widthMm, thicknessMm]));
  const white = arena.track(blank.subtract(black));
  return [
    { name: "White carrier", mesh: extractMeshData(kernel, white), material: { name: "Opaque white", displayColor: "#FFFFFF" } },
    { name: "Black markers", mesh: extractMeshData(kernel, black), material: { name: "Opaque black", displayColor: "#000000" } },
  ];
}

/** Multi-part assembly keeps the inlays seated when imported into a slicer. */
export function referenceStripThreeMf(kernel: Kernel): Uint8Array {
  return writeThreeMf(referenceStripMeshes(kernel), { assemble: true, title: "Pocketry object reference strip v1 - 100 x 20 x 1.2 mm" });
}
