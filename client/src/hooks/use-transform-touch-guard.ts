import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import type { TransformControls } from "three-stdlib";
import { guardTransformTouches } from "@/lib/gridfinity/transform-touch-guard";

/** Shared by pocket/finger and surface-text gizmos. */
export function useTransformTouchGuard(controls: RefObject<TransformControls>, cancel: () => void, touchTargets: boolean): void {
  const element = useThree(state => state.gl?.domElement);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const control = controls.current;
    if (!element || !control) return;
    // These are observable runtime properties, marked private by three-stdlib.
    return guardTransformTouches(element, control as unknown as { enabled: boolean }, () => cancelRef.current());
  }, [element, controls, touchTargets]);
}
