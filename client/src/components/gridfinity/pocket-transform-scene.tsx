import { Line, TransformControls } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementRef } from "react";
import { DoubleSide, Object3D } from "three";
import type { CutoutPlacement } from "@shared/gridfinity/cutout";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import {
  pickPocketAtTop, pocketTransformChanged, pocketTransformPatch, pocketTransformWires, surfaceAnchoredPocket,
  type EditablePocket, type PocketTransformMode, type PocketTransformPatch,
} from "@/lib/gridfinity/pocket-transform";

export interface PocketEditor {
  spec: BinSpec;
  pockets: readonly EditablePocket[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: PocketTransformPatch, mode: PocketTransformMode) => void;
}

export function PocketSelectionPlane({ editor, width, length, disabled }: {
  editor: PocketEditor; width: number; length: number; disabled: boolean;
}): JSX.Element {
  const z = resolvePocketDepth(editor.spec, { mode: "through" }).infillTopZ;
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (disabled || event.button !== 0 || event.delta > 4) return;
    const id = pickPocketAtTop(editor.pockets, event.point);
    if (id) { event.stopPropagation(); editor.onSelect(id); }
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
    // Three also supplies screen-space E/XYZE rotation and XYZ translation.
    // Remove those visuals AND pickers so only bin-axis/plane handles can drag.
    const removed: { parent: Object3D; child: Object3D }[] = [];
    next?.traverse(child => {
      if (["E", "XYZE", "XYZ"].includes(child.name) && child.parent) removed.push({ parent: child.parent, child });
    });
    removed.forEach(({ child }) => child.removeFromParent());
    // Return them before disposal so their geometries/materials are released.
    restoreHandles.current = () => removed.forEach(({ parent, child }) => parent.add(child));
  }, []);
  const orbit = useThree(state => state.controls) as unknown as { enabled: boolean } | null;
  const gesture = useRef<{ original: CutoutPlacement; patch: PocketTransformPatch | null } | null>(null);
  const callbacks = useRef({ onPreview, onCommit, onLimit });
  callbacks.current = { onPreview, onCommit, onLimit };
  const top = resolvePocketDepth(spec, pocket.cutout.depth).infillTopZ;
  const place = useCallback((cutout: CutoutPlacement) => {
    const anchored = surfaceAnchoredPocket(cutout);
    object.position.set(anchored.position.x, anchored.position.y, top);
    object.quaternion.identity();
    object.updateMatrixWorld();
  }, [object, top]);
  useLayoutEffect(() => { if (!gesture.current) place(pocket.cutout); }, [place, pocket.cutout]);
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
  useEffect(() => { cancel(); place(pocket.cutout); }, [pocket.cutout, spec, cancel, place]);
  const change = () => {
    const drag = gesture.current;
    if (!drag) return;
    const patch = pocketTransformPatch(drag.original, pocket.shape, spec, object.position, object.quaternion, mode);
    if (!patch) {
      place(drag.patch ? { ...drag.original, ...drag.patch } : drag.original);
      callbacks.current.onLimit(true);
      return;
    }
    // TransformControls recomputes each sample from its pointer-down pose.
    // Reset the proxy after reading that delta so even mid-drag its visible
    // handles stay on the surface and aligned to the fixed bin axes.
    place({ ...drag.original, ...patch });
    drag.patch = patch;
    callbacks.current.onLimit(false);
    callbacks.current.onPreview({ ...drag.original, ...patch });
  };
  const finish = () => {
    const drag = gesture.current;
    gesture.current = null;
    if (drag?.patch && pocketTransformChanged(drag.original, drag.patch, mode)) {
      place({ ...drag.original, ...drag.patch });
      callbacks.current.onCommit(drag.original.id, drag.patch, mode);
    } else if (drag) place(drag.original);
    callbacks.current.onPreview(null);
    callbacks.current.onLimit(false);
  };
  return <>
    <primitive object={object} />
    <TransformControls key={controlEpoch} ref={attachControls} object={object} mode={mode} space="world" size={0.85}
      translationSnap={snap ? 1 : null} rotationSnap={snap ? Math.PI / 36 : null}
      onMouseDown={() => { gesture.current = { original: pocket.cutout, patch: null }; callbacks.current.onPreview(pocket.cutout); }}
      onObjectChange={change} onMouseUp={finish} />
  </>;
}

export function PocketTransformWire({ pocket, spec }: { pocket: EditablePocket; spec: BinSpec }): JSX.Element {
  const wires = useMemo(() => pocketTransformWires(pocket, spec), [pocket, spec]);
  return <group name="selected-pocket-wire">{wires.map((points, i) => <Line key={i} points={points}
    color="#0891b2" lineWidth={1.5} depthTest={false} renderOrder={100} />)}</group>;
}
