import { useBinObjectContextMenu } from "./object-context-menu";
import { contextMenuPoint, usesNativeEditingMenu } from "@/components/ui/pointer-context-menu";
import { HelpHint } from "@/components/ui/help-hint";
import { PropertySurface } from "@/components/layout/property-surface";
import { cn } from "@/lib/utils";
import { AddObjectButton } from "./add-object-button";
import { useAddSurfaceText } from "./use-add-surface-text";
import { useSelectionInspector } from "./selection-inspector-context";
import { useId, useState } from "react";
import { EditableObjectName, ObjectActions } from "./object-list-controls";
import { Pencil, Trash2 } from "lucide-react";
import { surfaceTextName, surfaceTextSymbolGap, type SurfaceText } from "@shared/gridfinity/surface-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { SurfaceTextFontPicker } from "./surface-text-font-picker";
import { SurfaceTextSymbolPicker } from "./surface-text-symbol-picker";
import { useSurfaceTextWording } from "./use-surface-text-wording";
import { useBin } from "@/state/bin-store";

/** Label edits live in the bin spec, so persistence and undo use the existing document path. */
export function SurfaceTextControls({ onPositionText }: { onPositionText: () => void }): JSX.Element {
  const { spec, selectedSurfaceTextId, dispatch } = useBin();
  const inspector = useSelectionInspector();
  const openObjectMenu = useBinObjectContextMenu();
  const addText = useAddSurfaceText(onPositionText);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const update = (labels: SurfaceText[], historyLabel: string, transient = false) =>
    dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: labels }, historyLabel, transient });
  return <div className="space-y-3">
    <div className="space-y-1" aria-label="Choose surface text to edit">
      {spec.surfaceTexts.map(label => {
        const name = surfaceTextName(label);
        const startRenaming = () => {
          if (!inspector) dispatch({ type: "SELECT_SURFACE_TEXT", id: label.id });
          setRenamingId(label.id);
        };
        return <div key={label.id} className={cn("flex items-center rounded-md border text-xs",
        label.id === selectedSurfaceTextId ? "border-cyan-500/50 bg-cyan-500/10" : "border-transparent hover:bg-accent")}
        data-testid={`surface-text-row-${label.id}`} onContextMenu={event => { if (!usesNativeEditingMenu(event.target) && openObjectMenu?.({ kind: "text", id: label.id }, contextMenuPoint(event))) event.preventDefault(); }}>
        {renamingId === label.id ? <EditableObjectName key={label.id} kind="surface-text" name={name}
          onRename={name => update(spec.surfaceTexts.map(item => item.id === label.id ? { ...item, name } : item), "Rename surface text")}
          onDone={() => setRenamingId(null)} /> : <button type="button" className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"
          aria-label={`${name} — edit surface text properties`} title="Double-click to rename" onDoubleClick={startRenaming} aria-pressed={label.id === selectedSurfaceTextId}
          aria-controls="surface-text-properties" data-testid={`button-select-surface-text-${label.id}`}
          onClick={() => { dispatch({ type: "SELECT_SURFACE_TEXT", id: label.id }); inspector?.setTool("properties"); }}>
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </button>}
        <ObjectActions name={name}>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Rename ${name}`} onClick={startRenaming}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remove ${name}`}
          onClick={() => update(spec.surfaceTexts.filter(item => item.id !== label.id), "Remove surface text")}><Trash2 className="h-3.5 w-3.5" /></Button>
        </ObjectActions>
      </div>; })}
    </div>
    <AddObjectButton className="w-full" disabled={spec.surfaceTexts.length >= 32} onClick={addText} data-testid="button-add-surface-text">Add text</AddObjectButton>
    {!inspector && <SurfaceTextProperties />}
    {spec.surfaceTexts.length > 0 && <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" className="flex-1" onClick={onPositionText}>Position text in Layout</Button>
      <HelpHint label="surface text exports">3MF keeps each label as a separate named part for moving, scaling, or coloring in your slicer. Choose multi-color 3MF to preserve the text color. Change the text in Pocketry. STL joins text to the bin.</HelpHint>
    </div>}
  </div>;
}

