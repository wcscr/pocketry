import { Line, TransformControls } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementRef } from "react";
import { DoubleSide, Object3D, Quaternion, Vector3 } from "three";
import type { CutoutPlacement, FingerHole } from "@shared/gridfinity/cutout";
import { effectiveFingerHoleDepthMm, resolvePocketDepth } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import {
  pocketTransformWires,
  type EditablePocket, type PocketTransformMode, type PocketTransformPatch,
} from "@/lib/gridfinity/pocket-transform";

import { styleTransformGizmo } from "@/lib/gridfinity/transform-gizmo-style";
import { applyObjectEdits, objectEditsChanged, objectOutline, pickObject, selectionCenter, transformObjects,
  type EditableObject, type ObjectRef, type ObjectEdits, type RotationPivot } from "@/lib/gridfinity/object-arrangement";

export interface PocketEditor {
  spec: BinSpec;
  pockets: readonly EditablePocket[];
  selectedId: string | null;
  fingerHoles?: readonly FingerHole[];
  selection?: readonly ObjectRef[];
  onSelectionChange?: (selection: ObjectRef[]) => void;
  onCommitObjects?: (edits: ObjectEdits, label: string) => void;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: PocketTransformPatch, mode: PocketTransformMode) => void;
}

export function PocketSelectionPlane({ editor, width, length, disabled }: {
  editor: PocketEditor; width: number; length: number; disabled: boolean;
}): JSX.Element {
  const z = resolvePocketDepth(editor.spec, { mode: "through" }).infillTopZ;
  const objects: EditableObject[] = [...editor.pockets.map(p => ({ ...p, kind: "pocket" as const })),
    ...(editor.fingerHoles ?? []).map(hole => ({ kind: "finger" as const, hole }))];
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (disabled || event.button !== 0 || event.delta > 4) return;
    const ref = pickObject(objects, event.point);
    event.stopPropagation();
    if (!editor.onSelectionChange) { editor.onSelect(ref?.kind === "pocket" ? ref.id : null); return; }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const selection = editor.selection ?? [];
    const contains = ref && selection.some(r => r.kind === ref.kind && r.id === ref.id);
    editor.onSelectionChange(ref ? additive ? contains ? selection.filter(r => r.kind !== ref.kind || r.id !== ref.id) : [...selection, ref] : [ref]
      : additive ? [...selection] : []);
  };
  return <mesh position={[0, 0, z + 0.01]} onClick={select}>
    <planeGeometry args={[width, length]} />
    <meshBasicMaterial side={DoubleSide} transparent opacity={0} depthWrite={false} colorWrite={false} />
  </mesh>;
}

/** The gesture stays local until release: cancel, selection changes, navigation,
 * and undo cannot accidentally persist a half-dragged pocket. */
export function PocketTransformScene({ pocket, spec, mode, snap, onPreview, onCommit, onLimit }: {
  pocket: EditablePocket; spec: BinSpec; mode: PocketTransformMode;
  snap: boolean;
  onPreview: (cutout: CutoutPlacement | null) => void;
  onCommit: PocketEditor["onCommit"];
  onLimit: (limited: boolean) => void;
}): JSX.Element {
  const objects = useMemo<EditableObject[]>(() => [{ kind: "pocket", ...pocket }], [pocket.cutout, pocket.shape]);
  return <SelectionTransformScene objects={objects} spec={spec} mode={mode} snap={snap} pivot="individual"
    onPreview={edits => onPreview(edits?.cutouts[0] ?? null)} onLimit={onLimit}
    onCommit={edits => { const cutout = edits.cutouts[0]; if (cutout) onCommit(cutout.id, cutout, mode); }} />;
}

