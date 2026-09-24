import { createContext, useContext } from "react";

export type InspectorTool = "properties" | "translate" | "rotate" | "arrange";
/** Portal destinations keep existing property editors and transform state mounted
 * once, while moving their controls out of the object list and canvas. */
export const SelectionInspectorContext = createContext<{
  properties: HTMLDivElement | null;
  transforms: HTMLDivElement | null;
  pocketList: HTMLDivElement | null;
  fingerList: HTMLDivElement | null;
  tool: InspectorTool;
  setTool: (tool: InspectorTool) => void;
  openInspector: () => void;
} | null>(null);

export const useSelectionInspector = () => useContext(SelectionInspectorContext);
