import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PropertySurface } from "@/components/layout/property-surface";
import { BIN_OBJECT_SECTIONS, BIN_WORKFLOW_SECTIONS } from "./bin-workflow";
import { Copy, Trash2 } from "lucide-react";
import { WorkspaceLayout, type WorkspaceLayoutProps } from "@/components/layout/workspace-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { pocketName } from "@shared/gridfinity/cutout";
import { sameObject, objectRef, type EditableObject } from "@/lib/gridfinity/object-arrangement";
import { commonSelectionValue, selectionPropertyEdits, type SelectionProperty } from "@/lib/gridfinity/selection-properties";
import { SelectionInspectorContext, useSelectionInspector, type InspectorTool } from "./selection-inspector-context";

/** Opt-in prototype reuses the actual editor, geometry, persistence and history. */
export function BinEditingWorkspace({ enabled, ...props }: WorkspaceLayoutProps & { enabled: boolean }): JSX.Element {
  const [activeSection, setActiveSection] = useState<string | null>("bin-settings-size");
  const [properties, setProperties] = useState<HTMLDivElement | null>(null);
  const [transforms, setTransforms] = useState<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<HTMLDivElement | null>(null);
  const [projectHeader, setProjectHeader] = useState<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const { enabled: experimentalEnabled } = useExperimentalFeatures();
  const [tool, updateTool] = useState<InspectorTool>("properties");
  useEffect(() => { if (!experimentalEnabled) updateTool("properties"); }, [experimentalEnabled]);
  const [openRequest, setOpenRequest] = useState(0);
  const openInspector = useCallback(() => setOpenRequest(n => n + 1), []);
  const setTool = useCallback((next: InspectorTool) => { setActiveSection(null); updateTool(next); openInspector(); }, [openInspector]);
  const keepList = useRef(false);
  const keepObjectsOpen = useCallback(() => { keepList.current = true; setActiveSection(null); updateTool("properties"); }, []);
  const { selection, editorMode } = useBin();
  const showSection = useCallback((id: string) => {
    setActiveSection(id); updateTool("properties");
    // Object navigation keeps the list available, including in the phone drawer.
    // Choosing a row then opens that object's properties.
    if (!BIN_OBJECT_SECTIONS.has(id)) openInspector();
  }, [openInspector]);
  const selectionKey = JSON.stringify(selection);
  useEffect(() => { if (enabled && selection.length) { setActiveSection(null); if (!keepList.current) openInspector(); } keepList.current = false; }, [enabled, selectionKey, openInspector]);
  useEffect(() => { if (!selection.length || selection.length < 2 && (tool === "arrange" || tool === "links")) updateTool("properties"); }, [selection.length, tool]);
  useEffect(() => { if (props.inspectorRequest) setActiveSection(null); }, [props.inspectorRequest]);
  const targets = useMemo(() => ({ activeSection, properties, transforms, settings, projectHeader, toolbar, showSection, tool, setTool, openInspector, keepObjectsOpen }),
    [activeSection, properties, transforms, settings, projectHeader, toolbar, showSection, tool, setTool, openInspector, keepObjectsOpen]);
  if (!enabled) return <WorkspaceLayout {...props} />;
  return <SelectionInspectorContext.Provider value={targets}>
    <WorkspaceLayout {...props} autoSaveId={`${props.autoSaveId}:inspector`} inspectorPanelTitle="Workflow"
      inspectorRequest={(props.inspectorRequest ?? 0) + openRequest}
      canvasEditingMode={editorMode}
      inspectorHeader={<div ref={setProjectHeader} />}
      inspectorToolbar={<div ref={setToolbar} className="flex min-w-max items-center gap-1" />}
      inspector={<SelectionInspector propertiesRef={setProperties} transformsRef={setTransforms} settingsRef={setSettings} />} />
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

export function SelectionInspector({ propertiesRef, transformsRef, settingsRef }: {
  propertiesRef: (node: HTMLDivElement | null) => void; transformsRef: (node: HTMLDivElement | null) => void;
  settingsRef: (node: HTMLDivElement | null) => void;
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
  const section = inspector ? BIN_WORKFLOW_SECTIONS.find(item => item.id === inspector.activeSection) : null;
  const showingSection = !!section;
  const tone = section?.tone ?? (pockets.length && !fingers.length ? "violet" : fingers.length && !pockets.length ? "cyan" : chosen.length ? "slate" : "blue");
  const title = section?.title ?? (single ? single.kind === "pocket" ? pocketName(single.cutout, single.shape)
    : single.hole.name ?? `Finger access ${bin.fingerHoles.indexOf(single.hole) + 1}` : chosen.length ? `${chosen.length} selected` : "Bin");
  const toolLabel = inspector?.tool === "translate" ? "Move" : inspector?.tool === "rotate" ? "Rotate" : inspector?.tool === "arrange" ? "Arrange" : inspector?.tool === "links" ? "Linked designs" : "Properties";
  const links = new Set(chosen.map(o => o.kind === "pocket" ? o.cutout.designLink?.id : o.hole.designLink?.id).filter(Boolean));
  const extraLinked = objects.filter(o => !chosen.includes(o) && links.has(o.kind === "pocket" ? o.cutout.designLink?.id : o.hole.designLink?.id)).length;
  return <aside className="flex h-full min-h-0 flex-col bg-background [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_input:not([type=checkbox])]:min-h-11 [@media(pointer:coarse)]:[&_select]:min-h-11" aria-label="Selection inspector" data-testid="selection-inspector">
    <header data-property-tone={tone} className="property-heading flex min-h-14 shrink-0 items-center gap-1 border-b py-2 pl-3 pr-12" data-testid="inspector-properties-header">
      <div className="mr-auto min-w-0" aria-live="polite">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{section ? "Workflow properties" : single ? single.kind === "pocket" ? "Pocket" : "Finger access" : chosen.length ? "Selection" : "Properties"}</p>
        <h3 className="truncate text-sm font-semibold" title={title}>{title}</h3>
      </div>
      {!showingSection && (chosen.length > 1 || single?.kind === "finger") && <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate selection" aria-label="Duplicate selection" onClick={() => bin.dispatch({ type: "DUPLICATE_SELECTION", ids: chosen.map(o => ({ source: objectRef(o), id: crypto.randomUUID() })) })}><Copy /></Button>}
      {!showingSection && chosen.length > 1 && <Button size="icon" variant="ghost" className="h-8 w-8" title="Delete selection" aria-label="Delete selection" onClick={() => bin.dispatch({ type: "REMOVE_SELECTION" })}><Trash2 /></Button>}
    </header>
    {!showingSection && !!chosen.length && (inspector?.tool !== "properties" || bin.editorMode === "contour") && <div className="flex min-h-10 shrink-0 items-center justify-between border-b px-3 text-xs font-medium" data-testid="inspector-active-tool">
      <span>{bin.editorMode === "contour" ? "Editing contour" : toolLabel}</span>
      <Button variant="ghost" size="sm" className="h-8" aria-label="Back to properties" onClick={() => {
        bin.dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" }); inspector?.setTool("properties");
      }}>Done</Button>
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="inspector-scroll">
      <div ref={settingsRef} hidden={!showingSection && !!chosen.length} data-testid="inspector-bin-settings" />
      <div hidden={showingSection || !chosen.length || inspector?.tool !== "properties"}>
      {!!extraLinked && <p className="m-3 rounded-md border border-violet-500/30 bg-violet-500/5 p-2 text-xs" role="status">Design edits also update {extraLinked} unselected linked {extraLinked === 1 ? "copy" : "copies"}. Movement stays independent.</p>}
      {chosen.length > 1 && <div className="space-y-4 p-3" data-testid="batch-properties">
        {([pockets, fingers]).filter(items => items.length).map(items => <PropertySurface key={items[0].kind} tone={items[0].kind === "pocket" ? "violet" : "cyan"} role="region" aria-label={`${items.length} selected ${items[0].kind === "pocket" ? `pocket${items.length === 1 ? "" : "s"}` : `finger access${items.length === 1 ? "" : "es"}`}`}>
          <h3 className="border-b pb-2 text-xs font-semibold">{items.length} selected {items[0].kind === "pocket" ? `pocket${items.length === 1 ? "" : "s"}` : `finger access${items.length === 1 ? "" : "es"}`}</h3>
          {(["depth", "topFilletMm", ...(items[0].kind === "pocket" ? ["clearanceMm"] : [])] as SelectionProperty[]).map(property => <BatchField
            key={`${JSON.stringify(bin.selection)}:${JSON.stringify(items)}:${property}`} objects={items} all={objects} kind={items[0].kind} property={property}
            label={property === "depth" ? "Fixed cut depth" : property === "topFilletMm" ? "Top rounding" : "Extra clearance"} />)}
          {items.some(o => o.kind === "pocket" && o.cutout.split) && <p className="text-xs text-muted-foreground">Setting depth updates both sections of selected split pockets.</p>}
        </PropertySurface>)}
      </div>}
      <div ref={propertiesRef} className="p-3 empty:hidden" data-testid="inspector-properties" />
      </div>
      <div data-property-tone={tone} className="property-surface m-3 rounded-lg border empty:hidden" ref={transformsRef} hidden={showingSection || !chosen.length || inspector?.tool === "properties"} data-testid="inspector-transforms" />
      {bin.editError && <p className="p-3 text-xs text-destructive" role="alert">{bin.editError}</p>}
    </div>
  </aside>;
}
