import { useEffect, useRef, type PointerEvent } from "react";
import type { ViewportPointerHandlers } from "./use-viewport-transform";

/** Registers the first finger too, so a second finger can cancel a provisional
 * drawing and start a pinch. The surviving finger only navigates until release.
 */
export function useDraftNavigation(active: boolean, viewport: ViewportPointerHandlers, cancel: () => void) {
  const pointers = useRef(new Set<number>());
  const navigating = useRef(false);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    if (!active) { pointers.current.clear(); navigating.current = false; }
    const resized = () => {
      if (!active) return;
      cancelRef.current();
      navigating.current = pointers.current.size > 0;
    };
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, [active]);
  return {
    down(event: PointerEvent<SVGSVGElement>) {
      pointers.current.add(event.pointerId);
      viewport.onPointerDown(event, { pan: false });
      if (pointers.current.size > 1) {
        cancelRef.current();
        navigating.current = true;
      }
      return navigating.current;
    },
    move(event: PointerEvent<SVGSVGElement>) {
      viewport.onPointerMove(event);
      return navigating.current;
    },
    end(event: PointerEvent<SVGSVGElement>) {
      const wasNavigating = navigating.current;
      pointers.current.delete(event.pointerId);
      viewport.onPointerUp(event);
      if (!pointers.current.size) navigating.current = false;
      if (event.type === "pointercancel") cancelRef.current();
      return wasNavigating || event.type === "pointercancel";
    },
  };
}
