import { createContext, useContext } from "react";

/** Portal target keeps the existing trace controls mounted only once. */
export interface TraceInspector {
  activeSection: string;
  settings: HTMLDivElement | null;
  showSection: (id: string, reveal?: boolean) => void;
  showCanvas: () => void;
}

export const TraceInspectorContext = createContext<TraceInspector | null>(null);
export const useTraceInspector = () => useContext(TraceInspectorContext);
