import { useEffect, useRef, useState } from "react";
import { pocketName, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { pocketInsertionAxis, pocketInsertionError } from "@shared/gridfinity/pocket-insertion";
import { rigidPocket } from "@shared/gridfinity/rigid-pocket";
import { expandLinkedObjectEdits, type EditableObject } from "@/lib/gridfinity/object-arrangement";
import { useBin, type BinStore } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type ClearanceChoice = { mode: "none" | "axis" | "vertical"; axis: "x" | "y" | "z" };
type Prompt = NonNullable<BinStore["pendingPocketClearance"]>;
interface ClearanceGroup { key: string; representative: CutoutPlacement; members: CutoutPlacement[] }

/** One prompt for a committed rotation, even when several linked copies move. */
export function PocketClearanceDialog(): JSX.Element | null {
  const bin = useBin();
  const { shapes } = useShapeLibrary();
  const lastOutsideFocus = useRef<HTMLElement | null>(null);
  // Enter blurs a numeric field before React mounts this automatic dialog, so
  // remember focus before that blur instead of relying on a DialogTrigger.
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target !== document.body && !target.closest('[role="dialog"]')) lastOutsideFocus.current = target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  const prompt = bin.pendingPocketClearance;
  if (!prompt || prompt.checkpoint !== bin.history || !prompt.cutoutIds.some(id => bin.cutouts.some(cutout => cutout.id === id))) return null;
  return <ClearanceChoices bin={bin} prompt={prompt} shapes={shapes} returnFocus={lastOutsideFocus.current} />;
}