/** Mounted independently of the list so collapsing it keeps the selected editor available. */
export function SurfaceTextProperties(): JSX.Element | null {
  const { spec, selectedSurfaceTextId, dispatch } = useBin();
  const inspector = useSelectionInspector();
  const selected = spec.surfaceTexts.find(label => label.id === selectedSurfaceTextId);
  const update = (labels: SurfaceText[], historyLabel: string, transient = false) =>
    dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: labels }, historyLabel, transient });
  if (selected && (inspector?.tool === "translate" || inspector?.tool === "rotate")) return <SurfaceTextTransformControls mode={inspector.tool} />;
  return selected ? <PropertySurface id="surface-text-properties" tone="cyan" aria-label="Surface text properties">
    <TextEditor key={selected.id} label={selected} index={spec.surfaceTexts.indexOf(selected)}
      onChange={(patch, transient) => update(spec.surfaceTexts.map(item => item.id === selected.id ? { ...item, ...patch } : item), "Edit surface text", transient)}
      onRemove={() => update(spec.surfaceTexts.filter(item => item.id !== selected.id), "Remove surface text")} />
  </PropertySurface> : null;
}

/** Surface-anchored text uses the same XY / Z controls in Layout and 3D. */
export function SurfaceTextTransformControls({ mode }: { mode?: "translate" | "rotate" }): JSX.Element | null {
  const bin = useBin();
  const selected = bin.spec.surfaceTexts.find(label => label.id === bin.selectedSurfaceTextId);
  if (!selected) return null;
  const tool = mode ?? bin.textTool;
  const update = (patch: Partial<SurfaceText>, transient: boolean) => bin.dispatch({ type: "PATCH_SPEC",
    patch: { surfaceTexts: bin.spec.surfaceTexts.map(label => label.id === selected.id ? { ...label, ...patch } : label) },
    transient, historyLabel: tool === "translate" ? "Move surface text" : "Rotate surface text" });
  return <div className="space-y-3 p-2" data-testid="text-transform-controls">
    <div className="flex flex-wrap gap-1">
      {!mode && (["translate", "rotate"] as const).map(tool => <Button key={tool} size="sm" variant={bin.textTool === tool ? "secondary" : "ghost"} aria-pressed={bin.textTool === tool} onClick={() => bin.dispatch({ type: "SET_TEXT_TOOL", tool })}>{tool === "translate" ? "Move" : "Rotate"}</Button>)}
      <Button size="sm" className="min-h-11" variant={bin.textSnap ? "secondary" : "outline"} aria-pressed={bin.textSnap} onClick={() => bin.dispatch({ type: "SET_TEXT_SNAP", snap: !bin.textSnap })}>Snap · 1 mm / 5°</Button>
    </div>
    {tool === "translate" ? <div className="grid grid-cols-2 gap-2">{(["x", "y"] as const).map(axis => <Label key={axis} className="space-y-1 text-xs">{axis.toUpperCase()} · mm
      <DraftNumberInput aria-label={`Move text ${axis.toUpperCase()}`} className="h-11 w-full" value={selected.position[axis]} displayPrecision={2} min={-672} max={672} step={bin.textSnap ? 1 : "any"}
        onValueChange={value => update({ position: { ...selected.position, [axis]: value } }, true)} onValueCommit={value => update({ position: { ...selected.position, [axis]: value } }, false)} />
    </Label>)}</div> : <Label className="block space-y-1 text-xs">Z · degrees
      <DraftNumberInput aria-label="Rotate text Z" className="h-11 w-full" value={selected.rotationDeg} displayPrecision={2} min={-180} max={180} step={bin.textSnap ? 5 : "any"}
        onValueChange={rotationDeg => update({ rotationDeg }, true)} onValueCommit={rotationDeg => update({ rotationDeg }, false)} />
    </Label>}
    <p className="text-xs text-muted-foreground">Text stays anchored to its surface. Arrange and Link apply to pockets and finger access.</p>
  </div>;
}

