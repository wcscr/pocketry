import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, MousePointer2, Trash2, X, SlidersHorizontal } from "lucide-react";
import { WorkspaceLayout, type WorkspaceLayoutProps } from "@/components/layout/workspace-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { pocketName } from "@shared/gridfinity/cutout";
import { sameObject, objectRef, type EditableObject } from "@/lib/gridfinity/object-arrangement";
import { commonSelectionValue, selectionPropertyEdits, type SelectionProperty } from "@/lib/gridfinity/selection-properties";
import { SelectionInspectorContext, useSelectionInspector, type InspectorTool } from "./selection-inspector-context";
import { SelectionLinkControls } from "./linked-design-controls";

/** Opt-in prototype reuses the actual editor, geometry, persistence and history. */
export function BinEditingWorkspace({ enabled, ...props }: WorkspaceLayoutProps & { enabled: boolean }): JSX.Element {
  const [properties, setProperties] = useState<HTMLDivElement | null>(null);
  const [transforms, setTransforms] = useState<HTMLDivElement | null>(null);
  const [pocketList, setPocketList] = useState<HTMLDivElement | null>(null);
  const [fingerList, setFingerList] = useState<HTMLDivElement | null>(null);
  const [tool, updateTool] = useState<InspectorTool>("properties");
  const [openRequest, setOpenRequest] = useState(0);
  const openInspector = useCallback(() => setOpenRequest(n => n + 1), []);
  const setTool = useCallback((next: InspectorTool) => { updateTool(next); openInspector(); }, [openInspector]);
  const { selection } = useBin();
  const selectionKey = JSON.stringify(selection);
  useEffect(() => { if (enabled && selection.length) openInspector(); }, [enabled, selectionKey, openInspector]);
  useEffect(() => { if (selection.length < 2 && tool === "arrange") updateTool("properties"); }, [selection.length, tool]);
  const targets = useMemo(() => ({ properties, transforms, pocketList, fingerList, tool, setTool, openInspector }),
    [properties, transforms, pocketList, fingerList, tool, setTool, openInspector]);
  if (!enabled) return <WorkspaceLayout {...props} />;
  return <SelectionInspectorContext.Provider value={targets}>
    <WorkspaceLayout {...props} autoSaveId={`${props.autoSaveId}:inspector`}
      inspectorRequest={(props.inspectorRequest ?? 0) + openRequest}
      inspector={<SelectionInspector propertiesRef={setProperties} transformsRef={setTransforms} pocketListRef={setPocketList} fingerListRef={setFingerList} />} />
  </SelectionInspectorContext.Provider>;
}

