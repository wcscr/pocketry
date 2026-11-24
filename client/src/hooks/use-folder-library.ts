import { IMPORT_LIMIT_ERROR, withinImportLimits } from "@shared/gridfinity/import-limits";
import { libraryBackupSchema } from "@shared/gridfinity/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserLibraryFolder, folderRequestId, type FolderDraft, type FolderIntent } from "@/lib/project/browser-folder";
import { exportProjectLibrary } from "@/lib/project/persist";
import { ConnectedLibrary, type FolderProject, type RequestOutcome } from "@shared/project-library/library";
import { assignedProjectId, FOLDER_LIMITS, LegacyFolderError, LibraryError, projectNameSchema, readFolderProject, type Change } from "@shared/project-library/format";
import { publishRecoveredLibrary, recoverLegacyBackup } from "@shared/project-library/legacy-recovery";
import type { ProjectDoc } from "@shared/gridfinity/project";

export type LibraryStorage = "browser" | "folder";
export interface FolderRefreshOptions { requestAccess?: boolean }
const STORAGE_KEY = "pocketry:library-storage";

export function useLibraryStorage() {
  const [storage, setStorage] = useState<LibraryStorage>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "folder" ? "folder" : "browser"; }
    catch { return "browser"; }
  });
  return [storage, (next: LibraryStorage) => {
    setStorage(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* The choice still applies in this tab. */ }
  }] as const;
}

