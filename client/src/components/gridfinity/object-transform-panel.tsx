import { useEffect, useState } from "react";
import { Quaternion, Vector3 } from "three";
import { CheckSquare2, ChevronDown, Magnet, Move3D, Rotate3D, AlignHorizontalJustifyCenter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pocketName } from "@shared/gridfinity/cutout";
import { pocketVerticalDepthMm, type PocketTransformMode } from "@/lib/gridfinity/pocket-transform";
import { arrangeObjects, objectEditsChanged, objectKey, objectRef, selectionBounds, transformObjects,
  type EditableObject, type ObjectEdits, type RotationPivot } from "@/lib/gridfinity/object-arrangement";
import type { PocketEditor } from "./pocket-transform-scene";

const label = (o: EditableObject, index: number) => o.kind === "pocket" ? pocketName(o.cutout, o.shape) : o.hole.name ?? `Thumb access ${index + 1}`;
export function commitEditorObjects(editor: PocketEditor, edits: ObjectEdits, text: string, mode: PocketTransformMode): void {
  if (editor.onCommitObjects) editor.onCommitObjects(edits, text);
  else edits.cutouts.forEach(cutout => editor.onCommit(cutout.id, cutout, mode));
}

/** The same relative XYZ values work for a single object and mixed selections.
 * Each explicit Apply or arrangement command is one document transaction. */