function ClearanceChoices({ bin, prompt, shapes, returnFocus }: {
  bin: BinStore; prompt: Prompt; shapes: ReturnType<typeof useShapeLibrary>["shapes"]; returnFocus: HTMLElement | null;
}): JSX.Element {
  const { setEnabled: setExperimentalEnabled } = useExperimentalFeatures();
  const focusTarget = useRef(returnFocus);
  const shapeMap = new Map(shapes.map(shape => [shape.id, shape]));
  const groups: ClearanceGroup[] = [];
  for (const id of prompt.cutoutIds) {
    const cutout = bin.cutouts.find(item => item.id === id);
    if (!cutout) continue;
    const key = cutout.designLink ? `linked:${cutout.designLink.id}` : `pocket:${id}`;
    if (groups.some(group => group.key === key)) continue;
    groups.push({ key, representative: cutout, members: cutout.designLink
      ? bin.cutouts.filter(item => item.designLink?.id === cutout.designLink!.id) : [cutout] });
  }
  const defaults = Object.fromEntries(groups.map(group => [group.key, {
    mode: group.representative.insertionMode ?? "none", axis: group.representative.insertionAxis ?? "z",
  }])) as Record<string, ClearanceChoice>;
  // A later committed rotation can replace a still-open prompt without an
  // intermediate unmount. Never carry its draft choices to the new checkpoint.
  const [draft, setDraft] = useState({ checkpoint: prompt.checkpoint, choices: defaults });
  const draftChoices = draft.checkpoint === prompt.checkpoint ? draft.choices : defaults;
  const choices = Object.fromEntries(groups.map(group => [group.key,
    group.representative.designLink && !bin.experimentalEditing ? defaults[group.key] : draftChoices[group.key],
  ])) as Record<string, ClearanceChoice>;
  const change = (key: string, patch: Partial<ClearanceChoice>) => setDraft({
    checkpoint: prompt.checkpoint, choices: { ...choices, [key]: { ...choices[key], ...patch } },
  });
  const name = (cutout: CutoutPlacement) => pocketName(cutout, shapeMap.get(cutout.shapeId));
  const missing = groups.flatMap(group => group.members).filter(cutout => !shapeMap.has(cutout.shapeId));
  const objects: EditableObject[] = bin.cutouts.flatMap(cutout => {
    const shape = shapeMap.get(cutout.shapeId);
    return shape ? [{ kind: "pocket" as const, cutout, shape }] : [];
  });
  const edits = missing.length ? null : expandLinkedObjectEdits(objects, bin.spec, {
    cutouts: groups.map(group => {
      const original = group.representative, choice = choices[group.key];
      const base = choice.mode === "none" ? original : rigidPocket(original, shapeMap.get(original.shapeId)!, bin.spec);
      return { ...base, insertionMode: choice.mode === "none" ? undefined : choice.mode,
        insertionAxis: choice.axis === (original.insertionAxis ?? "z") ? original.insertionAxis : choice.axis };
    }), fingerHoles: [],
  });
  const proposed = new Map(edits?.cutouts.map(cutout => [cutout.id, cutout]));
  const invalid = groups.flatMap(group => group.members).flatMap(member => {
    const cutout = proposed.get(member.id);
    const error = cutout && pocketInsertionError(cutout);
    return error ? [{ id: member.id, message: `${name(member)}: ${error}` }] : [];
  });
  const dismiss = () => bin.dispatch({ type: "DISMISS_POCKET_CLEARANCE", checkpoint: prompt.checkpoint });
  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
    <DialogContent className="sm:max-w-lg" data-testid="pocket-clearance-dialog"
      onOpenAutoFocus={() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && !active.closest('[role="dialog"]')) focusTarget.current = active;
      }}
      onCloseAutoFocus={event => {
        if (focusTarget.current?.isConnected) { event.preventDefault(); focusTarget.current.focus({ preventScroll: true }); }
      }}>
      <DialogHeader>
        <DialogTitle>Choose clearance after rotation</DialogTitle>
        <DialogDescription>Your rotation is applied. Choose how the object reaches the bin top. You can change these settings later in its properties.</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 space-y-3">
        {groups.map(group => {
          const choice = choices[group.key], hole = group.representative.role === "hole";
          const locked = !!group.representative.designLink && !bin.experimentalEditing;
          const angles = group.members.map(member => pocketInsertionAxis({ ...member, insertionMode: "axis", insertionAxis: choice.axis }).z)
            .map(z => Math.acos(Math.min(1, Math.max(0, z))) * 180 / Math.PI);
          const minimum = Math.min(...angles).toFixed(1), maximum = Math.max(...angles).toFixed(1);
          return <fieldset key={group.key} className="min-w-0 space-y-2 rounded-md border p-3" data-testid="clearance-design-choice">
            <legend className="max-w-full px-1 text-sm font-medium [overflow-wrap:anywhere]">{name(group.representative)}</legend>
            {group.members.length > 1 && <p className="text-xs text-muted-foreground">Applies to {group.members.length} linked copies.</p>}
            {locked && <div className="text-xs">
              <p className="text-muted-foreground">Shared clearance settings require experimental tools. Placement stays independent.</p>
              <Button variant="link" className="h-auto whitespace-normal px-0 text-xs" onClick={() => setExperimentalEnabled(true)}>Enable experimental tools</Button>
            </div>}
            <Label className="block space-y-1 text-xs">
              <span>{hole ? "Kept-volume extension" : "Clearance style"}</span>
              <select className="h-9 min-w-0 w-full rounded-md border bg-background px-2" aria-label={`${hole ? "Extension" : "Clearance"} style for ${name(group.representative)}`}
                disabled={locked} value={choice.mode} onChange={event => change(group.key, { mode: event.target.value as ClearanceChoice["mode"] })}>
                <option value="none">{hole ? "No extra extension" : "No extra clearance"}</option>
                <option value="axis">{hole ? "Follow object angle" : "Follow pocket angle"}</option>
                <option value="vertical">{hole ? "Vertical projection" : "Vertical drop-in"}</option>
              </select>
            </Label>
            {choice.mode === "axis" && <>
              <Label className="block space-y-1 text-xs">
                <span>{hole ? "Extension axis (object)" : "Insertion axis (object)"}</span>
                <select className="h-9 min-w-0 w-full rounded-md border bg-background px-2" aria-label={`${hole ? "Extension" : "Insertion"} axis for ${name(group.representative)}`}
                  disabled={locked} value={choice.axis} onChange={event => change(group.key, { axis: event.target.value as ClearanceChoice["axis"] })}>
                  <option value="x">X — width</option><option value="y">Y — length</option><option value="z">Z — thickness</option>
                </select>
              </Label>
              <p className="text-xs text-muted-foreground">Moves with the object and points toward the bin top. {minimum === maximum ? minimum : `${minimum}–${maximum}`}° from vertical{group.members.length > 1 ? " across linked copies" : ""}.</p>
            </>}
            <p className="text-xs text-muted-foreground">{hole ? "Extension protects material up to the fill surface. No extra extension keeps only the original volume." : "Follow the chosen object axis, clear a vertical drop-in path, or keep only the original pocket volume."}</p>
            {invalid.filter(issue => group.members.some(member => member.id === issue.id)).map(issue => <p key={issue.id} role="alert" className="text-xs text-destructive">{issue.message}</p>)}
          </fieldset>;
        })}
        {!edits && <p role="alert" className="text-sm text-destructive">{missing.length
          ? `The source outline is unavailable for ${missing.map(name).join(", ")}. Keep the current settings and restore the outline before changing clearance.`
          : "Cannot apply clearance to every linked copy. Keep the current settings and edit the copies individually."}</p>}
      </div>
      {bin.editError && <p role="alert" className="text-sm text-destructive">{bin.editError}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={dismiss}>Keep current settings</Button>
        <Button disabled={!edits || !groups.length || invalid.length > 0} onClick={() => {
          if (edits && !invalid.length) bin.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint: prompt.checkpoint, edits });
        }}>Apply clearance</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
