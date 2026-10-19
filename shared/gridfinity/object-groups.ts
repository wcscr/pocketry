import { z } from "zod";

const point3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict();

/** A shared placement frame, independent of geometry links. Member poses remain
 * materialized for the geometry/export pipeline; transforms use this fixed frame. */
export const objectGroupSchema = z.object({
  id: z.string().min(1),
  pivot: point3,
  origin: point3,
  rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
    .refine(q => Math.abs(q.reduce((sum, n) => sum + n * n, 0) - 1) < 1e-6, "Group rotation must be a unit quaternion"),
}).strict();
export type ObjectGroup = z.infer<typeof objectGroupSchema>;
export type GroupMember = { id: string; placementGroup?: ObjectGroup };
export type GroupRef = { kind: "pocket" | "finger"; id: string };
type GroupObjects = { cutouts: GroupMember[]; fingerHoles: GroupMember[] };

export function groupForRef(doc: GroupObjects, ref: GroupRef): ObjectGroup | undefined {
  return (ref.kind === "pocket" ? doc.cutouts : doc.fingerHoles).find(o => o.id === ref.id)?.placementGroup;
}

/** A selection always contains complete groups; the clicked object stays active. */
export function expandGroupSelection(doc: GroupObjects, selection: readonly GroupRef[]): GroupRef[] {
  const ids = new Set(selection.flatMap(ref => { const group = groupForRef(doc, ref); return group ? [group.id] : []; }));
  const extra: GroupRef[] = [
    ...doc.cutouts.filter(o => o.placementGroup && ids.has(o.placementGroup.id)).map(o => ({ kind: "pocket" as const, id: o.id })),
    ...doc.fingerHoles.filter(o => o.placementGroup && ids.has(o.placementGroup.id)).map(o => ({ kind: "finger" as const, id: o.id })),
  ];
  return [...extra.filter(ref => !selection.some(s => s.kind === ref.kind && s.id === ref.id)), ...selection];
}

/** Removing members dissolves a one-object group without moving its survivor. */
export function pruneObjectGroups<T extends GroupObjects>(doc: T): T {
  const counts = new Map<string, number>();
  for (const item of [...doc.cutouts, ...doc.fingerHoles]) if (item.placementGroup) {
    counts.set(item.placementGroup.id, (counts.get(item.placementGroup.id) ?? 0) + 1);
  }
  const clean = <M extends GroupMember>(items: M[]) => items.map(item => item.placementGroup && counts.get(item.placementGroup.id)! < 2
    ? { ...item, placementGroup: undefined } : item);
  return { ...doc, cutouts: clean(doc.cutouts), fingerHoles: clean(doc.fingerHoles) };
}

export function objectGroupErrors(doc: GroupObjects): string[] {
  const groups = new Map<string, { frame: string; count: number }>();
  for (const item of [...doc.cutouts, ...doc.fingerHoles]) {
    if (!item.placementGroup) continue;
    const frame = JSON.stringify(item.placementGroup), old = groups.get(item.placementGroup.id);
    if (old && old.frame !== frame) return ["Grouped objects must share one placement frame"];
    groups.set(item.placementGroup.id, { frame, count: (old?.count ?? 0) + 1 });
  }
  return [...groups.values()].some(group => group.count < 2) ? ["A group needs at least two objects"] : [];
}
