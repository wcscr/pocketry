import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementRef } from "react";
import { Object3D } from "three";
import { normalizeSurfaceTextRotation, type SurfaceText } from "@shared/gridfinity/surface-text";
import { styleTransformGizmo } from "@/lib/gridfinity/transform-gizmo-style";
import type { PocketTransformMode } from "@/lib/gridfinity/pocket-transform";

export interface SurfaceTextEditor {
  label: SurfaceText;
  z: number;
  onCommit: (label: SurfaceText, mode: PocketTransformMode) => void;
}

/** Raised labels stay on their surface: XY movement and Z rotation only.
 * A gesture previews locally and becomes one undo entry on release. */
export function SurfaceTextTransformScene({ editor, mode, snap, onPreview }: {
  editor: SurfaceTextEditor; mode: PocketTransformMode; snap: boolean;
  onPreview: (label: SurfaceText | null) => void;
}): JSX.Element {
  const { label, z, onCommit } = editor;
  const object = useMemo(() => new Object3D(), []);
  const controls = useRef<ElementRef<typeof TransformControls> | null>(null);
  const restoreHandles = useRef<() => void>(() => {});
  const [epoch, setEpoch] = useState(0);
  const attachControls = useCallback((next: ElementRef<typeof TransformControls> | null) => {
    if (controls.current === next) return;
    restoreHandles.current();
    controls.current?.dispose();
    controls.current = next;
    restoreHandles.current = next ? styleTransformGizmo(next) : () => {};
  }, []);
  const orbit = useThree(state => state.controls) as unknown as { enabled: boolean } | null;
  const gesture = useRef<{ original: SurfaceText; preview: SurfaceText | null } | null>(null);
  const callbacks = useRef({ onPreview, onCommit });
  callbacks.current = { onPreview, onCommit };
  const place = useCallback((value: SurfaceText) => {
    object.position.set(value.position.x, value.position.y, z);
    object.quaternion.identity();
    object.updateMatrixWorld();
  }, [object, z]);
  useLayoutEffect(() => { if (!gesture.current) place(label); }, [label, place]);
  const cancel = useCallback(() => {
    const original = gesture.current?.original;
    gesture.current = null;
    if (original) {
      controls.current?.reset();
      setEpoch(value => value + 1);
      place(original);
      if (orbit) orbit.enabled = true;
    }
    callbacks.current.onPreview(null);
  }, [place, orbit]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
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
  useEffect(() => { cancel(); place(label); }, [label, mode, cancel, place]);
  const change = () => {
    const drag = gesture.current;
    if (!drag) return;
    const clamp = (value: number) => Math.max(-672, Math.min(672, value));
    const preview = mode === "translate" ? { ...drag.original, position: { x: clamp(object.position.x), y: clamp(object.position.y) } }
      : { ...drag.original, rotationDeg: normalizeSurfaceTextRotation(drag.original.rotationDeg + 2 * Math.atan2(object.quaternion.z, object.quaternion.w) * 180 / Math.PI) };
    if (![preview.position.x, preview.position.y, preview.rotationDeg].every(Number.isFinite)) return;
    drag.preview = preview;
    place(preview);
    callbacks.current.onPreview(preview);
  };
  const finish = () => {
    const drag = gesture.current;
    gesture.current = null;
    if (drag) {
      const next = drag.preview ?? drag.original;
      place(next);
      if (Math.abs(next.position.x - drag.original.position.x) > 1e-6 || Math.abs(next.position.y - drag.original.position.y) > 1e-6 ||
        Math.abs(normalizeSurfaceTextRotation(next.rotationDeg - drag.original.rotationDeg)) > 1e-6) callbacks.current.onCommit(next, mode);
    }
    callbacks.current.onPreview(null);
  };
  return <>
    <primitive object={object} />
    <TransformControls key={epoch} ref={attachControls} object={object} mode={mode} space="world" size={0.95}
      showX={mode === "translate"} showY={mode === "translate"} showZ={mode === "rotate"}
      translationSnap={snap ? 1 : null} rotationSnap={snap ? Math.PI / 36 : null}
      onMouseDown={() => { gesture.current = { original: label, preview: null }; callbacks.current.onPreview(label); }}
      onObjectChange={change} onMouseUp={finish} />
  </>;
}
