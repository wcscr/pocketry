import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const MobileCanvasOverlayContext = createContext<HTMLDivElement | null>(null);

/** Workflow guidance follows the canvas bounds even when an adjustment tray is open. */
export function MobileCanvasOverlay({ children }: { children: ReactNode }) {
  const target = useContext(MobileCanvasOverlayContext);
  return target ? createPortal(children, target) : null;
}
