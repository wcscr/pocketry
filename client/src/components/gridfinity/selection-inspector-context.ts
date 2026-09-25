import { createContext, useContext } from "react";

export type InspectorTool = "properties" | "translate" | "rotate" | "arrange" | "links";
/** Reuse the existing editors once, with stable homes for each kind of control. */
export const SelectionInspectorContext = createContext<{
  properties: HTMLDivElement | null;
  transforms: HTMLDivElement | null;
  settings: HTMLDivElement | null;
  projectHeader: HTMLDivElement | null;
  toolbar: HTMLDivElement | null;
  dialogContent: HTMLDivElement | null;
  dialogSection: string | null;
  showSection: (id: string) => void;
  tool: InspectorTool;
  setTool: (tool: InspectorTool) => void;
  openInspector: () => void;
  keepObjectsOpen: () => void;
} | null>(null);

export const useSelectionInspector = () => useContext(SelectionInspectorContext);