export function SelectionTransformScene({ objects, spec, mode, snap, pivot, onPreview, onCommit, onLimit }: {
  objects: readonly EditableObject[]; spec: BinSpec; mode: PocketTransformMode; snap: boolean; pivot: RotationPivot;
  onPreview: (edits: ObjectEdits | null) => void; onCommit: (edits: ObjectEdits) => void; onLimit: (limited: boolean) => void;
}): JSX.Element {
  const object = useMemo(() => new Object3D(), []);
  const [controlEpoch, setControlEpoch] = useState(0);
  const controls = useRef<ElementRef<typeof TransformControls> | null>(null);
  // This Drei version leaves externally managed primitives undisposed.
  // Release DOM listeners and GPU resources on cancel, mode/selection changes.
  const restoreHandles = useRef<() => void>(() => {});
  const attachControls = useCallback((next: ElementRef<typeof TransformControls> | null) => {
    if (controls.current === next) return;
    restoreHandles.current();
    controls.current?.dispose();
    controls.current = next;
    restoreHandles.current = next ? styleTransformGizmo(next) : () => {};
  }, []);
  const orbit = useThree(state => state.controls) as unknown as { enabled: boolean } | null;
  const gesture = useRef<{ original: readonly EditableObject[]; patch: ObjectEdits | null } | null>(null);
  const callbacks = useRef({ onPreview, onCommit, onLimit });
  callbacks.current = { onPreview, onCommit, onLimit };
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  const place = useCallback((items: readonly EditableObject[]) => {
    const center = selectionCenter(items);
    object.position.set(center.x, center.y, top);
    object.quaternion.identity();
    object.updateMatrixWorld();
  }, [object, top]);
  useLayoutEffect(() => { if (!gesture.current) place(objects); }, [place, objects]);
  const cancel = useCallback(() => {
    const original = gesture.current?.original;
    gesture.current = null;
    if (original) { controls.current?.reset(); setControlEpoch(epoch => epoch + 1); }
    if (original) place(original);
    if (original && orbit) orbit.enabled = true;
    callbacks.current.onPreview(null);
    callbacks.current.onLimit(false);
  }, [place, orbit]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointercancel", cancel);
      cancel();
    };
  }, [cancel]);
  // A replaced document/undo/selection ends any local gesture without committing it.
  useEffect(() => { cancel(); place(objects); }, [objects, spec, pivot, cancel, place]);
  const change = () => {
    const drag = gesture.current;
    if (!drag) return;
    const center = selectionCenter(drag.original);
    const delta = mode === "translate" ? object.position.clone().sub(new Vector3(center.x, center.y, top)) : new Vector3();
    const patch = transformObjects(drag.original, spec, delta, mode === "rotate" ? object.quaternion : new Quaternion(), pivot);
    if (!patch) {
      place(drag.patch ? applyObjectEdits(drag.original, drag.patch) : drag.original);
      callbacks.current.onLimit(true);
      return;
    }
    // TransformControls recomputes each sample from its pointer-down pose.
    // Reset the proxy after reading that delta so even mid-drag its visible
    // handles stay on the surface and aligned to the fixed bin axes.
    place(applyObjectEdits(drag.original, patch));
    drag.patch = patch;
    callbacks.current.onLimit(false);
    callbacks.current.onPreview(patch);
  };
  const finish = () => {
    const drag = gesture.current;
    gesture.current = null;
    if (drag?.patch && objectEditsChanged(drag.original, drag.patch)) {
      place(applyObjectEdits(drag.original, drag.patch));
      callbacks.current.onCommit(drag.patch);
    } else if (drag) place(drag.original);
    callbacks.current.onPreview(null);
    callbacks.current.onLimit(false);
  };
  return <>
    <primitive object={object} />
    <TransformControls key={controlEpoch} ref={attachControls} object={object} mode={mode} space="world" size={0.95}
      showX={mode !== "rotate" || objects.every(o => o.kind === "pocket")} showY={mode !== "rotate" || objects.every(o => o.kind === "pocket")}
      translationSnap={snap ? 1 : null} rotationSnap={snap ? Math.PI / 36 : null}
      onMouseDown={() => { gesture.current = { original: objects, patch: null }; callbacks.current.onPreview({ cutouts: objects.flatMap(o => o.kind === "pocket" ? [o.cutout] : []), fingerHoles: objects.flatMap(o => o.kind === "finger" ? [o.hole] : []) }); }}
      onObjectChange={change} onMouseUp={finish} />
  </>;
}

export function PocketTransformWire({ pocket, spec }: { pocket: EditablePocket; spec: BinSpec }): JSX.Element {
  const wires = useMemo(() => pocketTransformWires(pocket, spec), [pocket, spec]);
  return <group name="selected-pocket-wire">{wires.map((points, i) => <Line key={i} points={points}
    color="#0891b2" lineWidth={1.5} depthTest={false} renderOrder={100} />)}</group>;
}

export function ObjectTransformWire({ object, spec }: { object: EditableObject; spec: BinSpec }): JSX.Element {
  if (object.kind === "pocket") return <PocketTransformWire pocket={object} spec={spec} />;
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  const ring = objectOutline(object)[0].outer;
  const floor = top - effectiveFingerHoleDepthMm(object.hole);
  return <group name="selected-access-wire">{[top, floor].map(z => <Line key={z}
    points={[...ring, ring[0]].map(p => [p.x, p.y, z] as [number, number, number])}
    color="#0891b2" lineWidth={2} depthTest={false} renderOrder={100} />)}</group>;
}
