import { useMemo, useState } from "react";
import { Copy, MousePointer2, Trash2, X } from "lucide-react";
import { WorkspaceLayout, type WorkspaceLayoutProps } from "@/components/layout/workspace-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { pocketName } from "@shared/gridfinity/cutout";
import { sameObject, objectRef, type EditableObject } from "@/lib/gridfinity/object-arrangement";
import { commonSelectionValue, selectionPropertyEdits, type SelectionProperty } from "@/lib/gridfinity/selection-properties";
import { SelectionInspectorContext, useSelectionInspector } from "./selection-inspector-context";
import { SelectionLinkControls } from "./linked-design-controls";

/** Opt-in prototype reuses the actual editor, geometry, persistence and history. */
export function BinEditingWorkspace({ enabled, ...props }: WorkspaceLayoutProps & { enabled: boolean }): JSX.Element {
  const [properties, setProperties] = useState<HTMLDivElement | null>(null);
  const [transforms, setTransforms] = useState<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<"properties" | "transform">("properties");
  const targets = useMemo(() => ({ properties, transforms, activeTab, setActiveTab }), [properties, transforms, activeTab]);
  if (!enabled) return <WorkspaceLayout {...props} />;
  return <SelectionInspectorContext.Provider value={targets}>
    <WorkspaceLayout {...props} autoSaveId={`${props.autoSaveId}:inspector`}
      inspector={<SelectionInspector propertiesRef={setProperties} transformsRef={setTransforms} />} />
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

export function SelectionInspector({ propertiesRef, transformsRef }: {
  propertiesRef: (node: HTMLDivElement | null) => void; transformsRef: (node: HTMLDivElement | null) => void;
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
  return <aside className="flex h-full min-h-0 flex-col bg-background [@media(max-height:500px)]:overflow-y-auto [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_input]:min-h-11 [@media(pointer:coarse)]:[&_select]:min-h-11" aria-label="Selection inspector" data-testid="selection-inspector">
    <header className="shrink-0 border-b px-3 py-3">
      <div className="flex items-center gap-2"><MousePointer2 className="h-4 w-4 text-violet-500" /><span className="text-xs font-medium text-muted-foreground">Properties</span>
        <Button size="icon" variant="ghost" className="ml-auto h-7 w-7 [@media(pointer:coarse)]:min-w-11" disabled={!chosen.length} aria-label="Clear object selection" onClick={() => bin.dispatch({ type: "SET_SELECTION", selection: [] })}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="truncate text-sm font-semibold" title={title} aria-live="polite">{chosen.length ? title : "Select an object"}</p>
      {!!chosen.length && <p className="mt-1 text-xs text-muted-foreground">{[pockets.length ? `${pockets.length} pocket${pockets.length === 1 ? "" : "s"}` : "", fingers.length ? `${fingers.length} finger access${fingers.length === 1 ? "" : "es"}` : ""].filter(Boolean).join(" · ")}</p>}
      {!!chosen.length && <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => bin.dispatch({ type: "DUPLICATE_SELECTION", ids: chosen.map(o => ({ source: objectRef(o), id: crypto.randomUUID() })) })}><Copy className="h-3.5 w-3.5" />Duplicate</Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => bin.dispatch({ type: "REMOVE_SELECTION" })}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
      </div>}
      {!!chosen.length && <div className="mt-3 flex gap-1" role="group" aria-label="Selection tools">
        <Button size="sm" variant={inspector?.activeTab === "properties" ? "secondary" : "ghost"} aria-pressed={inspector?.activeTab === "properties"} onClick={() => inspector?.setActiveTab("properties")}>Properties</Button>
        <Button size="sm" variant={inspector?.activeTab === "transform" ? "secondary" : "ghost"} aria-pressed={inspector?.activeTab === "transform"} onClick={() => inspector?.setActiveTab("transform")}>Move &amp; arrange</Button>
      </div>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [@media(max-height:500px)]:flex-none [@media(max-height:500px)]:overflow-visible" data-testid="inspector-scroll">
      {!chosen.length && <p className="p-4 text-sm text-muted-foreground">Choose objects in the list or canvas. Use checkboxes or Shift-click to select several.</p>}
      <div hidden={inspector?.activeTab === "transform"}>
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
      <div ref={transformsRef} hidden={inspector?.activeTab !== "transform"} className="empty:hidden" data-testid="inspector-transforms" />
      {bin.editError && <p className="p-3 text-xs text-destructive" role="alert">{bin.editError}</p>}
    </div>
  </aside>;
}
