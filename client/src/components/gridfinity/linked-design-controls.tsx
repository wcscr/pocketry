import { useEffect, useState } from "react";
import { CopyPlus, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBin } from "@/state/bin-store";
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
  const items = kind === "pocket" ? cutouts : fingerHoles;
  const active = items.find(item => item.id === activeId);
  const selected = selection.filter(ref => ref.kind === kind).map(ref => ref.id);
  const ids = selected.length ? selected : [activeId];
  const members = active?.designLink ? items.filter(item => item.designLink?.id === active.designLink!.id) : [];
  const sameDesign = !!active?.designLink && ids.every(id => items.find(item => item.id === id)?.designLink?.id === active.designLink!.id);
  const [sourceId, setSourceId] = useState(activeId);
  const [linkTilt, setLinkTilt] = useState(false);
  const selectionKey = JSON.stringify(selection);
  useEffect(() => { setSourceId(activeId); setLinkTilt(false); }, [activeId, selectionKey]);
  if (!active) return null;
  const noun = kind === "pocket" ? "pockets" : "thumb slots";
  const canLink = ids.length >= 2 && !sameDesign;
  const linkedSelected = items.filter(item => ids.includes(item.id) && item.designLink);
  return <section aria-label="Linked design" data-property-tone={kind === "pocket" ? "violet" : "cyan"} className="property-surface space-y-2 rounded-lg border p-3 text-xs">
    <div className="flex items-center gap-2 font-medium"><Link2 className="h-3.5 w-3.5 shrink-0" />
      <span>{sameDesign ? `Linked design · ${members.length} ${noun}` : ids.length > 1 ? `${ids.length} selected ${noun}` : "Independent design"}</span>
      {members.length > 1 && <Button size="sm" variant="ghost" className="ml-auto h-8 px-2 text-[10px]" onClick={() => dispatch({ type: "SET_SELECTION", selection: members.map(item => ({ kind, id: item.id })) })}>Select linked</Button>}
    </div>
    {sameDesign && <>
      <p className="truncate text-[10px] text-muted-foreground" title={members.map(m => labels.get(m.id) ?? m.id).join(", ")}>{members.map(m => labels.get(m.id) ?? m.id).join(", ")}</p>
      <p className="text-[10px] text-muted-foreground">Editing size, shape or depth updates every linked copy. Placement stays independent.</p>
      {kind === "pocket" && <label className="flex min-h-8 items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={active.designLink!.tilt}
          onChange={e => dispatch({ type: "SET_LINKED_TILT", id: activeId, enabled: e.target.checked })} />
        Share X/Y tilt
      </label>}
    </>}
    {canLink && <>
      <label className="flex items-center gap-2"><span className="shrink-0">Use design from</span>
        <select aria-label="Linked design source" value={sourceId} onChange={e => setSourceId(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2">
          {ids.map(id => <option key={id} value={id}>{labels.get(id) ?? id}</option>)}
        </select>
      </label>
      <p className="text-[10px] text-muted-foreground">Copies adopt this shape, size and depth. Their positions and names stay the same.</p>
      {kind === "pocket" && <label className="flex min-h-8 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={linkTilt} onChange={e => setLinkTilt(e.target.checked)} />Also share X/Y tilt</label>}
    </>}
    <div className="flex flex-wrap gap-1.5">
      {canLink && <Button size="sm" className="min-h-9 gap-1.5 px-2 text-[11px]" onClick={() => {
        dispatch({ type: "LINK_DESIGNS", kind, ids, sourceId, linkId: crypto.randomUUID(), tilt: linkTilt });
      }}><Link2 className="h-3.5 w-3.5" />Link {ids.length} {noun}</Button>}
      {linkedSelected.length > 0 && <Button variant="outline" size="sm" className="min-h-9 gap-1.5 px-2 text-[11px]"
        title="Keep the current design and edit these objects independently"
        onClick={() => dispatch({ type: "UNLINK_DESIGNS", kind, ids })}><Unlink className="h-3.5 w-3.5" />{ids.length > 1 ? `Unlink ${linkedSelected.length} ${noun}` : "Unlink"}</Button>}
      {ids.length === 1 && <Button variant="outline" size="sm" className="min-h-9 gap-1.5 px-2 text-[11px]" onClick={() => dispatch({ type: "DUPLICATE_LINKED", kind, id: activeId, newId: crypto.randomUUID(), linkId: crypto.randomUUID() })}><CopyPlus className="h-3.5 w-3.5" />Duplicate linked</Button>}
    </div>
    {ids.length < 2 && !sameDesign && <p className="text-[10px] text-muted-foreground">Shift/Ctrl-click another {kind === "pocket" ? "pocket" : "thumb slot"} to link existing designs.</p>}
    {selection.some(ref => ref.kind !== kind) && <p className="text-[10px] text-muted-foreground">Pockets and thumb slots use separate designs.</p>}
    {editError && <p role="alert" className="text-destructive">{editError}</p>}
  </section>;
}
