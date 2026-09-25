import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import type { ProjectDoc } from "@shared/gridfinity/project";
import { projectUsesExperimentalFeatures } from "@/lib/project/experimental-features";

export const EXPERIMENTAL_FEATURES_KEY = "pocketry:experimental-features";
export const SELECTION_INSPECTOR_KEY = "pocketry:selection-inspector";

function readPreference(key = EXPERIMENTAL_FEATURES_KEY): boolean {
  try { return window.localStorage.getItem(key) === "true"; }
  catch { return false; }
}

const ExperimentalFeaturesContext = createContext({
  enabled: false,
  setEnabled: (_enabled: boolean) => {},
  inspectorEnabled: false,
  setInspectorEnabled: (_enabled: boolean) => {},
  enableForProject: (_project: ProjectDoc): boolean => false,
  settingsOpen: false,
  setSettingsOpen: (_open: boolean) => {},
  persistenceUnavailable: false,
});

/** Browser preference only: never change a project's geometry or saved links. */
export function ExperimentalFeaturesProvider({ children }: { children: ReactNode }): JSX.Element {
  const search = useSearch();
  const inspectorQuery = new URLSearchParams(search).get("inspector");
  const [inspectorEnabled, setInspectorValue] = useState(() =>
    inspectorQuery === "1" || (inspectorQuery !== "0" && readPreference(SELECTION_INSPECTOR_KEY)));
  const [enabled, setValue] = useState(readPreference);
  const enabledRef = useRef(enabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [persistenceUnavailable, setPersistenceUnavailable] = useState(false);
  const setEnabled = useCallback((value: boolean) => {
    enabledRef.current = value;
    setValue(value);
    try {
      window.localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, String(value));
      setPersistenceUnavailable(false);
    } catch { setPersistenceUnavailable(true); }
  }, []);
  const setInspectorEnabled = useCallback((value: boolean) => {
    setInspectorValue(value);
    try {
      window.localStorage.setItem(SELECTION_INSPECTOR_KEY, String(value));
      setPersistenceUnavailable(false);
    } catch { setPersistenceUnavailable(true); }
  }, []);
  useEffect(() => {
    if (inspectorQuery !== "1" && inspectorQuery !== "0") return;
    // Preview links set a browser preference once. Consume the flag so a later
    // Settings choice survives refresh and navigation through ordinary links.
    setInspectorEnabled(inspectorQuery === "1");
    const url = new URL(window.location.href);
    url.searchParams.delete("inspector");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [inspectorQuery, setInspectorEnabled]);
  const enableForProject = useCallback((project: ProjectDoc): boolean => {
    if (enabledRef.current || !projectUsesExperimentalFeatures(project)) return false;
    setEnabled(true);
    return true;
  }, [setEnabled]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === EXPERIMENTAL_FEATURES_KEY || event.key === null) {
        enabledRef.current = readPreference();
        setValue(enabledRef.current);
      }
      if (event.key === SELECTION_INSPECTOR_KEY || event.key === null) {
        setInspectorValue(readPreference(SELECTION_INSPECTOR_KEY));
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <ExperimentalFeaturesContext.Provider value={{ enabled, setEnabled, inspectorEnabled, setInspectorEnabled, enableForProject, settingsOpen, setSettingsOpen, persistenceUnavailable }}>
    {children}
  </ExperimentalFeaturesContext.Provider>;
}

export const useExperimentalFeatures = () => useContext(ExperimentalFeaturesContext);
