import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectDoc } from "@shared/gridfinity/project";
import { readProjectOverview } from "@/lib/project/persist";
import { prepareProjectExport } from "@/lib/project/export";
import { downloadBlob } from "@/lib/download";
import { projectDestinationKey } from "@/lib/project/destination";

export interface ProjectActivity {
  name: string | null;
  activeProjectId: string | null;
  status: "loading" | "saving" | "saved" | "error";
  error: string | null;
  hasDocument: boolean;
  destinationKey?: string;
  recoveryBackups?: { id: number; name: string }[];
}
const INITIAL: ProjectActivity = { name: null, activeProjectId: null, status: "loading", error: null, hasDocument: false };
interface ProjectActivityActions {
  publish: (activity: ProjectActivity, doc: ProjectDoc | null, visit?: symbol) => void;
  saved: (success: boolean, error?: Error, visit?: symbol) => void;
  downloadBackup: () => void;
  downloadRecovery: (id: number) => void;
}
const DEFAULT_VISIT = Symbol("default visit");
const ActivityContext = createContext<ProjectActivity | null>(null);
const ActionsContext = createContext<ProjectActivityActions | null>(null);

/** Keep the Bin identity, save result and backup available when its route unmounts.
 * This does not own persistence and never writes or recovers a stored project. */
export function ProjectActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState(INITIAL);
  const backup = useRef<ProjectDoc | null>(null);
  const published = useRef(false);
  const currentVisit = useRef<symbol>(DEFAULT_VISIT);
  const visits = useRef(new Map<symbol, { doc: ProjectDoc; saved: boolean }>());
  const [recoveries, setRecoveries] = useState<{ id: number; visit: symbol; doc: ProjectDoc }[]>([]);
  const nextRecoveryId = useRef(0);
  const retainRecovery = useCallback((visit: symbol, doc: ProjectDoc) => {
    const id = ++nextRecoveryId.current;
    setRecoveries(previous => [...previous.filter(copy => copy.visit !== visit), { id, visit, doc }]);
  }, []);
  const publish = useCallback((next: ProjectActivity, doc: ProjectDoc | null, visit = DEFAULT_VISIT) => {
    published.current = true;
    if (currentVisit.current !== visit && visits.current.get(currentVisit.current)?.saved) visits.current.delete(currentVisit.current);
    currentVisit.current = visit;
    backup.current = doc;
    if (doc) visits.current.set(visit, { doc, saved: next.status === "saved" });
    if (doc && next.status === "error") retainRecovery(visit, doc);
    setActivity(previous => Object.keys(next).every(key => previous[key as keyof ProjectActivity] === next[key as keyof ProjectActivity]) ? previous : next);
  }, [retainRecovery]);
  const saved = useCallback((success: boolean, error?: Error, visit = DEFAULT_VISIT) => {
    const doc = visits.current.get(visit)?.doc;
    if (!success && doc) retainRecovery(visit, doc);
    if (success) setRecoveries(previous => previous.filter(copy => copy.visit !== visit));
    // A flush may finish after a different Bin visit has opened. It must not
    // label that new document saved or replace its backup/error state.
    if (currentVisit.current === visit) setActivity(previous => ({ ...previous, status: success ? "saved" : "error", error: success ? null : error?.message ?? "Could not save in this browser. Download a backup to keep your work." }));
    else visits.current.delete(visit);
  }, [retainRecovery]);
  const downloadBackup = useCallback(() => {
    const doc = backup.current;
    if (!doc) return;
    const project = prepareProjectExport(doc, doc.name ?? null);
    downloadBlob(project.backup, `${project.baseName}.pocketry.json`);
  }, []);
  const recoveriesRef = useRef(recoveries);
  recoveriesRef.current = recoveries;
  const downloadRecovery = useCallback((id: number) => {
    const doc = recoveriesRef.current.find(copy => copy.id === id)?.doc;
    if (!doc) return;
    const project = prepareProjectExport(doc, doc.name ?? null);
    downloadBlob(project.backup, `${project.baseName}-unsaved.pocketry.json`);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void readProjectOverview().then(({ doc, activeProjectId }) => {
      if (cancelled || published.current) return;
      backup.current = doc;
      setActivity({ name: doc?.name ?? null, activeProjectId, status: "saved", error: null, hasDocument: !!doc, destinationKey: projectDestinationKey(doc, activeProjectId) });
    }).catch(cause => {
      if (cancelled || published.current) return;
      setActivity({ ...INITIAL, status: "error", error: cause instanceof Error ? cause.message : "Could not read projects in this browser. Open the browser library to recover your work." });
    });
    return () => { cancelled = true; };
  }, []);
  const actions = useMemo(() => ({ publish, saved, downloadBackup, downloadRecovery }), [publish, saved, downloadBackup, downloadRecovery]);
  const value = useMemo(() => ({ ...activity, recoveryBackups: recoveries.map(copy => ({ id: copy.id, name: copy.doc.name ?? "Untitled project" })) }), [activity, recoveries]);
  return <ActionsContext.Provider value={actions}><ActivityContext.Provider value={value}>{children}</ActivityContext.Provider></ActionsContext.Provider>;
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
