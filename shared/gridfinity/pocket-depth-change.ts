import { resolvePlacedPocketDepth, resolvePocketDepth, type CutoutPlacement, type DepthSpec, type TracedShape } from "./cutout";
import { hasPocketTilt } from "./pocket-orientation";
import { hasRigidPocket, rigidPocket } from "./rigid-pocket";
import { resolvePocketSplit } from "./pocket-split";
import type { BinSpec } from "./types";

/** Selecting Through on an ordinary upright pocket opens the entire bin bottom. A later
 * rigid Z edit freezes that opening as a finite source, so raising it restores
 * material. Rigidly positioned and tilted objects retain their authored source and existing pose. */
export function pocketDepthChangePatch(spec: BinSpec, shape: TracedShape, cutout: CutoutPlacement,
  requested: DepthSpec, section: 0 | 1 = 0,
): Partial<CutoutPlacement> {
  const surfaceThrough = requested.mode === "through" && !hasRigidPocket(cutout)
    && !hasPocketTilt(cutout) && !(cutout.zOffsetMm ?? 0) && !cutout.profileBottom;
  const source = surfaceThrough ? { ...cutout, elevationMm: undefined, zOffsetMm: undefined, insertionMode: undefined }
    : requested.mode === "through" ? rigidPocket(cutout, shape, spec) : cutout;
  let depth = requested;
  if (hasRigidPocket(source) && (depth.mode === "through" || depth.mode === "remaining")) {
    const previous = cutout.split?.depths[section] ?? cutout.depth;
    const regions = cutout.split ? resolvePocketSplit(shape.outlineMm, cutout.split.boundary).regions : null;
    const originalDepth = resolvePlacedPocketDepth(spec, previous,
      { outlineMm: regions?.[section] ?? shape.outlineMm }, cutout).axialDepthMm;
    depth = { ...depth, sourceDepthMm: Math.max(0.1, originalDepth ?? resolvePocketDepth(spec, depth).infillTopZ) };
  }
  const depths = source.split ? [...source.split.depths] as [DepthSpec, DepthSpec] : null;
  if (depths) depths[section] = depth;
  return { elevationMm: source.elevationMm, zOffsetMm: source.zOffsetMm, insertionMode: source.insertionMode,
    ...(source.split && depths ? { split: { ...source.split, depths } } : { depth }) };
}
