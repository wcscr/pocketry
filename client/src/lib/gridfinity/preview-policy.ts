import type { BinSpec } from "@shared/gridfinity/types";
import type { BuildQuality } from "./bin";
import type { BinGeometryLayout } from "./use-bin-geometry";

/** A conservative first-build estimate; measured detailed cost takes over later. */
export function needsProgressivePreview(
  spec: BinSpec,
  layout: BinGeometryLayout | undefined,
  quality: BuildQuality,
  measuredMs?: number,
): boolean {
  if (!layout?.cutouts.some(c => c.topFilletMm > 0 || c.bottomFilletMm > 0)) return false;
  if (measuredMs !== undefined) return measuredMs > 150;
  const shapes = new Map(layout.shapes.map(shape => [shape.id, shape]));
  const bands = (radius: number) => radius > 0
    ? Math.max(Math.ceil(quality.circularSegments / 4), Math.ceil(Math.PI * radius / (2 * (quality.filletProfileStepMm ?? 0.5))))
    : 0;
  const work = layout.cutouts.reduce((sum, cutout) => sum +
    Math.min(shapes.get(cutout.shapeId)?.pointCount ?? Infinity, quality.cutoutVertexBudget ?? 100) *
    (1 + bands(cutout.topFilletMm) + bands(cutout.bottomFilletMm)) * (cutout.split ? 2 : 1), 0);
  return layout.cutouts.length > 2 || spec.gridX * spec.gridY > 16 || work > 800;
}
