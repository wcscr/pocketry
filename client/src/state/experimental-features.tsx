import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const EXPERIMENTAL_FEATURES_KEY = "pocketry:experimental-features";

function readPreference(): boolean {
  try { return window.localStorage.getItem(EXPERIMENTAL_FEATURES_KEY) === "true"; }
  catch { return false; }
}

const ExperimentalFeaturesContext = createContext({
  enabled: false,
  setEnabled: (_enabled: boolean) => {},
  settingsOpen: false,
  setSettingsOpen: (_open: boolean) => {},
  persistenceUnavailable: false,
});

/** Browser preference only: never change a project's geometry or saved links. */
export function ExperimentalFeaturesProvider({ children }: { children: ReactNode }): JSX.Element {
  const [enabled, setValue] = useState(readPreference);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [persistenceUnavailable, setPersistenceUnavailable] = useState(false);
  const setEnabled = useCallback((value: boolean) => {
    setValue(value);
    try {
      window.localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, String(value));
      setPersistenceUnavailable(false);
    } catch { setPersistenceUnavailable(true); }
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === EXPERIMENTAL_FEATURES_KEY || event.key === null) setValue(readPreference());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <ExperimentalFeaturesContext.Provider value={{ enabled, setEnabled, settingsOpen, setSettingsOpen, persistenceUnavailable }}>
    {children}
  </ExperimentalFeaturesContext.Provider>;
}

export const useExperimentalFeatures = () => useContext(ExperimentalFeaturesContext);
