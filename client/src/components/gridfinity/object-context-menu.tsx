import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, CopyPlus, Group, Ungroup, Link2, Pencil, Settings2, Trash2, Unlink } from "lucide-react";
import { expandGroupSelection } from "@shared/gridfinity/object-groups";
import { pocketName } from "@shared/gridfinity/cutout";
import { surfaceTextName } from "@shared/gridfinity/surface-text";
import { reviseTracedShape } from "@/lib/gridfinity/contour-edit";
import { getRing, removeRing } from "@/lib/geometry/outline";
import type { BinContextTarget } from "@/lib/gridfinity/context-target";
export type { BinContextTarget } from "@/lib/gridfinity/context-target";
import { createPlacementGroup, selectedPlacementGroup, sameObject, type EditableObject, type ObjectRef } from "@/lib/gridfinity/object-arrangement";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PointerContextMenu, type ContextMenuPoint } from "@/components/ui/pointer-context-menu";
import { SelectionLinkControls } from "./linked-design-controls";
import { useSelectionInspector } from "./selection-inspector-context";
import { useObjectToolbar } from "./object-toolbar-context";

const ObjectMenuContext = createContext<((target: BinContextTarget, point: ContextMenuPoint) => boolean) | null>(null);
export const useBinObjectContextMenu = () => useContext(ObjectMenuContext);

