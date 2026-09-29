import { defaultPocketFloorThicknessMm, resolvePocketDepth, type CutoutPlacement } from "./cutout";
import type { BinSpec } from "./types";
import { modelDimensions, type ImportedModel } from "./model-pocket";

/** Start with three quarters of the authored height below the fill surface. */
export function modelPlacementDefaults(model: ImportedModel, spec: BinSpec, scale = 1): Partial<CutoutPlacement> {
  const height = modelDimensions(model)[2] * scale;
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  return { elevationMm: Math.max(defaultPocketFloorThicknessMm(spec), top - height * 0.75),
    scaleX: scale, scaleY: scale, modelScaleZ: scale, depth: { mode: "mm", value: height },
    clearanceMm: 0.3, modelSmoothingMm: 1, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 };
}
