import { HelpHint } from "@/components/ui/help-hint";
import { PropertySurface } from "@/components/layout/property-surface";
import { cn } from "@/lib/utils";
import { AddObjectButton } from "./add-object-button";
import { useAddSurfaceText } from "./use-add-surface-text";
import { useSelectionInspector } from "./selection-inspector-context";
import { useId, useState } from "react";
import { EditableObjectName, ObjectActions } from "./object-list-controls";
import { Pencil, Trash2 } from "lucide-react";
import { surfaceTextName, type SurfaceText } from "@shared/gridfinity/surface-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { SurfaceTextFontPicker } from "./surface-text-font-picker";
import { useSurfaceTextWording } from "./use-surface-text-wording";
import { useBin } from "@/state/bin-store";

/** Label edits live in the bin spec, so persistence and undo use the existing document path. */
export function SurfaceTextControls({ onPositionText }: { onPositionText: () => void }): JSX.Element {
  const { spec, selectedSurfaceTextId, dispatch } = useBin();
  const inspector = useSelectionInspector();
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
        data-testid={`surface-text-row-${label.id}`}>
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
      <HelpHint label="surface text exports">3MF keeps each label as a separate named part for moving, scaling, or coloring in your slicer. Choose multi-color 3MF to preserve the text color. Change the wording in Pocketry. STL joins text to the bin.</HelpHint>
    </div>}
  </div>;
}

/** Mounted independently of the list so collapsing it keeps the selected editor available. */
export function SurfaceTextProperties(): JSX.Element | null {
  const { spec, selectedSurfaceTextId, dispatch } = useBin();
  const selected = spec.surfaceTexts.find(label => label.id === selectedSurfaceTextId);
  const update = (labels: SurfaceText[], historyLabel: string, transient = false) =>
    dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: labels }, historyLabel, transient });
  return selected ? <PropertySurface id="surface-text-properties" tone="cyan" aria-label="Surface text properties">
    <TextEditor key={selected.id} label={selected} index={spec.surfaceTexts.indexOf(selected)}
      onChange={(patch, transient) => update(spec.surfaceTexts.map(item => item.id === selected.id ? { ...item, ...patch } : item), "Edit surface text", transient)}
      onRemove={() => update(spec.surfaceTexts.filter(item => item.id !== selected.id), "Remove surface text")} />
  </PropertySurface> : null;
}

function TextEditor({ label, index, onChange, onRemove }: {
  label: SurfaceText; index: number;
  onChange: (patch: Partial<SurfaceText>, transient?: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const id = useId();
  const { draft, error, change, commit } = useSurfaceTextWording(label);
  const numericFields = [
    { key: "sizeMm", name: "Size (mm)", min: 2, max: 40, step: 0.5 },
    { key: "heightMm", name: "Raised height (mm)", min: 0.2, max: 5, step: 0.2 },
  ] as const;
  return <fieldset className="space-y-2 rounded-md border p-2.5" data-testid="surface-text-editor">
    <legend className="px-1 text-xs font-medium">Text {index + 1}</legend>
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={id} className="text-xs">Wording</Label>
        <Input id={id} type="text" value={draft} maxLength={120} className="h-8" aria-invalid={!!error}
          onChange={event => change(event.target.value)} onBlur={commit}
          onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </div>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remove text ${index + 1}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <SurfaceTextFontPicker label={label} index={index} id={`${id}-font`} onChange={font => onChange({ font })} />
    <div className="space-y-2">
      {numericFields.map(field => <Label key={field.key} className="flex min-w-0 items-center gap-2 text-xs">
        <span className="flex-1">{field.key === "sizeMm" ? "Size" : "Raised height"}</span>
        <DraftNumberInput aria-label={field.name} className="h-8 w-20 min-w-0" value={label[field.key]} displayPrecision={2} min={field.min} max={field.max} step={field.step}
          onValueChange={value => onChange({ [field.key]: value }, true)}
          onValueCommit={value => onChange({ [field.key]: value })} />
        <span className="text-[11px] text-muted-foreground">mm</span>
      </Label>)}
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y"] as const).map(axis => <Label key={axis} className="flex min-w-0 items-center gap-1 text-xs">
          {axis.toUpperCase()}
          <DraftNumberInput aria-label={`${axis.toUpperCase()} (mm)`} className="h-8 min-w-0" value={label.position[axis]} min={-672} max={672} step={1} displayPrecision={2}
            onValueChange={value => onChange({ position: { ...label.position, [axis]: value } }, true)}
            onValueCommit={value => onChange({ position: { ...label.position, [axis]: value } })} />
          <span className="text-[11px] text-muted-foreground">mm</span>
        </Label>)}
      </div>
      <Label className="flex min-w-0 items-center gap-2 text-xs">
        <span className="flex-1">Rotation</span>
        <DraftNumberInput aria-label="Rotation (°)" className="h-8 w-20 min-w-0" value={label.rotationDeg} min={-180} max={180} step={5} displayPrecision={2}
          onValueChange={value => onChange({ rotationDeg: value }, true)} onValueCommit={value => onChange({ rotationDeg: value })} />
        <span className="w-4 text-[11px] text-muted-foreground">°</span>
      </Label>
    </div>
  </fieldset>;
}
