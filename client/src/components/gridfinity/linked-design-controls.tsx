import { useEffect, useState } from "react";
import { CopyPlus, Link2, Unlink } from "lucide-react";
import { HelpHint } from "@/components/ui/help-hint";
import { Button } from "@/components/ui/button";
import { useBin } from "@/state/bin-store";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { useShapeLibrary } from "@/state/shape-library";
import { pocketName } from "@shared/gridfinity/cutout";
import type { DesignObjectKind } from "@shared/gridfinity/design-links";

/** Keep common link/unlink actions beside the selected objects in either view. */
export function SelectionLinkControls(): JSX.Element {
  const { cutouts, fingerHoles, selection } = useBin();
  const { shapes } = useShapeLibrary();
  const labels = new Map([...cutouts.map(c => [c.id, pocketName(c, shapes.find(s => s.id === c.shapeId))] as const),
    ...fingerHoles.map((h, i) => [h.id, h.name ?? `Finger access ${i + 1}`] as const)]);
  return <div className="space-y-2">{(["pocket", "finger"] as const).map(kind => {
    const active = selection.filter(ref => ref.kind === kind).at(-1);
    return active ? <LinkedDesignControls key={kind} kind={kind} activeId={active.id} labels={labels} /> : null;
  })}</div>;
}

/** The source is visible before linking; the last selected object is the default. */
export function LinkedDesignControls({ kind, activeId, labels }: {
  kind: DesignObjectKind; activeId: string; labels: ReadonlyMap<string, string>;
}): JSX.Element | null {
  const { cutouts, fingerHoles, selection, dispatch, editError } = useBin();
  const { enabled, setEnabled } = useExperimentalFeatures();
  const { shapes } = useShapeLibrary();
  const items = kind === "pocket" ? cutouts : fingerHoles;
  const active = items.find(item => item.id === activeId);
  const selected = selection.filter(ref => ref.kind === kind).map(ref => ref.id);
  const ids = selected.length ? selected : [activeId];
  const members = active?.designLink ? items.filter(item => item.designLink?.id === active.designLink!.id) : [];
  const sameDesign = !!active?.designLink && ids.every(id => items.find(item => item.id === id)?.designLink?.id === active.designLink!.id);
  const [sourceId, setSourceId] = useState(activeId);
  const selectionKey = JSON.stringify(selection);
  useEffect(() => { setSourceId(activeId); }, [activeId, selectionKey]);
  if (!active) return null;
  if (!enabled) return active.designLink ? <section aria-label="Linked geometry" className="rounded-lg border p-3 text-xs">
    <p className="flex items-center gap-2"><Link2 className="h-4 w-4" />Linked geometry · {members.length} copies</p>
    <p className="mt-1 text-muted-foreground">Position and rotation stay independent. Shared geometry edits require experimental tools.</p>
    <Button variant="link" className="h-auto whitespace-normal px-0 text-xs" onClick={() => setEnabled(true)}>Enable experimental tools</Button>
  </section> : null;
  const hasHoles = kind === "pocket" && cutouts.some(c => (ids.includes(c.id) || members.some(m => m.id === c.id)) && c.role === "hole");
  const noun = kind === "pocket" ? hasHoles ? "objects" : "pockets" : "finger accesses";
  const memberNoun = members.length === 1 ? kind === "pocket" ? hasHoles ? "object" : "pocket" : "finger access" : noun;
  const canLink = ids.length >= 2 && !sameDesign;
  const linkedSelected = items.filter(item => ids.includes(item.id) && item.designLink);
  return <section aria-label="Linked geometry" data-property-tone={kind === "pocket" ? "violet" : "cyan"} className="property-surface space-y-2 rounded-lg border p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2 font-medium"><Link2 className="h-3.5 w-3.5 shrink-0" />
      <span title={members.map(m => labels.get(m.id) ?? m.id).join(", ")}>{sameDesign ? `Linked geometry · ${members.length} ${memberNoun}` : ids.length > 1 ? `${ids.length} selected ${noun}` : "Independent geometry"}</span>
      <HelpHint label="linked copies">Linked copies share {kind === "pocket" ? "Pocket or Hole type, " : ""}shape, size, depth, clearance, edge rounding and insertion settings. Position, elevation, rotation, names and mirroring stay independent. Group objects to move and rotate them together. Ordinary Duplicate makes an independent copy.{members.length > 1 && <p className="mt-2">Linked copies: {members.map(m => labels.get(m.id) ?? m.id).join(", ")}.</p>}</HelpHint>
      {members.length > 1 && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => dispatch({ type: "SET_SELECTION", selection: members.map(item => ({ kind, id: item.id })) })}>Select linked</Button>}
    </div>
    {sameDesign && <>
      {members.length > 1 && <p className="text-xs text-muted-foreground">Geometry edits update all {members.length} copies.</p>}
    </>}
    {canLink && <>
      <label className="flex items-center gap-2"><span className="shrink-0">Use design from</span>
        <select aria-label="Linked geometry source" value={sourceId} onChange={e => setSourceId(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2">
          {ids.map(id => <option key={id} value={id}>{labels.get(id) ?? id}</option>)}
        </select>
      </label>
      <p className="text-[10px] text-muted-foreground">Copies adopt this shape, size and depth{kind === "pocket" ? ", including its Pocket or Hole type" : ""}. Their positions and names stay the same.</p>
    </>}
    <div className="flex flex-wrap gap-1.5">
      {canLink && <Button size="sm" className="min-h-9 gap-1.5 px-2 text-[11px]" onClick={() => {
        dispatch({ type: "LINK_DESIGNS", kind, ids, sourceId, linkId: crypto.randomUUID(), tilt: false, shapes });
      }}><Link2 className="h-3.5 w-3.5" />Link geometry</Button>}
      {linkedSelected.length > 0 && <Button variant="outline" size="sm" className="min-h-9 gap-1.5 px-2 text-[11px]"
        title="Keep the current design and edit these objects independently"
        onClick={() => dispatch({ type: "UNLINK_DESIGNS", kind, ids })}><Unlink className="h-3.5 w-3.5" />Unlink geometry</Button>}
      {ids.length === 1 && <Button variant="outline" size="sm" className="min-h-9 gap-1.5 px-2 text-[11px]" onClick={() => dispatch({ type: "DUPLICATE_LINKED", kind, id: activeId, newId: crypto.randomUUID(), linkId: crypto.randomUUID(), labels })}><CopyPlus className="h-3.5 w-3.5" />Duplicate linked</Button>}
    </div>
    {selection.some(ref => ref.kind !== kind) && <p className="text-[10px] text-muted-foreground">Pockets and finger access link separately.</p>}
    {editError && <p role="alert" className="text-destructive">{editError}</p>}
  </section>;
}
