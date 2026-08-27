import type { TracedShape } from "@shared/gridfinity/cutout";
import type { Outline } from "@shared/geometry/types";

import { toModelSpace, type ExportScale } from "@/lib/export/scale";
import {
  normalizeOutline,
  outlineBounds,
  outlinePointCount,
  translateOutline,
} from "@/lib/geometry/outline";

/**
 * The trace → bin seam: turns a traced outline (image pixels, y-down) into a
 * {@link TracedShape} (millimetres, y-up, bbox-centred at the origin).
 *
 * The px→mm conversion and the Y-flip happen in `toModelSpace` — the app's
 * single scale boundary — and nowhere else; this function only recentres and
 * records metadata. Returns null without a calibration: an uncalibrated
 * outline has no physical size and must not enter the shape library (the
 * design doc's `uncalibrated-scale` footgun).
 */
export function normalizeTracedShape(
  outlinePx: Outline,
  scale: ExportScale,
  name: string,
): TracedShape | null {
  if (scale.mmPerPx === null || outlinePx.length === 0) return null;

  const modelMm = normalizeOutline(toModelSpace(outlinePx, scale));
  const bounds = outlineBounds(modelMm);
  if (!bounds) return null;

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const centred = translateOutline(modelMm, -centreX, -centreY);

  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `shape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    outlineMm: centred,
    bboxMm: {
      minX: bounds.minX - centreX,
      minY: bounds.minY - centreY,
      maxX: bounds.maxX - centreX,
      maxY: bounds.maxY - centreY,
    },
    pointCount: outlinePointCount(centred),
    sourceMmPerPx: scale.mmPerPx,
  };
}
