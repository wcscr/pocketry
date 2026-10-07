import { createContext, useContext } from "react";
import type { InspectorTool } from "./selection-inspector-context";

/** Phone transforms share a dock outside the canvas in both editor layouts. */
export const MobileObjectToolsContext = createContext<{
  tool: InspectorTool;
  setTool: (tool: InspectorTool) => void;
  controls: HTMLDivElement | null;
  setControls: (controls: HTMLDivElement | null) => void;
} | null>(null);

export const useMobileObjectTools = () => useContext(MobileObjectToolsContext);
