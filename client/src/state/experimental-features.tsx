import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectDoc } from "@shared/gridfinity/project";
import { projectUsesExperimentalFeatures } from "@/lib/project/experimental-features";

export const EXPERIMENTAL_FEATURES_KEY = "pocketry:experimental-features";

function readPreference(): boolean {
  try { return window.localStorage.getItem(EXPERIMENTAL_FEATURES_KEY) === "true"; }
  catch { return false; }
}

const ExperimentalFeaturesContext = createContext({
  enabled: false,
  setEnabled: (_enabled: boolean) => {},
  enableForProject: (_project: ProjectDoc): boolean => false,
  settingsOpen: false,
  setSettingsOpen: (_open: boolean) => {},
  persistenceUnavailable: false,
});

/** Browser preference only: never change a project's geometry or saved links. */
export function ExperimentalFeaturesProvider({ children }: { children: ReactNode }): JSX.Element {
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
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <ExperimentalFeaturesContext.Provider value={{ enabled, setEnabled, enableForProject, settingsOpen, setSettingsOpen, persistenceUnavailable }}>
    {children}
  </ExperimentalFeaturesContext.Provider>;
}

export const useExperimentalFeatures = () => useContext(ExperimentalFeaturesContext);
