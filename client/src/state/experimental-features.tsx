import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch } from "wouter";

export const EXPERIMENTAL_FEATURES_KEY = "pocketry:experimental-features";
export const SELECTION_INSPECTOR_KEY = "pocketry:selection-inspector";
export const EDITOR_LAYOUT_KEY = "pocketry:editor-layout";
export type EditorLayout = "standard" | "workflow";
export const EDITOR_LAYOUTS = [
  { value: "workflow", label: "Workflow + properties", description: "Default on desktop. Workflow and properties in separate panels." },
  { value: "standard", label: "Original Single Panel UI", description: "Workflow and properties together in one panel." },
] as const;
const isEditorLayout = (value: string | null): value is EditorLayout => EDITOR_LAYOUTS.some(layout => layout.value === value);
function readLayout(implicitLayout: EditorLayout): EditorLayout {
  try {
    const value = window.localStorage.getItem(EDITOR_LAYOUT_KEY);
    if (isEditorLayout(value)) return value;
  } catch { /* Blocked storage uses the default layout. */ }
  // Only a supported, explicit choice overrides the default for this screen.
  return implicitLayout;
}

function readPreference(key = EXPERIMENTAL_FEATURES_KEY): boolean {
  try { return window.localStorage.getItem(key) === "true"; }
  catch { return false; }
}

const ExperimentalFeaturesContext = createContext({
  enabled: false,
  setEnabled: (_enabled: boolean) => {},
  editorLayout: "standard" as EditorLayout,
  setEditorLayout: (_layout: EditorLayout) => {},
  inspectorEnabled: false,
  settingsOpen: false,
  setSettingsOpen: (_open: boolean) => {},
  persistenceUnavailable: false,
});

/** Browser preference only: never change a project's geometry or saved links. */
export function ExperimentalFeaturesProvider({ children }: { children: ReactNode }): JSX.Element {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const inspectorQuery = params.get("inspector");
  const layoutQuery = params.get("layout");
  const retiredLayoutLink = layoutQuery === "objects" || inspectorQuery === "1" || inspectorQuery === "0";
  const requestedLayout = isEditorLayout(layoutQuery) ? layoutQuery : retiredLayoutLink ? "standard" : null;
  // Choose once per session. Resizing and the software keyboard adapt the
  // workspace without changing this choice or persisting an implicit preference.
  const [implicitLayout] = useState<EditorLayout>(() => window.innerWidth >= 1100 && window.innerHeight >= 600 ? "workflow" : "standard");
  const [editorLayout, setLayoutValue] = useState<EditorLayout>(() => requestedLayout ?? readLayout(implicitLayout));
  const inspectorEnabled = editorLayout === "workflow";
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
  const setEditorLayout = useCallback((value: EditorLayout) => {
    setLayoutValue(value);
    try {
      window.localStorage.setItem(EDITOR_LAYOUT_KEY, value);
      window.localStorage.removeItem(SELECTION_INSPECTOR_KEY);
      setPersistenceUnavailable(false);
    } catch { setPersistenceUnavailable(true); }
  }, []);
  useEffect(() => {
    if (!requestedLayout) return;
    // Preview links set a browser preference once. Consume the flag so a later
    // Settings choice survives refresh and navigation through ordinary links.
    setEditorLayout(requestedLayout);
    const url = new URL(window.location.href);
    url.searchParams.delete("inspector");
    if (isEditorLayout(layoutQuery) || layoutQuery === "objects") url.searchParams.delete("layout");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [requestedLayout, layoutQuery, setEditorLayout]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === EXPERIMENTAL_FEATURES_KEY || event.key === null) {
        enabledRef.current = readPreference();
        setValue(enabledRef.current);
      }
      if (event.key === EDITOR_LAYOUT_KEY || event.key === null) {
        setLayoutValue(readLayout(implicitLayout));
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [implicitLayout]);
  return <ExperimentalFeaturesContext.Provider value={{ enabled, setEnabled, editorLayout, setEditorLayout, inspectorEnabled, settingsOpen, setSettingsOpen, persistenceUnavailable }}>
    {children}
  </ExperimentalFeaturesContext.Provider>;
}

export const useExperimentalFeatures = () => useContext(ExperimentalFeaturesContext);
