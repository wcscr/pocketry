import { applyLinkedEdits } from "@shared/gridfinity/design-links";
import { effectiveFingerHoleDepthMm, fingerHoleSchema, parseCutoutPlacement, pocketDepths, resolvePlacedPocketDepth,
  resolvePocketDepth, maximumFingerAccessDepth, type DepthSpec } from "@shared/gridfinity/cutout";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import type { BinSpec } from "@shared/gridfinity/types";
import { sameObject, objectRef, type EditableObject, type ObjectEdits, type ObjectRef } from "./object-arrangement";

export type SelectionProperty = "depth" | "topFilletMm" | "clearanceMm";

/** Mixed modes and split depths stay mixed even when their current sizes happen
 * to match. Setting a depth is an explicit conversion to fixed cut depth. */
export function commonSelectionValue(objects: readonly EditableObject[], property: SelectionProperty): number | null {
  const values = objects.flatMap(o => property === "depth"
    ? o.kind === "pocket" ? pocketDepths(o.cutout).map(d => d.mode === "mm" ? d.value : null) : [effectiveFingerHoleDepthMm(o.hole)]
    : property === "clearanceMm" ? [o.kind === "pocket" ? o.cutout.clearanceMm : null]
    : [o.kind === "pocket" ? o.cutout.topFilletMm : o.hole.topFilletMm]);
  return values.length && values[0] !== null && values.every(v => v === values[0]) ? values[0] : null;
}

/** Validate the complete affected design, including unselected linked copies,
 * before issuing one UPDATE_OBJECTS transaction. Reject instead of partially
 * applying or silently clamping different members to different depths. */
export function selectionPropertyEdits(objects: readonly EditableObject[], selection: readonly ObjectRef[],
  kind: ObjectRef["kind"], property: SelectionProperty, value: number, spec: BinSpec,
): ObjectEdits {
  if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
  if (property === "depth" && (value < 1 || value > 120)) throw new Error("Depth must be between 1 and 120 mm.");
  if (property === "topFilletMm" && (value < 0 || value > 5)) throw new Error("Top rounding must be between 0 and 5 mm.");
  if (property === "clearanceMm" && (value < -2 || value > 2)) throw new Error("Clearance must be between −2 and 2 mm.");
  const chosen = objects.filter(o => o.kind === kind && selection.some(ref => sameObject(ref, objectRef(o))));
  const edits: ObjectEdits = { cutouts: [], fingerHoles: [] };
  for (const object of chosen) {
    if (object.kind === "pocket") {
      const depth: DepthSpec = { mode: "mm", value };
      edits.cutouts.push(parseCutoutPlacement({ ...object.cutout, ...(property === "depth"
        ? { depth, ...(object.cutout.split ? { split: { ...object.cutout.split, depths: [depth, depth] } } : {}) }
        : { [property]: value }) }));
    } else {
      if (property === "clearanceMm") throw new Error("Clearance applies to pockets only.");
      edits.fingerHoles.push(fingerHoleSchema.parse({ ...object.hole, ...(property === "depth"
        ? { depthMm: value, kind: object.hole.kind === "scoop" ? "deep-scoop" : object.hole.kind }
        : { topFilletMm: value }) }));
    }
  }
  const before = { cutouts: objects.flatMap(o => o.kind === "pocket" ? [o.cutout] : []),
    fingerHoles: objects.flatMap(o => o.kind === "finger" ? [o.hole] : []) };
  const expanded = applyLinkedEdits(before, edits);
  if (!expanded) throw new Error("Linked designs disagree. Edit one linked copy or unlink them first.");
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  for (const next of expanded.cutouts) {
    const old = objects.find(o => o.kind === "pocket" && o.cutout.id === next.id);
    if (old?.kind !== "pocket" || JSON.stringify(old.cutout) === JSON.stringify(next)) continue;
    const split = next.split ? resolvePocketSplit(old.shape.outlineMm, next.split.boundary) : null;
    if (split && !split.regions) throw new Error("A selected pocket has an invalid split. Edit it individually first.");
    pocketDepths(next).forEach((depth, i) => {
      const seat = resolvePlacedPocketDepth(spec, depth, { outlineMm: split?.regions?.[i] ?? old.shape.outlineMm }, next);
      if (seat.floorZ !== null && (seat.floorZ < -1e-7 || seat.highestFloorZ! > top - 0.5 + 1e-7)) {
        throw new Error("That depth does not fit every affected pocket. Check bin height, tilt, and linked copies.");
      }
    });
  }
  for (const next of expanded.fingerHoles) {
    const old = before.fingerHoles.find(h => h.id === next.id);
    if (JSON.stringify(old) !== JSON.stringify(next) && effectiveFingerHoleDepthMm(next) > maximumFingerAccessDepth(spec)) {
      throw new Error("That depth exceeds this bin’s finger-access limit.");
    }
  }
  return expanded;
}
