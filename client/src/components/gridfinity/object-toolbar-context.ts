import { createContext, useContext } from "react";
import type { InspectorTool } from "./selection-inspector-context";

/** The placement toolbar is shared by Single panel and Workflow + properties. */
export const ObjectToolbarContext = createContext<{
  toolbar: HTMLDivElement | null;
  tool: InspectorTool;
  setTool: (tool: InspectorTool) => void;
} | null>(null);
export const useObjectToolbar = () => useContext(ObjectToolbarContext);
