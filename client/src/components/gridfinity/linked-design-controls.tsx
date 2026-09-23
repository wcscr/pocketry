import { useEffect, useState } from "react";
import { CopyPlus, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBin } from "@/state/bin-store";
import type { DesignObjectKind } from "@shared/gridfinity/design-links";

/** Link membership is explicit. Choosing a source makes replacement of existing
 * dimensions reviewable before a selection adopts one shared design. */
export function LinkedDesignControls({ kind, activeId, labels }: {
  kind: DesignObjectKind; activeId: string; labels: ReadonlyMap<string, string>;
}): JSX.Element {
  const { cutouts, fingerHoles, selection, dispatch, editError } = useBin();
  const items = kind === "pocket" ? cutouts : fingerHoles;
  const active = items.find(item => item.id === activeId)!;
  const selected = selection.filter(ref => ref.kind === kind).map(ref => ref.id);
  const mixed = selection.some(ref => ref.kind !== kind);
  const members = active.designLink ? items.filter(item => item.designLink?.id === active.designLink!.id) : [];
  const [choosing, setChoosing] = useState(false);
  const [sourceId, setSourceId] = useState(activeId);
  const [linkTilt, setLinkTilt] = useState(false);
  const selectionKey = JSON.stringify(selection);
  useEffect(() => { setChoosing(false); setSourceId(activeId); setLinkTilt(false); }, [activeId, selectionKey]);
  const noun = kind === "pocket" ? "pockets" : "thumb slots";
  const unlinkIds = selected.length > 1 && !mixed ? selected : [activeId];
  return <section aria-label="Linked design" className="space-y-2 rounded-lg border bg-background/70 p-2 text-xs">
    <div className="flex items-center gap-2 font-medium"><Link2 className="h-3.5 w-3.5" />
      {members.length ? `Linked design · ${members.length} ${noun}` : "Independent design"}
      {members.length > 1 && <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[10px]" onClick={() => dispatch({ type: "SET_SELECTION", selection: members.map(item => ({ kind, id: item.id })) })}>Select linked</Button>}
    </div>
    {members.length > 0 && <>
      <p className="text-[10px] text-muted-foreground">Size, shape, depth and rounding edits apply to every linked copy. Names and placement stay independent.</p>
      {kind === "pocket" && <label className="flex min-h-8 items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={active.designLink!.tilt}
          onChange={e => dispatch({ type: "SET_LINKED_TILT", id: activeId, enabled: e.target.checked })} />
        Link X/Y tilt <span className="text-[10px] text-muted-foreground">Z heading stays independent</span>
      </label>}
    </>}
    <div className="flex flex-wrap gap-1.5">
      <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-[11px]" onClick={() => dispatch({ type: "DUPLICATE_LINKED", kind, id: activeId, newId: crypto.randomUUID(), linkId: crypto.randomUUID() })}><CopyPlus className="h-3.5 w-3.5" />Duplicate linked</Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-[11px]" disabled={selected.length < 2 || mixed}
        onClick={() => { setSourceId(activeId); setChoosing(!choosing); }}><Link2 className="h-3.5 w-3.5" />Link selected…</Button>
      {items.some(item => unlinkIds.includes(item.id) && item.designLink) && <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[11px]"
        onClick={() => dispatch({ type: "UNLINK_DESIGNS", kind, ids: unlinkIds })}><Unlink className="h-3.5 w-3.5" />{unlinkIds.length > 1 ? "Make selected independent" : "Make independent"}</Button>}
    </div>
    {mixed && <p className="text-[10px] text-muted-foreground">Link pockets and thumb slots in separate sets.</p>}
    {choosing && <div className="space-y-2 border-t pt-2">
      <label className="block space-y-1"><span>Use design from</span>
        <select aria-label="Linked design source" value={sourceId} onChange={e => setSourceId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2">
          {selected.map(id => <option key={id} value={id}>{labels.get(id) ?? id}</option>)}
        </select>
      </label>
      {kind === "pocket" && <label className="flex min-h-8 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={linkTilt} onChange={e => setLinkTilt(e.target.checked)} />Also link X/Y tilt</label>}
      <p className="text-[10px] text-muted-foreground">The {selected.length} selected {noun} will adopt this design. Unselected copies keep their current links.</p>
      <div className="flex gap-2"><Button size="sm" className="text-xs" onClick={() => {
        dispatch({ type: "LINK_DESIGNS", kind, ids: selected, sourceId, linkId: crypto.randomUUID(), tilt: linkTilt }); setChoosing(false);
      }}>Link {selected.length} {noun}</Button><Button size="sm" variant="ghost" onClick={() => setChoosing(false)}>Cancel</Button></div>
    </div>}
    {editError && <p role="alert" className="text-destructive">{editError}</p>}
  </section>;
}
