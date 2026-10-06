import { createContext, useContext } from "react";

/** Compact panes own their visibility independently of desktop side panels. */
export const MobileWorkspaceActionsContext = createContext<{
  toggleWorkflow: () => void;
  showCanvas: () => void;
} | null>(null);
export const useMobileWorkspaceActions = () => useContext(MobileWorkspaceActionsContext);
