import { z } from "zod";
import { POCKET_DEPTH_EPSILON_MM, resolvePlacedPocketDepth, type CutoutPlacement, type TracedShape } from "./cutout";
import { hasPocketTilt } from "./pocket-orientation";
import type { BinSpec } from "./types";

export const shadowInlayGapSchema = z.number().finite().min(0).max(1);
export const DEFAULT_SHADOW_INLAY_GAP_MM = 0.2;

/** A loose insert needs a single, horizontal seat above the bin underside. */
export function shadowInlayUnavailableReason(
  spec: BinSpec,
  shape: TracedShape,
  cutout: CutoutPlacement,
  thicknessMm: number,
): string | null {
  if (cutout.role === "hole") return "Select a tool pocket rather than a kept hole.";
  if (cutout.depthPending) return "Set the pocket depth before exporting a shadow inlay.";
  if (cutout.profileBottom || hasPocketTilt(cutout) || cutout.split) {
    return "Shadow inlays require an untilted pocket with a single floor.";
  }
  const pocket = resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout);
  if (cutout.depth.mode === "through" || pocket.floorZ === null || pocket.floorZ <= 0) {
    return "This pocket has no supporting floor for a shadow inlay.";
  }
  if (cutout.elevationMm !== undefined && !cutout.insertionMode &&
      pocket.axialDepthMm !== null &&
      cutout.elevationMm + pocket.axialDepthMm < pocket.infillTopZ - POCKET_DEPTH_EPSILON_MM) {
    return "This pocket has no opening at the fill surface for a shadow inlay.";
  }
  if (spec.fill !== "solid" || (pocket.depthMm ?? 0) < thicknessMm) {
    return "The shadow inlay must fit below the fill surface of a solid bin.";
  }
  return null;
}
