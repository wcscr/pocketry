import { POCKET_DEPTH_EPSILON_MM, type CutoutPlacement, type DepthSpec } from "./cutout";
import { designLinkErrors } from "./design-links";
import { infillTopZ, type FillHeightSpec } from "./fill";
import type { BinDoc } from "./history";
import { pocketAxis } from "./pocket-orientation";
import { hasRigidPocket } from "./rigid-pocket";

export type FillHeightEdit = { cutouts: CutoutPlacement[]; error?: never }
  | { cutouts?: never; error: string };

/** Resize from a retained baseline, so checkbox reversals and repeated slider
 * frames cannot accumulate adjustments. The reference travels with the pocket
 * through project saves and undo snapshots, independently of history limits. */
export function adjustPocketsForFillHeight(
  cutouts: CutoutPlacement[], previous: FillHeightSpec, next: FillHeightSpec, enabled = true,
): FillHeightEdit {
  const adjusted: CutoutPlacement[] = [];
  for (const cutout of cutouts) {
    // Placed solids already keep their lowest point fixed. Resizing their source
    // with the fill would change thickness or reject sideways/inverted poses.
    if (hasRigidPocket(cutout) || cutout.profileBottom) {
      adjusted.push(cutout.fillHeightReference ? withoutReference(cutout) : cutout);
      continue;
    }
    if (![cutout.depth, ...(cutout.split?.depths ?? [])].some(depth => depth.mode === "mm")) {
      adjusted.push(cutout);
      continue;
    }
    if (!cutout.fillHeightReference && infillTopZ(previous) === infillTopZ(next)) {
      adjusted.push(cutout);
      continue;
    }
    const reference = cutout.fillHeightReference ?? {
      topZ: infillTopZ(previous), position: cutout.position, depth: cutout.depth,
      ...(cutout.split ? { splitDepths: cutout.split.depths } : {}),
    };
    const axis = pocketAxis(cutout);
    if (enabled && axis.z < 0.01) return { error: "Reduce pocket tilt before adjusting fixed pocket depths." };
    const axialDelta = enabled ? (infillTopZ(next) - reference.topZ) / axis.z : 0;
    const resize = (depth: DepthSpec): DepthSpec => depth.mode === "mm"
      ? { mode: "mm", value: depth.value + axialDelta } : depth;
    const depth = resize(reference.depth);
    const splitDepths = reference.splitDepths ?? cutout.split?.depths;
    const split = cutout.split && splitDepths ? { ...cutout.split,
      depths: [resize(splitDepths[0]), resize(splitDepths[1])] as [DepthSpec, DepthSpec],
    } : undefined;
    if ([depth, ...(split?.depths ?? [])].some(d => d.mode === "mm" && d.value <= POCKET_DEPTH_EPSILON_MM)) {
      return { error: "This fill height would leave a fixed pocket with no depth. Increase the fill height or pocket depth, or uncheck Adjust fixed pocket depths." };
    }
    adjusted.push({ ...cutout, depth, ...(split ? { split } : {}), fillHeightReference: { ...reference },
      // The mouth follows the same tilted shaft; its floor stays fixed in XY too.
      position: { x: reference.position.x + axis.x * axialDelta, y: reference.position.y + axis.y * axialDelta },
    });
  }
  if (designLinkErrors({ cutouts: adjusted, fingerHoles: [] }).length) {
    return { error: "Linked pockets with different tilts need different depth adjustments. Link their tilts, make the copies independent, or uncheck Adjust fixed pocket depths." };
  }
  return { cutouts: adjusted };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function withoutReference(cutout: CutoutPlacement): CutoutPlacement {
  const { fillHeightReference: _reference, ...rest } = cutout;
  return rest;
}

/** Keep later translations/names when toggling. Explicit depth, split or
 * orientation edits establish a new baseline for that pocket's linked group.
 * Adjusted cutouts carry a new reference object and bypass this reconciliation. */
export function reconcileFillHeightReferences(previous: BinDoc, next: BinDoc): BinDoc {
  const resetLinks = new Set<string>();
  const topDelta = infillTopZ({ ...previous.spec, heightUnits: next.spec.heightUnits, lip: next.spec.lip }) - infillTopZ(previous.spec);
  let cutouts = next.cutouts.map(cutout => {
    const reference = cutout.fillHeightReference;
    if (!reference) return cutout;
    if (hasRigidPocket(cutout) || cutout.profileBottom) return withoutReference(cutout);
    // Duplicates initially share the source's reference; translate it to the copy.
    const before = previous.cutouts.find(c => c.id === cutout.id)
      ?? previous.cutouts.find(c => c.fillHeightReference === reference);
    if (!before || reference !== before.fillHeightReference) return cutout;
    if (!same(cutout.depth, before.depth) || !same(cutout.split, before.split)
      || !same(cutout.tilt, before.tilt) || cutout.rotationDeg !== before.rotationDeg
      || (cutout.id === before.id && !same(cutout.designLink, before.designLink))) {
      if (cutout.designLink) resetLinks.add(cutout.designLink.id);
      if (before.designLink) resetLinks.add(before.designLink.id);
      return withoutReference(cutout);
    }
    const dx = cutout.position.x - before.position.x, dy = cutout.position.y - before.position.y;
    if (dx === 0 && dy === 0 && topDelta === 0) return cutout;
    return { ...cutout, fillHeightReference: { ...reference, topZ: reference.topZ + topDelta,
      position: { x: reference.position.x + dx, y: reference.position.y + dy } } };
  });
  if (resetLinks.size) cutouts = cutouts.map(c => c.designLink && resetLinks.has(c.designLink.id) ? withoutReference(c) : c);
  return cutouts.every((c, i) => c === next.cutouts[i]) ? next : { ...next, cutouts };
}