export function ObjectTransformPanel({ editor, objects, selected, displayed, mode, setMode, snap, setSnap,
  pivot, setPivot, limited }: {
  editor: PocketEditor; objects: readonly EditableObject[]; selected: readonly EditableObject[]; displayed: readonly EditableObject[];
  mode: PocketTransformMode; setMode: (mode: PocketTransformMode) => void; snap: boolean; setSnap: (value: boolean) => void;
  pivot: RotationPivot; setPivot: (pivot: RotationPivot) => void; limited: boolean;
}): JSX.Element {
  const [arranging, setArranging] = useState(false);
  const [values, setValues] = useState(["0", "0", "0"]);
  const [error, setError] = useState<string | null>(null);
  const [axis, setAxis] = useState<"x" | "y">("x");
  const [reference, setReference] = useState<"selection" | "active">("selection");
  const key = JSON.stringify(selected.map(o => objectKey(objectRef(o))));
  useEffect(() => { setValues(["0", "0", "0"]); setError(null); setArranging(false); }, [key, mode]);
  const select = (next: EditableObject[]) => {
    if (editor.onSelectionChange) editor.onSelectionChange(next.map(objectRef));
    else editor.onSelect(next.at(-1)?.kind === "pocket" ? objectRef(next.at(-1)!).id : null);
  };
  const isSelected = (o: EditableObject) => selected.some(s => objectKey(objectRef(s)) === objectKey(objectRef(o)));
  const commit = (edits: ObjectEdits | null, text: string) => {
    if (!edits) { setError(arranging ? "There is not enough room for equal gaps between the outer objects." : "Cannot transform every affected copy. Check depth and tilt limits; try editing one linked copy."); return; }
    setError(null);
    if (objectEditsChanged(selected, edits)) commitEditorObjects(editor, edits, text, mode);
    setValues(["0", "0", "0"]);
  };
  const apply = () => {
    const numbers = values.map(v => v.trim() ? Number(v) : NaN);
    if (!numbers.every(Number.isFinite)) { setError("Enter a finite number for each axis."); return; }
    if (mode === "translate") commit(transformObjects(selected, editor.spec, new Vector3(...numbers), undefined, "individual", objects), `Move ${selected.length} object${selected.length === 1 ? "" : "s"}`);
    else {
      // UI fields are successive rotations about fixed world axes, X then Y then Z.
      const rotation = new Quaternion();
      numbers.forEach((v, i) => rotation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(...[0, 1, 2].map(n => n === i ? 1 : 0)), v * Math.PI / 180)));
      commit(transformObjects(selected, editor.spec, new Vector3(), rotation, pivot, objects), `Rotate ${selected.length} object${selected.length === 1 ? "" : "s"}`);
    }
  };
  const mixed = selected.some(o => o.kind === "finger");
  const single = displayed.length === 1 ? displayed[0] : null;
  return <div className="absolute left-3 top-16 z-20 max-h-[calc(100%-5rem)] w-64 max-w-[calc(100%-5rem)] overflow-y-auto rounded-xl border bg-background/95 text-xs shadow-lg backdrop-blur-md md:top-12" data-testid="pocket-3d-controls">
    <details className="group border-b" open={selected.length === 0 || undefined}>
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
          {objects.map((o, i) => <label key={objectKey(objectRef(o))} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-accent">
            <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select ${label(o, i)}`} checked={isSelected(o)}
              onChange={() => select(isSelected(o) ? selected.filter(s => objectKey(objectRef(s)) !== objectKey(objectRef(o))) : [...selected, o])} />
            <span className="truncate">{label(o, i)}</span>
          </label>)}
        </div>
        <p className="px-2 pt-1 text-[10px] text-muted-foreground">Shift / ⌘ / Ctrl + click to add or remove.</p>
      </div>
    </details>
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Object tools">
        {(["translate", "rotate", "arrange"] as const).map(tool => <button key={tool} type="button"
          className={cn("flex min-h-9 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors", (tool === "arrange" ? arranging : !arranging && mode === tool) ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          aria-label={tool === "translate" ? "Move pocket (W)" : tool === "rotate" ? "Rotate pocket (E)" : "Align and distribute objects"}
          aria-pressed={tool === "arrange" ? arranging : !arranging && mode === tool}
          onClick={() => { setError(null); setArranging(tool === "arrange"); if (tool !== "arrange") setMode(tool); else if (selected.length) { const b = selectionBounds(selected); setAxis(b.maxX - b.minX >= b.maxY - b.minY ? "x" : "y"); } }}>
          {tool === "translate" ? <Move3D className="h-4 w-4" /> : tool === "rotate" ? <Rotate3D className="h-4 w-4" /> : <AlignHorizontalJustifyCenter className="h-4 w-4" />}
          {tool === "translate" ? "Move" : tool === "rotate" ? "Rotate" : "Arrange"}
        </button>)}
      </div>
      {arranging ? <>
        <div className="flex gap-2">
          <select aria-label="Arrangement axis" className="h-9 rounded-md border bg-background px-2" value={axis} onChange={e => setAxis(e.target.value as "x" | "y")}>
            <option value="x">X axis</option><option value="y">Y axis</option>
          </select>
          <select aria-label="Align relative to" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2" value={reference} onChange={e => setReference(e.target.value as "selection" | "active")}>
            <option value="selection">Selection bounds</option><option value="active">Last selected</option>
          </select>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["min", "center", "max"] as const).map(op => <Button key={op} variant="outline" size="sm" className="px-1 text-[11px]" disabled={selected.length < 2}
            aria-label={`Align ${axis.toUpperCase()} ${op === "center" ? "centers" : op === "min" ? "minimum edges" : "maximum edges"}`}
            onClick={() => commit(arrangeObjects(selected, axis, op, reference), `Align objects on ${axis.toUpperCase()}`)}>
            {op === "center" ? "Center" : axis === "x" ? op === "min" ? "Left edge" : "Right edge" : op === "min" ? "Front edge" : "Back edge"}
          </Button>)}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <Button variant="outline" size="sm" className="text-[11px]" disabled={selected.length < 3} onClick={() => commit(arrangeObjects(selected, axis, "centers"), `Distribute centers on ${axis.toUpperCase()}`)}>Equal centers</Button>
          <Button variant="outline" size="sm" className="text-[11px]" disabled={selected.length < 3} onClick={() => commit(arrangeObjects(selected, axis, "gaps"), `Distribute gaps on ${axis.toUpperCase()}`)}>Equal gaps</Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">Align opening edges or centers. Distribute keeps the two outer objects in place.{selected.length < 3 ? " Select 3 or more to distribute." : ""}</p>
      </> : <>
        <div className="flex items-center justify-between"><span className="font-medium">{mode === "translate" ? "Move by" : "Rotate by"} <span className="font-normal text-muted-foreground">· Bin XYZ</span></span>
          <Button variant="ghost" size="sm" className={cn("h-7 gap-1 px-2 text-[10px]", snap && "bg-primary/10 text-primary")} aria-label="Snap: 1 mm moves and 5 degree rotations" aria-pressed={snap}
            title={`Snap ${snap ? "on" : "off"}: 1 mm moves / 5° rotations`} onClick={() => setSnap(!snap)}><Magnet className="h-3.5 w-3.5" />{snap ? "Snap on" : "Snap off"}</Button>
        </div>
        <form onSubmit={e => { e.preventDefault(); apply(); }} className="space-y-2">
          <div className="grid grid-cols-3 gap-2">{["X", "Y", "Z"].map((a, i) => <label key={a} className="space-y-1">
            <span className={cn("font-semibold", i === 0 ? "text-red-500" : i === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-blue-500")}>{a}</span>
            <Input aria-label={`${mode === "translate" ? "Move" : "Rotate"} ${a} by`} type="number" step="any" className="h-9 px-2 text-xs tabular-nums" value={values[i]}
              disabled={!selected.length || (mixed && mode === "rotate" && i < 2)} onChange={e => setValues(values.map((v, n) => n === i ? e.target.value : v))} />
          </label>)}</div>
          {mode === "rotate" && selected.length > 1 && <select aria-label="Rotation pivot" className="h-9 w-full rounded-md border bg-background px-2" value={pivot} onChange={e => setPivot(e.target.value as RotationPivot)}>
            <option value="individual">Each object’s center</option><option value="selection">Selection center</option>
          </select>}
          <Button type="submit" size="sm" className="w-full" disabled={!selected.length}>Apply {mode === "translate" ? "move · mm" : "rotation · °"}</Button>
        </form>
        {single?.kind === "pocket" && <div className="space-y-1 text-[10px] tabular-nums text-muted-foreground">
          <p data-testid="pocket-3d-transform-readout">{mode === "translate" ? `X ${single.cutout.position.x.toFixed(2)} · Y ${single.cutout.position.y.toFixed(2)} mm`
            : `X ${(single.cutout.tilt?.xDeg ?? 0).toFixed(1)}° · Y ${(single.cutout.tilt?.yDeg ?? 0).toFixed(1)}° · Z ${single.cutout.rotationDeg.toFixed(1)}°`}</p>
          <p data-testid="pocket-3d-depth-readout">{(() => { const depth = pocketVerticalDepthMm(single, editor.spec); return depth === null ? "Depth: through" : `Depth: ${depth.toFixed(2)} mm`; })()}</p>
        </div>}
        <p className="text-[10px] leading-relaxed text-muted-foreground">{mode === "translate" ? "Z changes depth: up is shallower, down is deeper. Openings stay at the surface." : mixed ? "Thumb access stays upright. Select only pockets to tilt around X or Y." : "Drag a colored ring or enter an angle. Esc cancels a drag."}</p>
      </>}
      {(limited || error) && <p role="status" className="text-[11px] text-destructive">{error ?? "Cannot transform every affected copy. Keep floors within the bin; edit one linked copy if the group needs different design changes."}</p>}
    </div>
  </div>;
}
