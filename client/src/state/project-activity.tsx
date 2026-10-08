import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectDoc } from "@shared/gridfinity/project";
import { readProjectOverview } from "@/lib/project/persist";
import { prepareProjectExport } from "@/lib/project/export";
import { downloadBlob } from "@/lib/download";

export interface ProjectActivity {
  name: string | null;
  activeProjectId: string | null;
  status: "loading" | "saving" | "saved" | "error";
  error: string | null;
  hasDocument: boolean;
}
const INITIAL: ProjectActivity = { name: null, activeProjectId: null, status: "loading", error: null, hasDocument: false };
interface ProjectActivityActions {
  publish: (activity: ProjectActivity, doc: ProjectDoc | null) => void;
  saved: (success: boolean, error?: Error) => void;
  downloadBackup: () => void;
}
const ActivityContext = createContext<ProjectActivity | null>(null);
const ActionsContext = createContext<ProjectActivityActions | null>(null);

/** Keep the Bin identity, save result and backup available when its route unmounts.
 * This does not own persistence and never writes or recovers a stored project. */
export function ProjectActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState(INITIAL);
  const backup = useRef<ProjectDoc | null>(null);
  const published = useRef(false);
  const publish = useCallback((next: ProjectActivity, doc: ProjectDoc | null) => {
    published.current = true;
    backup.current = doc;
    setActivity(previous => Object.keys(next).every(key => previous[key as keyof ProjectActivity] === next[key as keyof ProjectActivity]) ? previous : next);
  }, []);
  const saved = useCallback((success: boolean, error?: Error) => {
    setActivity(previous => ({ ...previous, status: success ? "saved" : "error", error: success ? null : error?.message ?? "Could not save in this browser. Download a backup to keep your work." }));
  }, []);
  const downloadBackup = useCallback(() => {
    const doc = backup.current;
    if (!doc) return;
    const project = prepareProjectExport(doc, doc.name ?? null);
    downloadBlob(project.backup, `${project.baseName}.pocketry.json`);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void readProjectOverview().then(({ doc, activeProjectId }) => {
      if (cancelled || published.current) return;
      backup.current = doc;
      setActivity({ name: doc?.name ?? null, activeProjectId, status: "saved", error: null, hasDocument: !!doc });
    }).catch(cause => {
      if (cancelled || published.current) return;
      setActivity({ ...INITIAL, status: "error", error: cause instanceof Error ? cause.message : "Could not read projects in this browser. Open the browser library to recover your work." });
    });
    return () => { cancelled = true; };
  }, []);
  const actions = useMemo(() => ({ publish, saved, downloadBackup }), [publish, saved, downloadBackup]);
  return <ActionsContext.Provider value={actions}><ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider></ActionsContext.Provider>;
}

export const useProjectActivity = () => useContext(ActivityContext);
export const useProjectActivityActions = () => useContext(ActionsContext);

export function projectActivityLabel(activity: ProjectActivity): string {
  if (activity.status === "loading") return "Opening project…";
  if (activity.status === "error") return "Project storage needs attention";
  if (activity.status === "saving") return "Saving locally…";
  if (!activity.hasDocument) return "No bin project yet";
  return activity.activeProjectId ? "Saved in this browser" : "Draft saved in this browser";
}