/** One folder connection and mutation journal for every editor entry point. */
export function useFolderLibrary(enabled = true) {
  const [folder, setFolder] = useState<BrowserLibraryFolder | null>(null);
  const [projects, setProjects] = useState<FolderProject[]>([]);
  const [pending, setPending] = useState<FolderIntent[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [legacyFolder, setLegacyFolder] = useState(false);
  const [mixedFolder, setMixedFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const refreshing = useRef<{ requestAccess: boolean } | null>(null);
  const supported = BrowserLibraryFolder.supported();

  const run = useCallback(async <Result,>(operation: () => Promise<Result>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try { return await operation(); }
    catch (cause) {
      if (cause instanceof LibraryError && cause.code === "permission") setCanWrite(false);
      if (cause instanceof LegacyFolderError) setLegacyFolder(true);
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The folder operation failed.");
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  const load = useCallback(async (selected: BrowserLibraryFolder | null, shouldRequestAccess?: () => boolean) => {
    setFolder(selected);
    setCanWrite(false);
    setLegacyFolder(false);
    setMixedFolder(false);
    setProjects([]);
    setPending([]);
    if (!selected) return;
    const hasAccess = await selected.canWrite();
    if (!hasAccess && (!shouldRequestAccess?.() || !navigator.userActivation?.isActive || !await selected.renew())) return;
    setCanWrite(true);
    setPending(await selected.pending());
    try {
      const view = await new ConnectedLibrary(selected).browse();
      setProjects(view.projects);
      setMixedFolder(view.canRecoverLegacy);
    }
    catch (cause) {
      if (!(cause instanceof LegacyFolderError)) throw cause;
      setLegacyFolder(true);
    }
  }, []);
  const refresh = useCallback(({ requestAccess = false }: FolderRefreshOptions = {}) => {
    if (refreshing.current) {
      // A Library click can arrive while startup is still reading the handle.
      if (requestAccess) refreshing.current.requestAccess = true;
      return;
    }
    return run(async () => {
      const attempt = { requestAccess };
      refreshing.current = attempt;
      try { await load(await BrowserLibraryFolder.saved(), () => attempt.requestAccess); }
      finally { refreshing.current = null; }
    });
  }, [run, load]);
  useEffect(() => { if (enabled && supported) void refresh(); }, [enabled, refresh, supported]);

  const apply = async (selected: BrowserLibraryFolder, intent: FolderIntent,
    finish?: (revision: string) => Promise<void>,
  ): Promise<RequestOutcome> => {
    const service = new ConnectedLibrary(selected);
    const requestId = folderRequestId(intent);
    await selected.remember(intent);
    let outcome;
    try {
      const observed = intent.candidateRevision ? await service.inspect(requestId, intent.candidateRevision) : null;
      if (observed?.status === "published-unverified" ||
          (observed && "publications" in observed && observed.publications.some(item => item.revision === intent.candidateRevision))) {
        outcome = observed;
      } else {
        outcome = intent.kind === "commit" ? await service.commit(intent.mutation)
          : await service.keepBoth(requestId, intent.projectId, intent.expected, intent.keep);
      }
    } catch (cause) {
      if (cause instanceof LibraryError && ["stale-base", "conflict", "validation", "resource-limit", "request-reused"].includes(cause.code)) {
        await selected.forget(requestId).catch(() => {});
      }
      if (!await selected.canWrite().catch(() => false)) setCanWrite(false);
      throw cause;
    } finally {
      setPending(await selected.pending().catch(() => []));
    }
    if ("publications" in outcome) {
      if (outcome.status === "published") await finish?.(outcome.publications[0].revision);
      setMessage(outcome.status === "published"
        ? `Saved revision ${outcome.publications[0].revision.slice(0, 12)}.`
        : "The revision was published. Review the competing versions in the Library.");
      await selected.forget(requestId).catch(() => {});
    } else if ("revision" in outcome) {
      await selected.remember({ ...intent, candidateRevision: outcome.revision }).catch(() => {});
      if (outcome.status === "published-unverified") {
        setMessage(`Revision ${outcome.revision} was written. Check request ${requestId} to verify the current folder heads.`);
      } else {
        setError(`The write outcome is uncertain. Check request ${requestId} and revision ${outcome.revision} before starting another save.`);
      }
    }
    setPending(await selected.pending().catch(() => []));
    setProjects(await service.list().catch(() => projects));
    return outcome;
  };

  const writableFolder = async () => {
    if (legacyFolder) throw new LegacyFolderError();
    if (!folder || !await folder.canWrite()) {
      throw new LibraryError("permission", "Connect a local folder or restore folder access in Library.");
    }
    if ((await folder.pending()).length) {
      throw new LibraryError("conflict", "Check the pending folder save in Library before saving again.");
    }
    return folder;
  };

  const save = (doc: ProjectDoc, name: string, active: FolderDraft | null = null,
    onPublished?: (target: FolderDraft) => Promise<void>,
    prepareDraft?: (requestId: string) => Promise<void>,
  ) => run(async () => {
    const selected = await writableFolder();
    const projectName = projectNameSchema.safeParse(name.trim().replace(/\s+/g, " "));
    if (!projectName.success) throw new LibraryError("validation", "Enter a project name up to 80 characters.");
    if (active && selected.id !== active.connectionId) {
      throw new LibraryError("stale-base", "This draft is linked to a previous folder connection. Save it as a new project here, or export a backup to keep your changes.");
    }
    const requestId = crypto.randomUUID();
    const projectId = active?.projectId ?? await assignedProjectId(requestId);
    const target = (revision: string) => ({ connectionId: selected.id, projectId, revision, name: projectName.data });
    await prepareDraft?.(requestId);
    const outcome = await apply(selected, { kind: "commit", draftBase: active ?? undefined,
      workingDraft: prepareDraft ? true : undefined, mutation: { requestId, changes: [{
      projectId, parents: active ? [active.revision] : [], name: projectName.data, doc,
    }] } }, async revision => { await onPublished?.(target(revision)); });
    if (outcome.status !== "published") return;
    return target(outcome.publications[0].revision);
  });

  const copyBrowserProjects = () => run(async () => {
    const selected = await writableFolder();
    const backup = await exportProjectLibrary();
    const existing = new Set((await new ConnectedLibrary(selected).list({ includeDeleted: true })).map(project => project.projectId));
    const changes = backup.projects.flatMap(project => {
      if (existing.has(project.id)) return [];
      try {
        return [{ projectId: project.id, name: project.name, doc: readFolderProject(project.doc), parents: [] }];
      } catch (error) {
        if (!(error instanceof LibraryError)) throw error;
        return [];
      }
    });
    if (changes.length > FOLDER_LIMITS.changes) {
      throw new LibraryError("resource-limit", `Copy up to ${FOLDER_LIMITS.changes} projects at once. Open and save individual projects for larger libraries.`);
    }
    if (!changes.length) { setMessage("No new readable browser projects to copy."); return; }
    const outcome = await apply(selected, { kind: "commit", mutation: { requestId: crypto.randomUUID(), changes } });
    if (outcome.status === "published") setMessage(`Copied ${changes.length} browser projects to the folder.`);
  });

  const importBackup = (input: unknown) => run(async () => {
    const selected = await writableFolder();
    if (!withinImportLimits(input, true)) throw new LibraryError("resource-limit", IMPORT_LIMIT_ERROR);
    const parsed = libraryBackupSchema.safeParse(input);
    if (!parsed.success) throw new LibraryError("validation", "This is not a supported Pocketry library backup.");
    if (parsed.data.projects.length > FOLDER_LIMITS.changes) {
      throw new LibraryError("resource-limit", `Import up to ${FOLDER_LIMITS.changes} projects at a time.`);
    }
    const requestId = crypto.randomUUID();
    if (!parsed.data.projects.length) return 0;
    const changes = await Promise.all(parsed.data.projects.map(async (project, index) => ({
      projectId: await assignedProjectId(requestId, index), parents: [], name: project.name.trim(),
      doc: readFolderProject(project.doc),
    })));
    const outcome = await apply(selected, { kind: "commit", mutation: { requestId, changes } });
    if (outcome.status === "published") return changes.length;
  });

  const withProject = (projectId: string, revision: string, useProject: (doc: ProjectDoc, target: FolderDraft) => void | Promise<void>) => run(async () => {
    if (!folder) return;
    const value = await new ConnectedLibrary(folder).read(projectId, revision);
    await useProject(value.doc, { connectionId: folder.id, projectId, revision: value.revision, name: value.name });
    return true;
  });

  const changeProject = (projectId: string, revision: string, change: { kind: "copy" } | { kind: "rename"; name: string } | { kind: "remove" }) => run(async () => {
    const selected = await writableFolder();
    const value = await new ConnectedLibrary(selected).read(projectId, revision);
    const requestId = crypto.randomUUID();
    const name = change.kind === "rename" ? projectNameSchema.safeParse(change.name) : undefined;
    if (name && !name.success) throw new LibraryError("validation", "Enter a project name up to 80 characters.");
    const mutation: Change = change.kind === "copy"
      ? { projectId: await assignedProjectId(requestId), parents: [], name: `${value.name.slice(0, 73).trimEnd()} (copy)`, doc: value.doc }
      : { projectId, parents: [revision], name: name?.data ?? value.name, doc: change.kind === "remove" ? null : value.doc };
    const outcome = await apply(selected, { kind: "commit", mutation: { requestId, changes: [mutation] } });
    if (outcome.status !== "published") return;
    setMessage(change.kind === "remove" ? "Project removed from the folder library."
      : change.kind === "copy" ? "Project copied in the folder." : "Project renamed in the folder.");
    return true;
  });

  return {
    supported, folder, projects, pending, canWrite, legacyFolder, canRecoverLegacy: legacyFolder || mixedFolder,
    busy, message, error, refresh, save, copyBrowserProjects, withProject, changeProject,
    importBackup,
    recoverLegacy: () => run(async () => {
      if (!folder || (!legacyFolder && !mixedFolder)) return;
      if (mixedFolder) {
        const selected = await writableFolder();
        await publishRecoveredLibrary(await recoverLegacyBackup(selected), selected);
        await load(selected);
        setMessage("Projects recovered to your local folder.");
        return true;
      }
      let destination = await folder.findCompletedRecovery();
      if (!destination) {
        const backup = await recoverLegacyBackup(folder);
        if (!backup.projects.length) throw new LibraryError("not-found", "No saved projects to recover.");
        destination = await folder.createRecoveryFolder();
        await publishRecoveredLibrary(backup, destination);
      }
      await load(await folder.activateRecovery(destination));
      setMessage("Projects recovered to your local folder.");
      return true;
    }),
    exportBackup: (omitHistory = false) => run(async () => {
      if (!folder || !await folder.canWrite()) throw new LibraryError("permission", "Restore folder access in Library before exporting.");
      return new ConnectedLibrary(folder).backup({ omitHistory });
    }),
    disconnect: () => run(async () => { await BrowserLibraryFolder.disconnect(); await load(null); return true; }),
    connect: () => run(async () => { const selected = await BrowserLibraryFolder.choose(); await load(selected); return selected; }),
    renew: () => run(async () => {
      if (!folder || !await folder.renew()) throw new LibraryError("permission", "Folder access wasn’t granted.");
      await load(folder);
    }),
    resume: (intent: FolderIntent, onPublished: (target: FolderDraft, draft: { requestId: string } | { base: FolderDraft }) => Promise<void>) => run(async () => {
      if (!folder) return;
      await apply(folder, intent, async revision => {
        if (intent.kind !== "commit") return;
        const [change] = intent.mutation.changes;
        const target = { connectionId: folder.id, projectId: change.projectId, revision, name: change.name };
        if (intent.workingDraft) await onPublished(target, { requestId: intent.mutation.requestId });
        else if (intent.draftBase?.connectionId === folder.id) await onPublished(target, { base: intent.draftBase });
      });
    }),
    keepBoth: (project: FolderProject, keep: string) => run(async () => {
      const selected = await writableFolder();
      await apply(selected, { kind: "keep-both", requestId: crypto.randomUUID(), projectId: project.projectId,
        expected: project.heads.map(head => head.revision), keep });
    }),
  };
}

export type FolderLibrary = ReturnType<typeof useFolderLibrary>;
