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
type LayoutGroupObjects = {
  cutouts: (GroupMember & { position: { x: number; y: number } })[];
  fingerHoles: (GroupMember & { center: { x: number; y: number } })[];
};

/** Resizing and recentering a layout change its coordinate frame, not the
 * arrangement inside a group. Rebase both frame points by the members' shared
 * translation; reject a layout command that would move members independently.
 * Removed members are ignored, and the normal commit step prunes singletons. */
export function rebaseLayoutGroups<T extends LayoutGroupObjects>(before: LayoutGroupObjects, next: T): T | null {
  const frames = new Map<string, { delta: { x: number; y: number }; group: ObjectGroup }>();
  const collect = <M extends GroupMember>(oldItems: M[], nextItems: M[], point: (item: M) => { x: number; y: number }) => {
    const byId = new Map(nextItems.map(item => [item.id, item]));
    for (const old of oldItems) {
      const group = old.placementGroup, item = byId.get(old.id);
      if (!group || !item) continue;
      const delta = { x: point(item).x - point(old).x, y: point(item).y - point(old).y };
      const previous = frames.get(group.id);
      if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)
        || previous && (Math.abs(previous.delta.x - delta.x) > 1e-7 || Math.abs(previous.delta.y - delta.y) > 1e-7)) return false;
      if (!previous) frames.set(group.id, { delta, group: { ...group,
        pivot: { ...group.pivot, x: group.pivot.x + delta.x, y: group.pivot.y + delta.y },
        origin: { ...group.origin, x: group.origin.x + delta.x, y: group.origin.y + delta.y },
      } });
    }
    return true;
  };
  if (!collect(before.cutouts, next.cutouts, item => item.position)
    || !collect(before.fingerHoles, next.fingerHoles, item => item.center)) return null;
  const rebase = <M extends GroupMember>(oldItems: GroupMember[], items: M[]) => {
    const byId = new Map(oldItems.map(item => [item.id, item.placementGroup]));
    return items.map(item => {
      const group = byId.get(item.id);
      return group ? { ...item, placementGroup: frames.get(group.id)!.group } : item;
    });
  };
  return { ...next, cutouts: rebase(before.cutouts, next.cutouts), fingerHoles: rebase(before.fingerHoles, next.fingerHoles) };
}

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
