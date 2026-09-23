import { clampFingerHoleToBin, type CutoutPlacement, type FingerHole } from "./cutout";
import type { BinSpec } from "./types";

export type DesignObjectKind = "pocket" | "finger";
export interface DesignObjects { cutouts: CutoutPlacement[]; fingerHoles: FingerHole[] }

// Copies retain complete geometry for the existing worker/export paths. The
// explicit link id, validated in every saved snapshot, makes these fields one
// shared design. Shape revisions remain immutable and update all references.
const pocketFields = ["shapeId", "scaleX", "scaleY", "aspectRatioLocked", "depth", "split", "clearanceMm", "cornerRoundMm", "topFilletMm", "bottomFilletMm"] as const;
const fingerFields = ["kind", "diameterMm", "lengthMm", "depthMm", "topFilletMm", "bottomFilletMm", "cornerRoundMm", "slotEnds"] as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function pocketDesign(pocket: CutoutPlacement): Partial<CutoutPlacement> {
  return { ...Object.fromEntries(pocketFields.map(key => [key, pocket[key]])),
    ...(pocket.designLink?.tilt ? { tilt: pocket.tilt ?? { xDeg: 0, yDeg: 0 } } : {}) };
}
export function fingerDesign(hole: FingerHole): Partial<FingerHole> {
  return Object.fromEntries(fingerFields.map(key => [key, hole[key]]));
}

type LinkedObject = { id: string; designLink?: { id: string; tilt: boolean } };
function propagate<T extends LinkedObject>(before: T[], edits: T[], design: (item: T) => Partial<T>): T[] | null {
  const changes = new Map<string, Partial<T>>();
  for (const next of edits) {
    const original = before.find(item => item.id === next.id);
    if (!original?.designLink) continue;
    // Linking and unlinking are explicit commands, never incidental edits.
    if (!equal(original.designLink, next.designLink)) return null;
    const oldDesign = design(original), newDesign = design(next);
    const patch: Partial<T> = changes.get(original.designLink.id) ?? {};
    for (const key of Object.keys(newDesign) as (keyof T)[]) {
      if (equal(oldDesign[key], newDesign[key])) continue;
      if (key in patch && !equal(patch[key], newDesign[key])) return null;
      patch[key] = newDesign[key];
    }
    changes.set(original.designLink.id, patch);
  }
  return before.map(item => ({ ...(edits.find(next => next.id === item.id) ?? item),
    ...(item.designLink ? changes.get(item.designLink.id) : {}) }));
}

/** Conflicting simultaneous edits reject the entire command, without picking a winner. */
export function applyLinkedEdits(before: DesignObjects, edits: DesignObjects): DesignObjects | null {
  const cutouts = propagate(before.cutouts, edits.cutouts, pocketDesign);
  const fingerHoles = propagate(before.fingerHoles, edits.fingerHoles, fingerDesign);
  return cutouts && fingerHoles ? { cutouts, fingerHoles } : null;
}

/** Saved groups must agree even in undo/redo snapshots. Unlinked shared shapes are legal. */
export function designLinkErrors(objects: DesignObjects): string[] {
  const errors: string[] = [];
  function check<T extends LinkedObject>(items: T[], design: (item: T) => Partial<T>, kind: string) {
    const groups = new Map<string, T>();
    for (const item of items) {
      if (!item.designLink) continue;
      const first = groups.get(item.designLink.id);
      if (first && (!equal(first.designLink, item.designLink) || !equal(design(first), design(item)))) {
        errors.push(`Linked ${kind} designs must agree`); break;
      }
      groups.set(item.designLink.id, item);
    }
  }
  check(objects.cutouts, pocketDesign, "pocket"); check(objects.fingerHoles, fingerDesign, "thumb-access");
  return errors;
}

/** Fit a linked access design to every member's orientation, using one common size. */
export function clampLinkedFingerHoles(holes: FingerHole[], spec: BinSpec, changedIds?: ReadonlySet<string>): FingerHole[] {
  let result = [...holes];
  const handled = new Set<string>();
  for (const hole of holes) {
    if (changedIds && !changedIds.has(hole.id)) continue;
    if (!hole.designLink) {
      result = result.map(h => h.id === hole.id ? clampFingerHoleToBin(h, spec) : h); continue;
    }
    if (handled.has(hole.designLink.id)) continue;
    handled.add(hole.designLink.id);
    const members = result.filter(h => h.designLink?.id === hole.designLink!.id);
    // Each step can only shrink dimensions. Earlier orientations remain fitted.
    let common = fingerDesign(hole);
    for (const member of members) common = fingerDesign(clampFingerHoleToBin({ ...member, ...common }, spec));
    result = result.map(h => h.designLink?.id === hole.designLink!.id ? { ...h, ...common } : h);
  }
  return result;
}
