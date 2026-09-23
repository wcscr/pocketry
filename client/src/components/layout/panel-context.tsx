import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  traceRestart: (() => void) | null;
  registerTraceRestart: (action: (() => void) | null) => void;
  /** Survives navigation from Trace until Bin can open the library manager. */
  libraryRequested: boolean;
  setLibraryRequested: (requested: boolean) => void;
}

const PanelContext = createContext<PanelState | null>(null);

export function PanelProvider({ children }: { children: ReactNode }): JSX.Element {
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia?.("(max-width: 767px)").matches);
  const [traceRestart, setTraceRestart] = useState<(() => void) | null>(null);
  const [libraryRequested, setLibraryRequested] = useState(false);
  const registerTraceRestart = useCallback((action: (() => void) | null) => setTraceRestart(() => action), []);

  const value = useMemo<PanelState>(
    () => ({
      panelOpen,
      setPanelOpen,
      togglePanel: () => setPanelOpen((open) => !open),
      traceRestart,
      registerTraceRestart,
      libraryRequested,
      setLibraryRequested,
    }),
    [panelOpen, traceRestart, registerTraceRestart, libraryRequested],
  );

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

/** The active mobile trace owns its confirmation and cancels pending work on reset. */
export function useTraceRestartAction(action: (() => void) | null): void {
  const register = useContext(PanelContext)?.registerTraceRestart;
  useEffect(() => {
    register?.(action);
    return () => register?.(null);
  }, [action, register]);
}

export function usePanelState(): PanelState {
  const state = useContext(PanelContext);
  if (!state) {
    throw new Error("usePanelState must be used inside a PanelProvider");
  }
  return state;
}
