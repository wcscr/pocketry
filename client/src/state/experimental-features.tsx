import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import type { ProjectDoc } from "@shared/gridfinity/project";
import { projectUsesExperimentalFeatures } from "@/lib/project/experimental-features";

export const EXPERIMENTAL_FEATURES_KEY = "pocketry:experimental-features";
export const SELECTION_INSPECTOR_KEY = "pocketry:selection-inspector";
export const EDITOR_LAYOUT_KEY = "pocketry:editor-layout";
export type EditorLayout = "standard" | "objects" | "workflow";
export const EDITOR_LAYOUTS = [
  { value: "standard", label: "Controls on the left", description: "The full workflow and its settings in one panel." },
  { value: "objects", label: "Objects left, properties right", description: "A compact object tree with a selection inspector." },
  { value: "workflow", label: "Workflow left, properties right", description: "Every workflow section on the left; its settings on the right." },
] as const;
const isEditorLayout = (value: string | null): value is EditorLayout => EDITOR_LAYOUTS.some(layout => layout.value === value);
function readLayout(): EditorLayout {
  try {
    const value = window.localStorage.getItem(EDITOR_LAYOUT_KEY);
    if (isEditorLayout(value)) return value;
  } catch { /* Older preferences and blocked storage use the same fallback. */ }
  return readPreference(SELECTION_INSPECTOR_KEY) ? "objects" : "standard";
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
  setInspectorEnabled: (_enabled: boolean) => {},
  enableForProject: (_project: ProjectDoc): boolean => false,
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
  const requestedLayout = isEditorLayout(layoutQuery) ? layoutQuery : inspectorQuery === "1" ? "objects" : inspectorQuery === "0" ? "standard" : null;
  const [editorLayout, setLayoutValue] = useState<EditorLayout>(() => requestedLayout ?? readLayout());
  const inspectorEnabled = editorLayout !== "standard";
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
      window.localStorage.setItem(SELECTION_INSPECTOR_KEY, String(value !== "standard"));
      setPersistenceUnavailable(false);
    } catch { setPersistenceUnavailable(true); }
  }, []);
  const setInspectorEnabled = useCallback((value: boolean) => setEditorLayout(value ? "objects" : "standard"), [setEditorLayout]);
  useEffect(() => {
    if (!requestedLayout) return;
    // Preview links set a browser preference once. Consume the flag so a later
    // Settings choice survives refresh and navigation through ordinary links.
    setEditorLayout(requestedLayout);
    const url = new URL(window.location.href);
    url.searchParams.delete("inspector");
    if (isEditorLayout(layoutQuery)) url.searchParams.delete("layout");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [requestedLayout, layoutQuery, setEditorLayout]);
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
      if (event.key === EDITOR_LAYOUT_KEY || event.key === SELECTION_INSPECTOR_KEY || event.key === null) {
        setLayoutValue(readLayout());
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <ExperimentalFeaturesContext.Provider value={{ enabled, setEnabled, editorLayout, setEditorLayout, inspectorEnabled, setInspectorEnabled, enableForProject, settingsOpen, setSettingsOpen, persistenceUnavailable }}>
    {children}
  </ExperimentalFeaturesContext.Provider>;
}

export const useExperimentalFeatures = () => useContext(ExperimentalFeaturesContext);