/** Canvas, 3D and list menus share selection, commands, history and capabilities. */
export function BinObjectMenuProvider({ children, onProperties }: {
  children: ReactNode; onProperties: (kind: BinContextTarget["kind"]) => void;
}): JSX.Element {
  const bin = useBin();
  const { shapes, storeShape } = useShapeLibrary();
  const { enabled } = useExperimentalFeatures();
  const inspector = useSelectionInspector();
  const toolbar = useObjectToolbar();
  const [target, setTarget] = useState<BinContextTarget | null>(null);
  const [point, setPoint] = useState<ContextMenuPoint | null>(null);
  const [linking, setLinking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ObjectRef[]>([]);
  const focusBefore = useRef<HTMLElement | null>(null);
  const labels = new Map([
    ...bin.cutouts.map(c => [c.id, pocketName(c, shapes.find(s => s.id === c.shapeId))] as const),
    ...bin.fingerHoles.map((h, i) => [h.id, h.name ?? `Finger access ${i + 1}`] as const),
    ...bin.spec.surfaceTexts.map(label => [label.id, surfaceTextName(label)] as const),
  ]);
  const renameNoun = target?.kind === "pocket"
    ? bin.cutouts.find(c => c.id === target.id)?.role === "hole" ? "hole" : "pocket"
    : target?.kind === "finger" ? "finger access" : "surface text";
  const owner = target?.kind === "hole" ? bin.cutouts.find(c => c.id === target.id) : null;
  const ownerShape = owner ? shapes.find(shape => shape.id === owner.shapeId) : null;
  const exists = !!target && labels.has(target.id) && (target.kind !== "hole" || owner?.shapeId === target.shapeId && !!ownerShape && !!getRing(ownerShape.outlineMm, target.ref));
  const refs = scope.filter(ref => (ref.kind === "pocket" ? bin.cutouts : bin.fingerHoles).some(item => item.id === ref.id));
  const selected = [...bin.cutouts, ...bin.fingerHoles].filter(item => refs.some(ref => ref.id === item.id));
  const title = target?.kind === "hole" ? `Hole ${target.ref.ringIndex + 1} · ${labels.get(target.id) ?? "Pocket"}` : refs.length > 1 ? `${refs.length} selected objects` : target ? labels.get(target.id) ?? "Object" : "Object";
  const close = () => { setPoint(null); };
  useEffect(() => { if (!exists) { setPoint(null); setRenaming(false); setLinking(false); } }, [exists]);
  useEffect(() => { if (!enabled) setLinking(false); }, [enabled]);
  const open = (next: BinContextTarget, position: ContextMenuPoint) => {
    if (bin.editorMode !== "placement" || !labels.has(next.id)) return false;
    focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (next.kind === "text") {
      bin.dispatch({ type: "SELECT_SURFACE_TEXT", id: next.id }); setScope([]);
    } else {
      const ref: ObjectRef = next.kind === "hole" ? { kind: "pocket", id: next.id } : next;
      const selected = expandGroupSelection(bin, next.kind !== "hole" && bin.selection.some(item => sameObject(item, ref)) ? bin.selection : [ref]);
      if (next.kind === "hole" || !bin.selection.some(item => sameObject(item, ref))) bin.dispatch({ type: "SET_SELECTION", selection: selected });
      setScope(next.kind === "hole" ? [] : selected);
    }
    setTarget(next); setPoint(position); return true;
  };
  const restoreFocus = () => { focusBefore.current?.focus(); };
  const properties = () => {
    if (!target) return;
    (inspector ?? toolbar)?.setTool("properties");
    inspector?.openInspector();
    onProperties(target.kind);
  };
  const duplicate = () => {
    if (target?.kind === "text") {
      const original = bin.spec.surfaceTexts.find(label => label.id === target.id);
      if (!original || bin.spec.surfaceTexts.length >= 32) return;
      const base = surfaceTextName(original).replace(/ \(copy(?: \d+)?\)$/, "");
      let number = 1, copyName = `${base} (copy)`;
      while ([...labels.values()].includes(copyName)) copyName = `${base} (copy ${++number})`;
      const offset = (value: number, delta: number) => Math.abs(value + delta) <= 672 ? value + delta : value - delta;
      const copy = { ...original, id: crypto.randomUUID(), name: copyName, position: { x: offset(original.position.x, 10), y: offset(original.position.y, -10) } };
      bin.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [...bin.spec.surfaceTexts, copy] }, historyLabel: "Duplicate surface text" });
      bin.dispatch({ type: "SELECT_SURFACE_TEXT", id: copy.id });
    } else bin.dispatch({ type: "DUPLICATE_SELECTION", labels, ids: refs.map(source => ({ source, id: crypto.randomUUID() })) });
  };
  const remove = () => {
    if (target?.kind === "hole" && owner && ownerShape && exists) {
      const revision = reviseTracedShape(ownerShape, removeRing(ownerShape.outlineMm, target.ref), crypto.randomUUID());
      storeShape(revision);
      bin.dispatch({ type: "UPDATE_CUTOUT", id: owner.id, patch: { shapeId: revision.id }, historyLabel: "Remove pocket hole" });
    } else if (target?.kind === "text") bin.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: bin.spec.surfaceTexts.filter(label => label.id !== target.id) }, historyLabel: "Remove surface text" });
    else if (refs.length === 1 && refs[0].kind === "pocket") bin.dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: refs[0].id });
    else bin.dispatch({ type: "REMOVE_SELECTION" });
  };
  const rename = () => {
    if (!target || target.kind === "hole" || !name.trim() || !exists) return;
    if (target.kind === "text") bin.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: bin.spec.surfaceTexts.map(label => label.id === target.id ? { ...label, name: name.trim() } : label) }, historyLabel: "Rename surface text" });
    else if (target.kind === "pocket") bin.dispatch({ type: "UPDATE_CUTOUT", id: target.id, patch: { name: name.trim() }, historyLabel: `Rename ${renameNoun}` });
    else bin.dispatch({ type: "UPDATE_FINGER_HOLE", id: target.id, patch: { name: name.trim() }, historyLabel: "Rename finger access" });
    setRenaming(false);
  };
  const canLink = (["pocket", "finger"] as const).some(kind => {
    const items = (kind === "pocket" ? bin.cutouts : bin.fingerHoles).filter(item => refs.some(ref => ref.kind === kind && ref.id === item.id));
    return items.length > 1 && (!items[0].designLink || items.some(item => item.designLink?.id !== items[0].designLink?.id));
  });
  const groupObjects = refs.flatMap<EditableObject>(ref => {
    if (ref.kind === "finger") { const hole = bin.fingerHoles.find(h => h.id === ref.id); return hole ? [{ kind: "finger", hole }] : []; }
    const cutout = bin.cutouts.find(c => c.id === ref.id), shape = shapes.find(s => s.id === cutout?.shapeId);
    return cutout && shape ? [{ kind: "pocket", cutout, shape }] : [];
  });
  const canGroup = refs.length > 1 && groupObjects.length === refs.length && !selectedPlacementGroup(groupObjects);
  const itemClass = "min-h-9 gap-2";
  return <ObjectMenuContext.Provider value={open}>
    {children}
    <PointerContextMenu point={exists ? point : null} title={title} onClose={close} onRestoreFocus={() => { if (!linking && !renaming) restoreFocus(); }}>
      <DropdownMenuItem className={itemClass} onSelect={properties}><Settings2 className="h-4 w-4" />{target?.kind === "hole" ? "Pocket properties" : "Properties"}</DropdownMenuItem>
      {target?.kind !== "hole" && <DropdownMenuItem className={itemClass} disabled={target?.kind === "text" && bin.spec.surfaceTexts.length >= 32} onSelect={duplicate}><Copy className="h-4 w-4" />Duplicate{refs.length > 1 ? ` ${refs.length} objects` : ""}</DropdownMenuItem>}
      {target?.kind !== "hole" && refs.length <= 1 && <DropdownMenuItem className={itemClass} onSelect={() => { setName(target ? labels.get(target.id) ?? "" : ""); setRenaming(true); }}><Pencil className="h-4 w-4" />Rename…</DropdownMenuItem>}
      {refs.length > 1 && <>
        <DropdownMenuSeparator />
        {canGroup && <DropdownMenuItem className={itemClass} onSelect={() => bin.dispatch({ type: "GROUP_SELECTION", group: createPlacementGroup(groupObjects, bin.spec, crypto.randomUUID()) })}><Group className="h-4 w-4" />Group objects</DropdownMenuItem>}
        {selected.some(item => item.placementGroup) && <DropdownMenuItem className={itemClass} onSelect={() => bin.dispatch({ type: "UNGROUP_SELECTION" })}><Ungroup className="h-4 w-4" />Ungroup</DropdownMenuItem>}
      </>}
      {enabled && target?.kind !== "text" && target?.kind !== "hole" && (refs.length === 1 || canLink || selected.some(item => item.designLink)) && <>
        <DropdownMenuSeparator />
        {refs.length === 1 && <DropdownMenuItem className={itemClass} onSelect={() => bin.dispatch({ type: "DUPLICATE_LINKED", kind: refs[0].kind, id: refs[0].id, newId: crypto.randomUUID(), linkId: crypto.randomUUID(), labels })}><CopyPlus className="h-4 w-4" />Duplicate linked</DropdownMenuItem>}
        {canLink && <DropdownMenuItem className={itemClass} onSelect={() => setLinking(true)}><Link2 className="h-4 w-4" />Link geometry…</DropdownMenuItem>}
        {selected.some(item => item.designLink) && <DropdownMenuItem className={itemClass} onSelect={() => bin.dispatch({ type: "UNLINK_DESIGNS", kind: "selection", ids: refs.map(ref => ref.id) })}><Unlink className="h-4 w-4" />Unlink geometry</DropdownMenuItem>}
        {refs.length === 1 && selected[0]?.designLink && <DropdownMenuItem className={itemClass} onSelect={() => {
          const group = selected[0].designLink!.id;
          const members = refs[0].kind === "pocket" ? bin.cutouts : bin.fingerHoles;
          bin.dispatch({ type: "SET_SELECTION", selection: members.filter(item => item.designLink?.id === group).map(item => ({ kind: refs[0].kind, id: item.id })) });
        }}>Select linked copies</DropdownMenuItem>}
      </>}
      <DropdownMenuSeparator />
      <DropdownMenuItem className={`${itemClass} text-destructive focus:text-destructive`} disabled={target?.kind === "hole" && !!owner?.designLink && !enabled} onSelect={remove}><Trash2 className="h-4 w-4" />{target?.kind === "hole" ? "Remove hole" : refs.length > 1 ? "Remove selected" : "Remove"}</DropdownMenuItem>
    </PointerContextMenu>
    <Dialog open={linking} onOpenChange={setLinking}><DialogContent onCloseAutoFocus={restoreFocus}>
      <DialogHeader><DialogTitle>Linked geometry</DialogTitle><DialogDescription>Choose the shared geometry. Position, elevation and rotation stay independent. Group objects to move them together.</DialogDescription></DialogHeader>
      <SelectionLinkControls />
      <DialogFooter><Button variant="outline" onClick={() => setLinking(false)}>Done</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={renaming} onOpenChange={setRenaming}><DialogContent onCloseAutoFocus={restoreFocus}>
      <form onSubmit={event => { event.preventDefault(); rename(); }} className="space-y-4">
        <DialogHeader><DialogTitle>Rename {renameNoun}</DialogTitle><DialogDescription>Names apply to this copy only.</DialogDescription></DialogHeader>
        <Input aria-label="Object name" value={name} onChange={event => setName(event.target.value)} />
        <DialogFooter><Button type="button" variant="outline" onClick={() => setRenaming(false)}>Cancel</Button><Button type="submit" disabled={!name.trim()}>Save name</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </ObjectMenuContext.Provider>;
}
