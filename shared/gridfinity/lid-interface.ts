import type { BinSpec } from "./types";
import { BASE_TOP_RADIUS, binFootprintMm, STACKING_LIP_DEPTH, STACKING_LIP_LINE } from "./standard";
import { hasOverlappingLid, overlapLidRimInsetMm, overlapRimCornerRadiusMm, LID_FRICTION_INTERFERENCE_MM } from "./magnetic-lid";

export const SPRING_THICKNESS_MM = 0.8;
export const FIN_THICKNESS_MM = 0.6;
/** Release gap between moving parts and cap; inspect this gap in the slicer. */
export const INTERFACE_CAP_GAP_MM = 0.3;
export const INTERFACE_WINDOW_WIDTH_MM = 20;
export const INTERFACE_BACK_MM = 2.8;
export const LATCH_BACK_MM = 10.1;
export const LATCH_WINDOW_WIDTH_MM = 12;
export const LATCH_SPRING_HALF_HEIGHT_MM = 0.65;
export const LATCH_COVER_THICKNESS_MM = 0.6;
export const DETENT_RECESS_DEPTH_MM = 0.4;
/** The detent presses against the recess floor, keeping the spring preloaded. */
export const DETENT_ENGAGEMENT_MM = DETENT_RECESS_DEPTH_MM + LID_FRICTION_INTERFERENCE_MM;

export interface LidInterfaceFrame {
  /** Local x runs along the wall; positive local y retracts from the bin. */
  angle: number;
  along: number;
  face: number;
  direction: 1 | -1;
  bottom: number;
  contactZ: number;
  /** Fins use one uninterrupted window over the entire straight side. */
  width: number;
}

/** Matching lid and body features share these frames, including their vertical datum. */
export function lidInterfaceFrames(spec: BinSpec): LidInterfaceFrame[] {
  const overlap = hasOverlappingLid(spec);
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const latch = spec.lidInterface === "spring-latch";
  const frames: LidInterfaceFrame[] = [];
  for (const angle of [0, 90, 180, 270]) {
    const alongSize = angle % 180 === 0 ? width : length;
    const normalSize = angle % 180 === 0 ? length : width;
    const cornerEnd = overlap ? overlapLidRimInsetMm(spec) + overlapRimCornerRadiusMm(spec) : BASE_TOP_RADIUS;
    const usable = alongSize - 2 * (cornerEnd + 2);
    const fins = spec.lidInterface === "angled-fins";
    const count = fins ? 1 : Math.min(8, Math.max(1, Math.floor(usable / 28)));
    const step = usable / count;
    for (let i = 0; i < count; i++) frames.push({
      angle, along: (i - (count - 1) / 2) * step,
      face: normalSize / 2 - (overlap ? overlapLidRimInsetMm(spec) : STACKING_LIP_DEPTH - STACKING_LIP_LINE[1][0]),
      direction: overlap ? 1 : -1,
      bottom: overlap ? -4.8 : latch ? 1.55 - LATCH_SPRING_HALF_HEIGHT_MM : 0.85,
      contactZ: overlap ? -3.2 : 1.55,
      width: fins ? usable : spec.lidInterface === "spring-latch" ? LATCH_WINDOW_WIDTH_MM : INTERFACE_WINDOW_WIDTH_MM,
    });
  }
  return frames;
}
