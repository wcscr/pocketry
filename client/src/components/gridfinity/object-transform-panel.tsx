import { createPortal } from "react-dom";
import { useSelectionInspector } from "./selection-inspector-context";
import { useEffect, useRef, useState } from "react";
import { objectTransformOffsets, setObjectTransformOffsets } from "@/lib/gridfinity/object-transform-offsets";
import { CheckSquare2, ChevronDown, X, Link2, Magnet, Move3D, Rotate3D, AlignHorizontalJustifyCenter, AlignHorizontalJustifyStart, AlignHorizontalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, AlignHorizontalSpaceAround, AlignVerticalSpaceAround } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pocketName } from "@shared/gridfinity/cutout";
import { pocketVerticalDepthMm, type PocketTransformMode } from "@/lib/gridfinity/pocket-transform";
import { arrangeObjects, objectEditsChanged, objectKey, objectRef,
  type EditableObject, type ObjectEdits, type RotationPivot } from "@/lib/gridfinity/object-arrangement";
import type { PocketEditor } from "./pocket-transform-scene";

export function commitEditorObjects(editor: PocketEditor, edits: ObjectEdits, text: string, mode: PocketTransformMode): void {
  if (editor.onCommitObjects) editor.onCommitObjects(edits, text);
  else edits.cutouts.forEach(cutout => editor.onCommit(cutout.id, cutout, mode));
}

/** As-drawn XYZ offsets work for a single object and mixed selections.
 * Each finished axis edit or arrangement command is one document transaction. */