function BatchField({ objects, all, kind, property, label }: {
  objects: EditableObject[]; all: EditableObject[]; kind: "pocket" | "finger"; property: SelectionProperty; label: string;
}): JSX.Element {
  const { spec, selection, dispatch } = useBin();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = commonSelectionValue(objects, property);
  return <form className="space-y-1.5" onSubmit={event => {
    event.preventDefault();
    if (draft === null || !draft.trim()) return;
    try {
      const edits = selectionPropertyEdits(all, selection, kind, property, Number(draft), spec);
      dispatch({ type: "UPDATE_OBJECTS", edits, historyLabel: `Change ${label.toLowerCase()} for ${objects.length} ${kind === "pocket" ? "pockets" : "finger accesses"}` });
      setDraft(null); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply this change."); }
  }}>
    <label className="block text-xs font-medium" htmlFor={`batch-${kind}-${property}`}>{label}</label>
    <div className="flex items-center gap-2">
      <Input id={`batch-${kind}-${property}`} aria-label={`${label} for selected ${kind === "pocket" ? "pockets" : "finger accesses"}`}
        className="h-9 min-w-0 flex-1 text-sm" type="number" step="any" placeholder="Mixed" value={draft ?? value ?? ""}
        onChange={event => { setDraft(event.target.value); setError(null); }} />
      <span className="text-xs text-muted-foreground">mm</span>
      <Button type="submit" variant="outline" size="sm" disabled={draft === null || !draft.trim()} aria-label={`Apply ${label.toLowerCase()} to selected ${kind === "pocket" ? "pockets" : "finger accesses"}`}>Apply</Button>
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
  </form>;
}

export function SelectionInspector({ propertiesRef, transformsRef, pocketListRef, fingerListRef }: {
  propertiesRef: (node: HTMLDivElement | null) => void; transformsRef: (node: HTMLDivElement | null) => void;
  pocketListRef: (node: HTMLDivElement | null) => void; fingerListRef: (node: HTMLDivElement | null) => void;
}): JSX.Element {
  const bin = useBin();
  const inspector = useSelectionInspector();
  const { shapes } = useShapeLibrary();
  const objects: EditableObject[] = [...bin.cutouts.flatMap(cutout => {
    const shape = shapes.find(s => s.id === cutout.shapeId);
    return shape ? [{ kind: "pocket" as const, cutout, shape }] : [];
  }), ...bin.fingerHoles.map(hole => ({ kind: "finger" as const, hole }))];
  const chosen = bin.selection.flatMap(ref => objects.filter(o => sameObject(ref, objectRef(o))));
  const pockets = chosen.filter(o => o.kind === "pocket");
  const fingers = chosen.filter(o => o.kind === "finger");
  const single = chosen.length === 1 ? chosen[0] : null;
  const title = single ? single.kind === "pocket" ? pocketName(single.cutout, single.shape)
    : single.hole.name ?? `Finger access ${bin.fingerHoles.indexOf(single.hole) + 1}` : `${chosen.length} selected`;
  const links = new Set(chosen.map(o => o.kind === "pocket" ? o.cutout.designLink?.id : o.hole.designLink?.id).filter(Boolean));
  const extraLinked = objects.filter(o => !chosen.includes(o) && links.has(o.kind === "pocket" ? o.cutout.designLink?.id : o.hole.designLink?.id)).length;
  return <aside className="flex h-full min-h-0 flex-col bg-background [@media(max-height:500px)]:overflow-y-auto [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_input:not([type=checkbox])]:min-h-11 [@media(pointer:coarse)]:[&_select]:min-h-11" aria-label="Selection inspector" data-testid="selection-inspector">
    <section className="flex max-h-[38%] min-h-36 shrink-0 flex-col border-b [@media(max-height:500px)]:max-h-48" aria-label="Object selection">
      <div className="flex shrink-0 items-center gap-1 px-3 py-1">
        <span className="mr-auto text-xs font-semibold">Objects · {objects.length}</span>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => bin.dispatch({ type: "SET_SELECTION", selection: objects.map(objectRef) })}>Select all</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!chosen.length} title="Clear selection" aria-label="Clear object selection" onClick={() => bin.dispatch({ type: "SET_SELECTION", selection: [] })}><X /></Button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2" data-testid="object-list-scroll">
        <h3 className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Pockets</h3>
        <div ref={pocketListRef} />
        {!pockets.length && !bin.cutouts.length && <p className="px-1 text-xs text-muted-foreground">Add a pocket from the workflow.</p>}
        <h3 className="px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-400">Finger access</h3>
        <div ref={fingerListRef} />
        {!bin.fingerHoles.length && <p className="px-1 text-xs text-muted-foreground">No finger accesses yet.</p>}
      </div>
    </section>
    <header className="shrink-0 border-b px-3 py-2">
      <div className="flex items-center gap-2"><MousePointer2 className="h-4 w-4 shrink-0 text-violet-500" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={title} aria-live="polite">{chosen.length ? title : "Select an object"}</p>
        {!!chosen.length && <>
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate selection" aria-label="Duplicate selection" onClick={() => bin.dispatch({ type: "DUPLICATE_SELECTION", ids: chosen.map(o => ({ source: objectRef(o), id: crypto.randomUUID() })) })}><Copy /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Delete selection" aria-label="Delete selection" onClick={() => bin.dispatch({ type: "REMOVE_SELECTION" })}><Trash2 /></Button>
        </>}
      </div>
      {!!chosen.length && <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{[pockets.length ? `${pockets.length} pocket${pockets.length === 1 ? "" : "s"}` : "", fingers.length ? `${fingers.length} finger access${fingers.length === 1 ? "" : "es"}` : ""].filter(Boolean).join(" · ")}</p>
        {inspector?.tool !== "properties" && <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={() => inspector?.setTool("properties")}><SlidersHorizontal />Properties</Button>}
      </div>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [@media(max-height:500px)]:flex-none [@media(max-height:500px)]:overflow-visible" data-testid="inspector-scroll">
      {!chosen.length && <p className="p-4 text-sm text-muted-foreground">Choose objects in the list or canvas. Use checkboxes or Shift-click to select several.</p>}
      <div hidden={inspector?.tool !== "properties"}>
      {!!extraLinked && <p className="m-3 rounded-md border border-violet-500/30 bg-violet-500/5 p-2 text-xs" role="status">Design edits also update {extraLinked} unselected linked {extraLinked === 1 ? "copy" : "copies"}. Movement stays independent.</p>}
      {chosen.length > 1 && <div className="space-y-4 p-3" data-testid="batch-properties">
        {([pockets, fingers]).filter(items => items.length).map(items => <section key={items[0].kind} className="space-y-3" aria-label={`${items.length} selected ${items[0].kind === "pocket" ? `pocket${items.length === 1 ? "" : "s"}` : `finger access${items.length === 1 ? "" : "es"}`}`}>
          <h3 className="border-b pb-2 text-xs font-semibold">{items.length} selected {items[0].kind === "pocket" ? `pocket${items.length === 1 ? "" : "s"}` : `finger access${items.length === 1 ? "" : "es"}`}</h3>
          {(["depth", "topFilletMm", ...(items[0].kind === "pocket" ? ["clearanceMm"] : [])] as SelectionProperty[]).map(property => <BatchField
            key={`${JSON.stringify(bin.selection)}:${JSON.stringify(items)}:${property}`} objects={items} all={objects} kind={items[0].kind} property={property}
            label={property === "depth" ? "Fixed cut depth" : property === "topFilletMm" ? "Top rounding" : "Extra clearance"} />)}
          {items.some(o => o.kind === "pocket" && o.cutout.split) && <p className="text-xs text-muted-foreground">Setting depth updates both sections of selected split pockets.</p>}
        </section>)}
        <details><summary className="cursor-pointer py-2 text-xs font-medium">Linked designs</summary><SelectionLinkControls /></details>
      </div>}
      <div ref={propertiesRef} className="p-3 empty:hidden" data-testid="inspector-properties" />
      </div>
      <div ref={transformsRef} hidden={inspector?.tool === "properties"} className="empty:hidden" data-testid="inspector-transforms" />
      {bin.editError && <p className="p-3 text-xs text-destructive" role="alert">{bin.editError}</p>}
    </div>
  </aside>;
}
