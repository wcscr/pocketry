import { POCKET_DEPTH_EPSILON_MM, type CutoutPlacement, type DepthSpec } from "./cutout";
import { designLinkErrors } from "./design-links";
import { infillTopZ, type FillHeightSpec } from "./fill";
import { pocketAxis } from "./pocket-orientation";

export type FillHeightEdit = { cutouts: CutoutPlacement[]; error?: never }
  | { cutouts?: never; error: string };

/** Resize existing fixed depths when the fill surface moves, retaining their
 * seats in bin coordinates. Apply to the committed document on every drag frame
 * so preview reversals and pointer-up never compound the adjustment. */
export function adjustPocketsForFillHeight(
  cutouts: CutoutPlacement[], previous: FillHeightSpec, next: FillHeightSpec,
): FillHeightEdit {
  const dz = infillTopZ(next) - infillTopZ(previous);
  if (dz === 0) return { cutouts };
  const adjusted: CutoutPlacement[] = [];
  for (const cutout of cutouts) {
    if (![cutout.depth, ...(cutout.split?.depths ?? [])].some(depth => depth.mode === "mm")) {
      adjusted.push(cutout);
      continue;
    }
    const axis = pocketAxis(cutout);
    if (axis.z < 0.01) return { error: "Reduce pocket tilt before adjusting fixed pocket depths." };
    const axialDelta = dz / axis.z;
    const resize = (depth: DepthSpec): DepthSpec => depth.mode === "mm"
      ? { mode: "mm", value: depth.value + axialDelta } : depth;
    const depth = resize(cutout.depth);
    const split = cutout.split ? { ...cutout.split, depths: [resize(cutout.split.depths[0]), resize(cutout.split.depths[1])] as [DepthSpec, DepthSpec] } : undefined;
    if ([depth, ...(split?.depths ?? [])].some(d => d.mode === "mm" && d.value <= POCKET_DEPTH_EPSILON_MM)) {
      return { error: "This fill height would leave a fixed pocket with no depth. Increase the fill height or pocket depth, or uncheck Adjust fixed pocket depths." };
    }
    adjusted.push({ ...cutout, depth, ...(split ? { split } : {}),
      // The mouth follows the same tilted shaft; its floor stays fixed in XY too.
      position: { x: cutout.position.x + axis.x * axialDelta, y: cutout.position.y + axis.y * axialDelta },
    });
  }
  // Independently tilted linked copies can require different axial depths.
  // Reject atomically instead of saving a group whose shared designs disagree.
  if (designLinkErrors({ cutouts: adjusted, fingerHoles: [] }).length) {
    return { error: "Linked pockets with different tilts need different depth adjustments. Link their tilts, make the copies independent, or uncheck Adjust fixed pocket depths." };
  }
  return { cutouts: adjusted };
}
