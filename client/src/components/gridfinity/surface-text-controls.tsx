import { useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SURFACE_TEXT_FONTS, surfaceTextSchema, type SurfaceText } from "@shared/gridfinity/surface-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { surfaceTextOutline } from "@/lib/gridfinity/surface-text";
import { useBin } from "@/state/bin-store";

/** Label edits live in the bin spec, so persistence and undo use the existing document path. */
export function SurfaceTextControls({ edgeBandColor, onPositionText }: { edgeBandColor: string; onPositionText: () => void }): JSX.Element {
  const { spec, dispatch } = useBin();
  const update = (labels: SurfaceText[], historyLabel: string, transient = false) =>
    dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: labels }, historyLabel, transient });
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Add raised text to the flat interior surface. Drag it in Layout, clear of pockets and openings. You can position text even when the 3D preview cannot build.</p>
    {spec.surfaceTexts.length > 0 && <Button size="sm" variant="outline" className="w-full" onClick={onPositionText}>
      Position text in Layout
    </Button>}
    <div className="flex items-center justify-between gap-2">
      <div>
        <Label htmlFor="input-text-color" className="text-xs">Text color</Label>
        <p className="text-xs text-muted-foreground">{spec.textColor === null ? "Matches the edge band. Applies to all text." : "Applies to all text in this project."}</p>
      </div>
      <Input id="input-text-color" type="color" value={spec.textColor ?? edgeBandColor}
        aria-label="Text color" title="Choose project text color"
        className="h-7 w-10 cursor-pointer p-0.5"
        onChange={event => dispatch({ type: "PATCH_SPEC", patch: { textColor: event.target.value }, historyLabel: "Change text color" })} />
    </div>
    {spec.textColor !== null && <Button variant="link" size="sm" className="h-auto p-0 text-xs"
      onClick={() => dispatch({ type: "PATCH_SPEC", patch: { textColor: null }, historyLabel: "Match text to edge band" })}>
      Use edge-band color
    </Button>}
    {spec.surfaceTexts.map((label, index) => <TextEditor key={label.id} label={label} index={index}
      onChange={(patch, transient) => update(spec.surfaceTexts.map(item => item.id === label.id ? { ...item, ...patch } : item), "Edit surface text", transient)}
      onRemove={() => update(spec.surfaceTexts.filter(item => item.id !== label.id), "Remove surface text")} />)}
    <Button size="sm" variant="outline" className="w-full" disabled={spec.surfaceTexts.length >= 32}
      onClick={() => {
        update([...spec.surfaceTexts, surfaceTextSchema.parse({
          id: crypto.randomUUID(), text: "Text", position: { x: 0, y: 0 },
        })], "Add surface text");
        onPositionText();
      }} data-testid="button-add-surface-text">
      <Plus className="h-4 w-4" />Add text
    </Button>
    <p className="text-xs text-muted-foreground">3MF keeps each label as a separate named part for moving, scaling, or coloring in your slicer. Choose multi-color 3MF to preserve the text color. Change the wording in Pocketry. STL joins text to the bin.</p>
  </div>;
}

function TextEditor({ label, index, onChange, onRemove }: {
  label: SurfaceText; index: number;
  onChange: (patch: Partial<SurfaceText>, transient?: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(label.text);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(label.text); setError(null); }, [label.text]);
  const commitText = () => {
    const parsed = surfaceTextSchema.safeParse({ ...label, text: draft });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    try { surfaceTextOutline(parsed.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    setError(null);
    if (draft !== label.text) onChange({ text: draft });
  };
  const numericFields = [
    { key: "sizeMm", name: "Size (mm)", min: 2, max: 40, step: 0.5 },
    { key: "heightMm", name: "Raised height (mm)", min: 0.2, max: 5, step: 0.2 },
    { key: "rotationDeg", name: "Rotation (°)", min: -180, max: 180, step: 5 },
  ] as const;
  return <fieldset className="space-y-2 rounded-md border p-2.5" data-testid="surface-text-editor">
    <legend className="px-1 text-xs font-medium">Text {index + 1}</legend>
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={id} className="text-xs">Wording</Label>
        <Input id={id} type="text" value={draft} maxLength={120} className="h-8" aria-invalid={!!error}
          onChange={event => setDraft(event.target.value)} onBlur={commitText}
          onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </div>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remove text ${index + 1}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="space-y-1">
      <Label htmlFor={`${id}-font`} className="text-xs">Font</Label>
      <Select value={label.font} onValueChange={value => {
        const next = surfaceTextSchema.parse({ ...label, font: value });
        try { surfaceTextOutline(next); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
        setError(null);
        onChange({ font: next.font });
      }}>
        <SelectTrigger id={`${id}-font`} aria-label={`Text ${index + 1} font`} className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>{SURFACE_TEXT_FONTS.map(font => <SelectItem key={font.id} value={font.id}>{font.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {numericFields.map(field => <div key={field.key} className="space-y-1">
        <Label htmlFor={`${id}-${field.key}`} className="text-xs">{field.name}</Label>
        <DraftNumberInput id={`${id}-${field.key}`} className="h-8" value={label[field.key]} min={field.min} max={field.max} step={field.step}
          onValueChange={value => onChange({ [field.key]: value }, true)}
          onValueCommit={value => onChange({ [field.key]: value })} />
      </div>)}
      {(["x", "y"] as const).map(axis => <div key={axis} className="space-y-1">
        <Label htmlFor={`${id}-${axis}`} className="text-xs">{axis.toUpperCase()} (mm)</Label>
        <DraftNumberInput id={`${id}-${axis}`} className="h-8" value={label.position[axis]} min={-672} max={672} step={1} displayPrecision={2}
          onValueChange={value => onChange({ position: { ...label.position, [axis]: value } }, true)}
          onValueCommit={value => onChange({ position: { ...label.position, [axis]: value } })} />
      </div>)}
    </div>
  </fieldset>;
}