export function ObjectTransformPanel({ editor, objects, selected, displayed, mode, setMode, snap, setSnap,
  pivot, setPivot, limited, onClose, modeRequest = 0 }: {
  editor: PocketEditor; objects: readonly EditableObject[]; selected: readonly EditableObject[]; displayed: readonly EditableObject[];
  mode: PocketTransformMode; setMode: (mode: PocketTransformMode) => void; snap: boolean; setSnap: (value: boolean) => void;
  onClose: () => void;
  /** A keyboard command can request the same mode while another tab is open. */
  modeRequest?: number;
  pivot: RotationPivot; setPivot: (pivot: RotationPivot) => void; limited: boolean;
}): JSX.Element {
  const inspector = useSelectionInspector();
  const showLinks = editor.linkControls && !inspector;
  const [legacyArranging, setArranging] = useState(false);
  const arranging = inspector ? inspector.tool === "arrange" : legacyArranging;
  const [legacyLinking, setLinking] = useState(false);
  const linking = inspector ? inspector.tool === "links" : legacyLinking;
  const [draft, setDraft] = useState<Record<number, string>>({});
  const pendingDraft = useRef<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<"selection" | "active">("selection");
  const key = JSON.stringify(selected.map(o => objectKey(objectRef(o))));
  const offsets = displayed.map(o => objectTransformOffsets(o, editor.spec, editor.transformOrigins, mode, editor.originShapes));
  const actual = [0, 1, 2].map(i => !offsets.length ? "0" : offsets.every(v => Math.abs(v[i] - offsets[0][i]) < 1e-5)
    ? String(Number(offsets[0][i].toFixed(4))) : "");
  const actualKey = JSON.stringify(offsets);
  const clearDraft = () => { pendingDraft.current = {}; setDraft({}); };
  useEffect(() => { clearDraft(); setError(null); }, [key, mode, actualKey, modeRequest]);
  useEffect(() => { setArranging(false); setLinking(false); }, [mode, modeRequest]);
  const select = (next: EditableObject[]) => {
    if (editor.onSelectionChange) editor.onSelectionChange(next.map(objectRef));
    else editor.onSelect(next.at(-1)?.kind === "pocket" ? objectRef(next.at(-1)!).id : null);
  };
  const isSelected = (o: EditableObject) => selected.some(s => objectKey(objectRef(s)) === objectKey(objectRef(o)));
  const fingerObjects = objects.filter(o => o.kind === "finger");
  const label = (o: EditableObject) => o.kind === "pocket" ? pocketName(o.cutout, o.shape)
    : o.hole.name ?? `Finger access ${fingerObjects.indexOf(o) + 1}`;
  const commit = (edits: ObjectEdits | null, text: string) => {
    if (!edits) { setError(arranging ? "There is not enough room for equal gaps between the outer objects." : "Cannot transform every affected copy. Check depth and tilt limits; try editing one linked copy."); return; }
    setError(null);
    if (objectEditsChanged(selected, edits)) commitEditorObjects(editor, edits, text, mode);
    clearDraft();
  };
  const applyAxis = (axis: number) => {
    const text = pendingDraft.current[axis];
    if (text === undefined) return;
    // Consume before blur can fire again; rejected edits restore the actual value.
    clearDraft();
    const value = text.trim() ? Number(text) : NaN;
    if (!Number.isFinite(value)) { setError("Enter a finite number for the edited axis."); return; }
    if (mode === "translate" && !Number.isFinite(value * 1e6)) {
      setError("That movement is too large. Enter a smaller distance."); return;
    }
    const numbers = [0, 1, 2].map(i => i === axis ? value : undefined);
    commit(setObjectTransformOffsets(selected, editor.spec, editor.transformOrigins, mode, numbers, pivot, objects, editor.originShapes),
      `${mode === "translate" ? "Move" : "Rotate"} ${selected.length} object${selected.length === 1 ? "" : "s"}`);
  };
  const mixed = selected.some(o => o.kind === "finger");
  const single = displayed.length === 1 ? displayed[0] : null;
  const content = <div className={inspector ? "text-xs" : "absolute left-3 top-16 z-20 max-h-[calc(100%-5rem)] w-64 max-w-[calc(100%-5rem)] overflow-y-auto rounded-xl border bg-background/95 text-xs shadow-lg backdrop-blur-md md:top-12"} data-testid="pocket-3d-controls">
    {!inspector && <div className="flex items-center justify-between border-b px-3 py-1">
      <span className="font-medium">Object controls</span>
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close object controls" title="Close object controls" onClick={onClose}><X className="h-4 w-4" /></Button>
    </div>}
    {!inspector && <details className="group border-b" open={selected.length === 0 || undefined}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium">
        <CheckSquare2 className="h-4 w-4 text-primary" />
        <span className="flex-1">{selected.length ? `${selected.length} object${selected.length === 1 ? "" : "s"} selected` : "Select objects"}</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t bg-muted/25 px-2 pb-2">
        <div className="flex justify-between py-1">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => select([...objects])}>Select all</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => select([])}>Clear</Button>
        </div>
        <div className="max-h-40 overflow-y-auto" aria-label="Objects in selection">
          {objects.map(o => <label key={objectKey(objectRef(o))} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-accent">
            <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select ${label(o)}`} checked={isSelected(o)}
              onChange={() => select(isSelected(o) ? selected.filter(s => objectKey(objectRef(s)) !== objectKey(objectRef(o))) : [...selected, o])} />
            <span className="truncate">{label(o)}</span>
          </label>)}
        </div>
        <p className="px-2 pt-1 text-[10px] text-muted-foreground">Shift / ⌘ / Ctrl + click to add or remove.</p>
      </div>
    </details>}
    <div className="space-y-3 p-3">
      {!inspector && <div className={cn("grid gap-1 rounded-lg bg-muted p-1", showLinks ? "grid-cols-4" : "grid-cols-3")} role="group" aria-label="Object tools">
        {(["translate", "rotate", "arrange"] as const).map(tool => <button key={tool} type="button"
          className={cn("flex min-h-9 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors", (!linking && (tool === "arrange" ? arranging : !arranging && mode === tool)) ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          aria-label={tool === "translate" ? "Move pocket (W)" : tool === "rotate" ? "Rotate pocket (E)" : "Align and distribute objects"}
          aria-pressed={!linking && (tool === "arrange" ? arranging : !arranging && mode === tool)}
          onClick={() => { setLinking(false); setError(null); setArranging(tool === "arrange"); if (tool !== "arrange") setMode(tool); }}>
          {tool === "translate" ? <Move3D className="h-4 w-4" /> : tool === "rotate" ? <Rotate3D className="h-4 w-4" /> : <AlignHorizontalJustifyCenter className="h-4 w-4" />}
          {tool === "translate" ? "Move" : tool === "rotate" ? "Rotate" : "Arrange"}
        </button>)}
        {showLinks && <button type="button" aria-label="Link and unlink designs" aria-pressed={linking}
          className={cn("flex min-h-9 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium", linking ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          onClick={() => { setLinking(true); setError(null); }}><Link2 className="h-4 w-4" />Links</button>}
      </div>}
      {linking ? <>{selected.length ? editor.linkControls : <p className="text-muted-foreground">Select objects to link or unlink their designs.</p>}</> : arranging ? <>
        <label className="flex items-center gap-2 text-xs">Relative to
          <select aria-label="Align relative to" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2" value={reference} onChange={e => setReference(e.target.value as "selection" | "active")}>
            <option value="selection">Selection bounds</option><option value="active">Last selected</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Align objects">
          {([
            ["x", "min", AlignHorizontalJustifyStart, "Align left edges"],
            ["x", "center", AlignHorizontalJustifyCenter, "Align horizontal centers"],
            ["x", "max", AlignHorizontalJustifyEnd, "Align right edges"],
            ["y", "max", AlignVerticalJustifyStart, "Align top edges"],
            ["y", "center", AlignVerticalJustifyCenter, "Align vertical centers"],
            ["y", "min", AlignVerticalJustifyEnd, "Align bottom edges"],
          ] as const).map(([a, op, Icon, label]) => <Button key={label} variant="outline" size="icon" className="h-10 w-full" disabled={selected.length < 2}
            aria-label={label} title={label} onClick={() => commit(arrangeObjects(selected, a, op, reference), `Align objects on ${a.toUpperCase()}`)}><Icon /></Button>)}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-3" role="group" aria-label="Distribute objects">
          {([
            ["x", "centers", AlignHorizontalDistributeCenter, "Distribute horizontal centers"],
            ["y", "centers", AlignVerticalDistributeCenter, "Distribute vertical centers"],
            ["x", "gaps", AlignHorizontalSpaceAround, "Equal horizontal gaps"],
            ["y", "gaps", AlignVerticalSpaceAround, "Equal vertical gaps"],
          ] as const).map(([a, op, Icon, label]) => <Button key={label} variant="outline" size="icon" className="h-10 w-full" disabled={selected.length < 3}
            aria-label={label} title={label} onClick={() => commit(arrangeObjects(selected, a, op), `Distribute ${op} on ${a.toUpperCase()}`)}><Icon /></Button>)}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">Align opening edges or centers. Distribute keeps the two outer objects in place.{selected.length < 3 ? " Select 3 or more to distribute." : ""}</p>
      </> : <>
        <div className="flex items-center justify-between"><span className="font-medium">{mode === "translate" ? "Move offset" : "Rotation offset"} <span className="font-normal text-muted-foreground">· Bin XYZ · {mode === "translate" ? "mm" : "°"}</span></span>
          <Button variant="ghost" size="icon" className={cn("h-8 w-8", snap && "bg-primary/10 text-primary")} aria-label="Snap: 1 mm moves and 5 degree rotations" aria-pressed={snap}
            title={`Snap ${snap ? "on" : "off"}: 1 mm moves / 5° rotations`} onClick={() => setSnap(!snap)}><Magnet className="h-4 w-4" /></Button>
        </div>
        <p className="text-[10px] text-muted-foreground">From as drawn · Set an axis to 0 to restore it.</p>
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">{["X", "Y", "Z"].map((a, i) => <label key={a} className="space-y-1">
            <span className={cn("font-semibold", i === 0 ? "text-red-500" : i === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-blue-500")}>{a}</span>
            <Input aria-label={`${mode === "translate" ? "Move" : "Rotate"} ${a} by`} type="number" step="any" className="h-9 px-2 text-xs tabular-nums" placeholder="Mixed" value={draft[i] ?? actual[i]}
              disabled={!selected.length || (mixed && mode === "rotate" && i < 2)}
              title="Enter or leave the field to apply. Escape cancels."
              onChange={e => { pendingDraft.current = { ...pendingDraft.current, [i]: e.target.value }; setDraft(pendingDraft.current); setError(null); }}
              onBlur={() => applyAxis(i)}
              onKeyDown={e => {
                if (e.key !== "Enter" && e.key !== "Escape") return;
                e.preventDefault(); e.stopPropagation();
                if (e.key === "Escape") { clearDraft(); setError(null); }
                e.currentTarget.blur();
              }} />
          </label>)}</div>
          {mode === "rotate" && selected.length > 1 && <select aria-label="Rotation pivot" className="h-9 w-full rounded-md border bg-background px-2" value={pivot} onChange={e => setPivot(e.target.value as RotationPivot)}>
            <option value="individual">Each object’s center</option><option value="selection">Selection center</option>
          </select>}
        </div>
        {single?.kind === "pocket" && <div className="space-y-1 text-[10px] tabular-nums text-muted-foreground">
          <p data-testid="pocket-3d-transform-readout">{mode === "translate" ? `X ${single.cutout.position.x.toFixed(2)} · Y ${single.cutout.position.y.toFixed(2)} mm`
            : `X ${(single.cutout.tilt?.xDeg ?? 0).toFixed(1)}° · Y ${(single.cutout.tilt?.yDeg ?? 0).toFixed(1)}° · Z ${single.cutout.rotationDeg.toFixed(1)}°`}</p>
          <p data-testid="pocket-3d-depth-readout">{(() => { const depth = pocketVerticalDepthMm(single, editor.spec); return depth === null ? "Depth: through" : `Depth: ${depth.toFixed(2)} mm`; })()}</p>
        </div>}
        <p className="text-[10px] leading-relaxed text-muted-foreground">{mode === "translate" ? "Z changes depth: up is shallower, down is deeper. Openings stay at the surface." : mixed ? "Thumb access stays upright. Select only pockets to tilt around X or Y." : "Drag a colored ring or enter an angle. Esc cancels a drag."}</p>
      </>}
      {!linking && (limited || error) && <p role="status" className="text-[11px] text-destructive">{error ?? "Cannot transform every affected copy. Keep floors within the bin; edit one linked copy if the group needs different design changes."}</p>}
    </div>
  </div>;
  return inspector ? inspector.transforms ? createPortal(content, inspector.transforms) : <></> : content;
}
