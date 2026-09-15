import type { BinSpec } from "./types";
import { BASE_TOP_RADIUS, binFootprintMm, STACKING_LIP_DEPTH, STACKING_LIP_LINE } from "./standard";
import { hasOverlappingLid, overlapLidRimInsetMm } from "./magnetic-lid";

export const SPRING_THICKNESS_MM = 0.8;
export const FIN_THICKNESS_MM = 0.6;
/** Release gap between the fingers and cap; inspect this gap in the slicer. */
export const FIN_CAP_GAP_MM = 0.3;
export const INTERFACE_WINDOW_WIDTH_MM = 20;
export const INTERFACE_BACK_MM = 2.8;
export const DETENT_ENGAGEMENT_MM = 0.2;
export const DETENT_RECESS_DEPTH_MM = 0.4;

export interface LidInterfaceFrame {
  /** Local x runs along the wall; positive local y retracts from the bin. */
  angle: number;
  along: number;
  face: number;
  direction: 1 | -1;
  bottom: number;
  contactZ: number;
}

/** Matching lid and body features share these frames, including their vertical datum. */
export function lidInterfaceFrames(spec: BinSpec): LidInterfaceFrame[] {
  const overlap = hasOverlappingLid(spec);
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const frames: LidInterfaceFrame[] = [];
  for (const angle of [0, 90, 180, 270]) {
    const alongSize = angle % 180 === 0 ? width : length;
    const normalSize = angle % 180 === 0 ? length : width;
    const usable = alongSize - 2 * (BASE_TOP_RADIUS + 2);
    const count = Math.min(8, Math.max(1, Math.floor(usable / 28)));
    const step = usable / count;
    for (let i = 0; i < count; i++) frames.push({
      angle, along: (i - (count - 1) / 2) * step,
      face: normalSize / 2 - (overlap ? overlapLidRimInsetMm(spec) : STACKING_LIP_DEPTH - STACKING_LIP_LINE[1][0]),
      direction: overlap ? 1 : -1,
      bottom: overlap ? -4.8 : 0.85,
      contactZ: overlap ? -3.2 : 1.55,
    });
  }
  return frames;
}
