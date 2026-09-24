import { createContext, useContext } from "react";

/** Portal destinations keep existing property editors and transform state mounted
 * once, while moving their controls out of the object list and canvas. */
export const SelectionInspectorContext = createContext<{
  properties: HTMLDivElement | null;
  transforms: HTMLDivElement | null;
  activeTab: "properties" | "transform";
  setActiveTab: (tab: "properties" | "transform") => void;
} | null>(null);

export const useSelectionInspector = () => useContext(SelectionInspectorContext);
