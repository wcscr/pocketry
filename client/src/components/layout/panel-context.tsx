import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether the controls panel is open.
 *
 * Shared between the header (which owns the toggle) and the workspace (which
 * owns the panel), so it lives above both rather than being threaded through
 * every route. `WorkspaceLayout` persists the *size* of the panel via
 * `autoSaveId`; this only tracks open/closed for the current session.
 */
interface PanelState {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

const PanelContext = createContext<PanelState | null>(null);

export function PanelProvider({ children }: { children: ReactNode }): JSX.Element {
  const [panelOpen, setPanelOpen] = useState(true);

  const value = useMemo<PanelState>(
    () => ({
      panelOpen,
      setPanelOpen,
      togglePanel: () => setPanelOpen((open) => !open),
    }),
    [panelOpen],
  );

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanelState(): PanelState {
  const state = useContext(PanelContext);
  if (!state) {
    throw new Error("usePanelState must be used inside a PanelProvider");
  }
  return state;
}