function TextEditor({ label, index, onChange, onRemove }: {
  label: SurfaceText; index: number;
  onChange: (patch: Partial<SurfaceText>, transient?: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const id = useId();
  const { draft, error, change, commit, changeSymbol } = useSurfaceTextWording(label);
  const numeric = (key: "sizeMm" | "symbolSizeMm" | "symbolGapMm" | "symbolRotationDeg" | "heightMm" | "rotationDeg",
    name: string, unit: "mm" | "°", min: number, max: number, step: number, caption = name) =>
    <Label className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className="flex-1">{caption}</span>
      <DraftNumberInput aria-label={`${name} (${unit})`} className="h-8 w-16 min-w-0" value={label[key] ?? (key === "symbolSizeMm" ? label.sizeMm : key === "symbolGapMm" ? surfaceTextSymbolGap(label) : 0)}
        min={min} max={max} step={step} displayPrecision={2}
        onValueChange={value => updateNumber(key, value, true)} onValueCommit={value => updateNumber(key, value)} />
      <span className="text-[11px] text-muted-foreground">{unit}</span>
    </Label>;
  const updateNumber = (key: "sizeMm" | "symbolSizeMm" | "symbolGapMm" | "symbolRotationDeg" | "heightMm" | "rotationDeg", value: number, transient = false) => {
    // An older mixed label inherits text size until its first size edit. Freeze
    // that existing symbol size in the same undo transaction as a text resize.
    onChange({ [key]: value, ...(key === "sizeMm" && label.symbol && label.symbolSizeMm === undefined
      ? { symbolSizeMm: label.sizeMm } : {}) }, transient);
  };
  return <fieldset className="min-w-0 space-y-2" data-testid="surface-text-editor">
    <legend className="sr-only">Text {index + 1}</legend>
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="shrink-0 text-xs">Text</Label>
      <Input id={id} type="text" value={draft} maxLength={120} className="h-8 min-w-0 flex-1" aria-invalid={!!error}
        onChange={event => change(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remove text ${index + 1}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <SurfaceTextFontPicker label={label} index={index} id={`${id}-font`} onChange={font => onChange({ font })} />
      {numeric("sizeMm", "Text size", "mm", 2, 40, 0.5, "Size")}
    </div>
    <div className="space-y-2" role="group" aria-label="Label placement and height">
      <div className="grid grid-cols-2 gap-3">
        {numeric("heightMm", "Raised height", "mm", 0.2, 5, 0.2, "Height")}
        {numeric("rotationDeg", "Label rotation", "°", -180, 180, 5)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(["x", "y"] as const).map(axis => <Label key={axis} className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="flex-1">{axis.toUpperCase()}</span>
          <DraftNumberInput aria-label={`${axis.toUpperCase()} (mm)`} className="h-8 w-16 min-w-0" value={label.position[axis]} min={-672} max={672} step={1} displayPrecision={2}
            onValueChange={value => onChange({ position: { ...label.position, [axis]: value } }, true)}
            onValueCommit={value => onChange({ position: { ...label.position, [axis]: value } })} />
          <span className="text-[11px] text-muted-foreground">mm</span>
        </Label>)}
      </div>
    </div>
    <div className="space-y-2 border-t pt-2" role="group" aria-label="Symbol settings">
      <SurfaceTextSymbolPicker id={`${id}-symbol`} symbol={label.symbol} rotationDeg={label.symbolRotationDeg} canRemove={!!draft.trim()} onChange={changeSymbol} />
      {label.symbol && <div className="grid grid-cols-2 gap-3">
        {numeric("symbolSizeMm", "Symbol size", "mm", 2, 40, 0.5, "Size")}
        {numeric("symbolRotationDeg", "Symbol rotation", "°", -180, 180, 5, "Rotation")}
      </div>}
      {label.symbol && label.text.trim() && numeric("symbolGapMm", "Text gap", "mm", 0, 40, 0.5)}
    </div>
  </fieldset>;
}
