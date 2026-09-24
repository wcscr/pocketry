import { useEffect, useRef } from "react";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import type { ViewportTransformApi } from "@/hooks/use-viewport-transform";

/** Keep both reference marks visible as the keyboard changes the canvas size.
 * Return to the whole photo when entry ends so region selection can continue.
 */
export function useRulerInputFraming(
  mobile: boolean,
  ruler: { startX?: number; startY?: number; endX?: number; endY?: number } | null,
  size: { width: number; height: number },
  { fit, fitToRect }: Pick<ViewportTransformApi, "fit" | "fitToRect">,
) {
  const keyboard = useKeyboardViewport();
  const focused = mobile && keyboard?.focusedId === "mobile-ruler-length";
  const framed = useRef(false);
  const { startX, startY, endX, endY } = ruler ?? {};
  useEffect(() => {
    if (focused && startX !== undefined && startY !== undefined && endX !== undefined && endY !== undefined) {
      const margin = Math.max(1, Math.hypot(endX - startX, endY - startY) * 0.1);
      fitToRect({
        x: Math.min(startX, endX) - margin,
        y: Math.min(startY, endY) - margin,
        width: Math.abs(endX - startX) + margin * 2,
        height: Math.abs(endY - startY) + margin * 2,
      });
      framed.current = true;
    } else if (framed.current) {
      framed.current = false;
      fit();
    }
  }, [focused, startX, startY, endX, endY, size.width, size.height, fit, fitToRect]);
}
