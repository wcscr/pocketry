import { get, set, setMany } from "idb-keyval";
import {
  libraryBackupSchema,
  projectLibrarySchema,
  PROJECT_LIBRARY_VERSION,
  PROJECT_NAME_MAX_LENGTH,
  type LibraryBackup,
  type StoredProject,
  type StoredProjectLibrary,
} from "@shared/gridfinity/library";

import {
  parseProjectDoc,
  type ProjectDoc,
} from "@shared/gridfinity/project";

/**
 * Project persistence over IndexedDB (`idb-keyval`, Apache-2.0).
 *
 * `CURRENT_PROJECT_KEY` deliberately retains the original key: it is the
 * crash-safe working copy that resumes whenever the user returns to Bin. The
 * separate library stores named snapshots and identifies which named project
 * receives subsequent autosaves. This gives every browser the same Save/Open
 * workflow without pretending that websites control the OS download folder.
 */

// Legacy namespace retained so the Pocketry rebrand never strands existing
// browser-local projects or silently starts users from an empty library.
const CURRENT_PROJECT_KEY = "tooltrace:project:v1";
const PROJECT_LIBRARY_KEY = "tooltrace:project-library:v1";
export interface ProjectLibraryItem {
  id: string;
  name: string;
  updatedAt: string;
}

export interface ProjectLibrarySnapshot {
  activeProjectId: string | null;
  projects: ProjectLibraryItem[];
}

export interface OpenedLibraryProject {
  doc: ProjectDoc;
  project: ProjectLibraryItem;
  library: ProjectLibrarySnapshot;
}

export class ProjectNameConflictError extends Error {
  constructor(name: string) {
    super(`A project named “${name}” already exists.`);
    this.name = "ProjectNameConflictError";
  }
}

const EMPTY_LIBRARY: StoredProjectLibrary = {
  schemaVersion: PROJECT_LIBRARY_VERSION,
  activeProjectId: null,
  projects: [],
};

let libraryMutationQueue: Promise<void> = Promise.resolve();

function cleanProjectName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("Enter a project name.");
  if (cleaned.length > PROJECT_NAME_MAX_LENGTH) {
    throw new Error(`Project names must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`);
  }
  return cleaned;
}

function makeProjectId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseStoredLibrary(input: unknown): StoredProjectLibrary {
  const result = projectLibrarySchema.safeParse(input);
  if (!result.success) return EMPTY_LIBRARY;
  const projects = result.data.projects.map((project) => {
    const doc = parseProjectDoc(project.doc);
    return doc ? { ...project, doc } : project;
  });
  const activeProjectId = projects.some(
    (project) =>
      project.id === result.data.activeProjectId && parseProjectDoc(project.doc) !== null,
  )
    ? result.data.activeProjectId
    : null;
  return { ...result.data, activeProjectId, projects };
}

async function readStoredLibrary(): Promise<StoredProjectLibrary> {
  const raw: unknown = await get(PROJECT_LIBRARY_KEY);
  if (raw != null && !projectLibrarySchema.safeParse(raw).success) {
    throw new Error("The saved library is unreadable. It has been kept intact; download your current work before recovering it.");
  }
  return parseStoredLibrary(raw);
}

function toSnapshot(library: StoredProjectLibrary): ProjectLibrarySnapshot {
  return {
    activeProjectId: library.activeProjectId,
    projects: library.projects
      .filter((project) => parseProjectDoc(project.doc) !== null)
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
  };
}

function mutateLibrary<T>(
  mutation: (library: StoredProjectLibrary) => Promise<T>,
): Promise<T> {
  const result = libraryMutationQueue.then(async () => mutation(await readStoredLibrary()));
  libraryMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function loadProjectDoc(): Promise<ProjectDoc | null> {
  await libraryMutationQueue;
  try {
    return parseProjectDoc(await get(CURRENT_PROJECT_KEY));
  } catch {
    return null;
  }
}

/** Normalize only defaults that hydration adds without an edit. A single
 * history baseline has no undo/redo steps; longer histories must match in full.
 */
function restoredDocumentKey(doc: ProjectDoc): string {
  return JSON.stringify({ ...doc, keepBinSize: doc.keepBinSize ?? false,
    history: doc.history?.stack.length === 1 ? undefined : doc.history });
}

/** On restore, reconnect an identical named copy. If a same-name saved project
 * differs, preserve the working copy as a new library entry instead of leaving
 * it stranded as a draft or overwriting either version. Recovery failures reject
 * so the UI can keep the document open and pause autosave until it is saved.
 */
export async function loadProjectLibrary(restoredDoc?: ProjectDoc | null): Promise<ProjectLibrarySnapshot> {
  try {
    return await mutateLibrary(async (library) => {
      if (!library.activeProjectId && restoredDoc?.name) {
        const doc = parseProjectDoc(restoredDoc);
        if (!doc?.name) return toSnapshot(library);
        const sourceName = doc.name;
        const key = restoredDocumentKey(doc);
        const current = parseProjectDoc(await get(CURRENT_PROJECT_KEY));
        // A newer workspace may already have replaced the document while this
        // restore waited for queued writes. Never attach that newer draft.
        if (!current || restoredDocumentKey(current) !== key) return toSnapshot(library);
        const namedProjects = library.projects.filter((project) =>
          project.name.localeCompare(sourceName, undefined, { sensitivity: "accent" }) === 0,
        );
        const matches = namedProjects.filter((project) => {
          const saved = parseProjectDoc({ ...project.doc, name: project.name });
          return saved !== null && restoredDocumentKey(saved) === key;
        });
        if (matches.length === 1) {
          const next = { ...library, activeProjectId: matches[0].id };
          // Commit the recovered identity before autosave can use it. Keep the
          // working document (including undo/redo history) untouched.
          await set(PROJECT_LIBRARY_KEY, next);
          return toSnapshot(next);
        }
        if (namedProjects.length > 0) {
          const name = availableProjectName(sourceName, library.projects, "recovered");
          let id = makeProjectId();
          while (library.projects.some((project) => project.id === id)) id = makeProjectId();
          const recoveredDoc = { ...doc, name };
          const recovered = { id, name, doc: recoveredDoc, updatedAt: new Date().toISOString() };
          const next = { ...library, activeProjectId: id, projects: [...library.projects, recovered] };
          await setMany([[CURRENT_PROJECT_KEY, recoveredDoc], [PROJECT_LIBRARY_KEY, next]]);
          return toSnapshot(next);
        }
      }
      return toSnapshot(library);
    });
  }
  catch (cause) {
    if (restoredDoc) throw cause;
    return toSnapshot(EMPTY_LIBRARY);
  }
}

/** Include pending edits to the active named project without waiting for autosave.
 * Unsupported stored documents are included verbatim, never silently omitted.
 */
export async function exportProjectLibrary(currentDoc?: ProjectDoc): Promise<LibraryBackup> {
  return mutateLibrary(async (library) => ({
    format: "pocketry-library",
    schemaVersion: PROJECT_LIBRARY_VERSION,
    projects: library.projects.map((project) =>
      currentDoc && project.id === library.activeProjectId
        ? { ...project, doc: { ...currentDoc, name: project.name }, updatedAt: new Date().toISOString() }
        : project,
    ),
  }));
}

export interface LibraryImportResult {
  library: ProjectLibrarySnapshot;
  imported: number;
  upgraded: number;
  renamed: number;
}

/** Imports and recovered working copies never overwrite a same-name project. */
function availableProjectName(name: string, projects: readonly StoredProject[], reason: "imported" | "recovered"): string {
  let candidate = name;
  let suffix = 1;
  while (projects.some((project) => project.name.localeCompare(candidate, undefined, { sensitivity: "accent" }) === 0)) {
    const ending = suffix === 1 ? ` (${reason})` : ` (${reason} ${suffix})`;
    candidate = `${name.slice(0, PROJECT_NAME_MAX_LENGTH - ending.length).trimEnd()}${ending}`;
    suffix++;
  }
  return candidate;
}

/** Save a project file as a new library entry and open it in one transaction. */
export async function importProjectToLibrary(input: ProjectDoc): Promise<OpenedLibraryProject> {
  const doc = parseProjectDoc(input);
  if (!doc) throw new Error("Not a supported Pocketry project file.");
  const sourceName = cleanProjectName(doc.name ?? "Imported project");
  return mutateLibrary(async (library) => {
    const name = availableProjectName(sourceName, library.projects, "imported");
    let id = makeProjectId();
    while (library.projects.some((project) => project.id === id)) id = makeProjectId();
    const project = { id, name, updatedAt: new Date().toISOString() };
    const namedDoc = { ...doc, name };
    const next = { ...library, activeProjectId: id, projects: [...library.projects, { ...project, doc: namedDoc }] };
    // A failed import must preserve both the outgoing working copy and its
    // autosave target; writing these keys separately can leave them mismatched.
    await setMany([[CURRENT_PROJECT_KEY, namedDoc], [PROJECT_LIBRARY_KEY, next]]);
    return { doc: namedDoc, project, library: toSnapshot(next) };
  });
}

/** Validate and migrate the entire backup before one atomic library write.
 * Conflicting entries become independent copies; the current design stays open.
 */
export async function importProjectLibrary(input: unknown): Promise<LibraryImportResult> {
  const backup = libraryBackupSchema.safeParse(input);
  if (!backup.success) {
    throw new Error("Not a supported Pocketry library JSON file. No designs were imported.");
  }
  let upgraded = 0;
  const importedProjects = backup.data.projects.map((project) => {
    const doc = parseProjectDoc(project.doc);
    if (!doc) {
      throw new Error(`“${project.name}” is invalid or uses a newer Pocketry version. No designs were imported.`);
    }
    if (project.doc.schemaVersion !== doc.schemaVersion) upgraded++;
    return { ...project, name: cleanProjectName(project.name), doc };
  });
  return mutateLibrary(async (library) => {
    const projects = [...library.projects];
    const ids = new Set(projects.map((project) => project.id));
    let renamed = 0;
    for (const project of importedProjects) {
      const name = availableProjectName(project.name, projects, "imported");
      if (name !== project.name) renamed++;
      let id = project.id;
      while (ids.has(id)) id = makeProjectId();
      ids.add(id);
      projects.push({ ...project, id, name, doc: { ...project.doc, name } });
    }
    const next = { ...library, projects };
    if (importedProjects.length > 0) await set(PROJECT_LIBRARY_KEY, next);
    return { library: toSnapshot(next), imported: importedProjects.length, upgraded, renamed };
  });
}

/** Best-effort working-copy autosave, also updating the active named project. */
export async function saveProjectDoc(
  doc: ProjectDoc,
  expectedProjectId?: string | null,
): Promise<boolean> {
  try {
    await mutateLibrary(async (library) => {
      // A delayed write belongs to the project that scheduled it, even if a
      // different project has since become active. Check inside the queue.
      if (expectedProjectId !== undefined && library.activeProjectId !== expectedProjectId) {
        throw new Error("The autosave belongs to a different project.");
      }
      if (!parseProjectDoc(doc)) throw new Error("The project history is inconsistent.");
      const previous: unknown = await get(CURRENT_PROJECT_KEY);
      if (previous != null && parseProjectDoc(previous) === null) {
        throw new Error("The existing working copy is unreadable and has been preserved.");
      }
      if (!library.activeProjectId) {
        await set(CURRENT_PROJECT_KEY, doc);
        return;
      }
      const index = library.projects.findIndex(
        (project) => project.id === library.activeProjectId,
      );
      if (index < 0) return;
      const projects = [...library.projects];
      projects[index] = {
        ...projects[index],
        doc,
        updatedAt: new Date().toISOString(),
      };
      await setMany([[CURRENT_PROJECT_KEY, doc], [PROJECT_LIBRARY_KEY, { ...library, projects }]]);
    });
    // Clear only queued shapes whose placements have reached durable storage.
    try {
      const queued: unknown = JSON.parse(sessionStorage.getItem("pocketry:queued-tools") ?? "[]");
      if (Array.isArray(queued)) {
        const placedIds = new Set(doc.cutouts.map((cutout) => cutout.shapeId));
        const remaining = queued.filter((shape: unknown) =>
          typeof shape !== "object" || shape === null || !("id" in shape) ||
          typeof shape.id !== "string" || !placedIds.has(shape.id),
        );
        sessionStorage.setItem("pocketry:queued-tools", JSON.stringify(remaining));
      }
    } catch { /* Session recovery may be unavailable. */ }
    return true;
  } catch {
    // Quota or unavailable storage: the in-memory session stays authoritative.
    return false;
  }
}

/** Creates or renames the active named project and makes this doc its baseline. */
export async function saveProjectToLibrary(
  doc: ProjectDoc,
  name: string,
  projectId: string | null,
): Promise<ProjectLibrarySnapshot> {
  const cleanName = cleanProjectName(name);
  return mutateLibrary(async (library) => {
    const conflict = library.projects.some(
      (project) =>
        project.id !== projectId &&
        project.name.localeCompare(cleanName, undefined, { sensitivity: "accent" }) === 0,
    );
    if (conflict) throw new ProjectNameConflictError(cleanName);

    const id =
      projectId && library.projects.some((project) => project.id === projectId)
        ? projectId
        : makeProjectId();
    const now = new Date().toISOString();
    const namedDoc = { ...doc, name: cleanName };
    const replacement: StoredProject = { id, name: cleanName, updatedAt: now, doc: namedDoc };
    const projects = library.projects.some((project) => project.id === id)
      ? library.projects.map((project) => (project.id === id ? replacement : project))
      : [...library.projects, replacement];
    const next: StoredProjectLibrary = {
      schemaVersion: PROJECT_LIBRARY_VERSION,
      activeProjectId: id,
      projects,
    };
    await setMany([[CURRENT_PROJECT_KEY, namedDoc], [PROJECT_LIBRARY_KEY, next]]);
    return toSnapshot(next);
  });
}

/** Copy a saved project, including pending edits when copying the open project. */
export async function duplicateProjectInLibrary(
  projectId: string,
  currentDoc?: ProjectDoc,
): Promise<{ library: ProjectLibrarySnapshot; project: ProjectLibraryItem }> {
  return mutateLibrary(async (library) => {
    const stored = library.projects.find((project) => project.id === projectId);
    if (!stored) throw new Error("That project is no longer in this browser's library.");
    const doc = parseProjectDoc(library.activeProjectId === projectId && currentDoc ? currentDoc : stored.doc);
    if (!doc) throw new Error("That project was saved by an unsupported Pocketry version.");
    let name: string;
    let suffix = 1;
    do {
      const ending = suffix === 1 ? " (copy)" : ` (copy ${suffix})`;
      name = `${stored.name.slice(0, PROJECT_NAME_MAX_LENGTH - ending.length).trimEnd()}${ending}`;
      suffix++;
    } while (library.projects.some((project) => project.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0));
    let id = makeProjectId();
    while (library.projects.some((project) => project.id === id)) id = makeProjectId();
    const project = { id, name, updatedAt: new Date().toISOString() };
    const projects = [...library.projects];
    projects.splice(projects.indexOf(stored) + 1, 0, { ...project, doc: { ...doc, name } });
    const next = { ...library, projects };
    await set(PROJECT_LIBRARY_KEY, next);
    return { library: toSnapshot(next), project };
  });
}

/** Rename a saved entry without opening it or replacing the working copy. */
export async function renameProjectInLibrary(
  projectId: string,
  name: string,
): Promise<ProjectLibrarySnapshot> {
  const cleanName = cleanProjectName(name);
  return mutateLibrary(async (library) => {
    const stored = library.projects.find((project) => project.id === projectId);
    if (!stored) throw new Error("That project is no longer in this browser's library.");
    const doc = parseProjectDoc(stored.doc);
    if (!doc) throw new Error("That project was saved by an unsupported Pocketry version.");
    if (library.projects.some((project) => project.id !== projectId &&
      project.name.localeCompare(cleanName, undefined, { sensitivity: "accent" }) === 0)) {
      throw new ProjectNameConflictError(cleanName);
    }
    const renamed = { ...stored, name: cleanName, doc: { ...doc, name: cleanName }, updatedAt: new Date().toISOString() };
    const next = { ...library, projects: library.projects.map((project) => project.id === projectId ? renamed : project) };
    await set(PROJECT_LIBRARY_KEY, next);
    return toSnapshot(next);
  });
}

export async function openProjectFromLibrary(
  projectId: string,
): Promise<OpenedLibraryProject> {
  return mutateLibrary(async (library) => {
    const stored = library.projects.find((project) => project.id === projectId);
    if (!stored) throw new Error("That project is no longer in this browser's library.");
    const doc = parseProjectDoc(stored.doc);
    if (!doc) throw new Error("That project was saved by an unsupported Pocketry version.");
    const next = { ...library, activeProjectId: stored.id };
    await setMany([[CURRENT_PROJECT_KEY, doc], [PROJECT_LIBRARY_KEY, next]]);
    return {
      doc,
      project: { id: stored.id, name: stored.name, updatedAt: stored.updatedAt },
      library: toSnapshot(next),
    };
  });
}

export async function deleteProjectFromLibrary(
  projectId: string,
): Promise<ProjectLibrarySnapshot> {
  return mutateLibrary(async (library) => {
    const next: StoredProjectLibrary = {
      ...library,
      activeProjectId:
        library.activeProjectId === projectId ? null : library.activeProjectId,
      projects: library.projects.filter((project) => project.id !== projectId),
    };
    await set(PROJECT_LIBRARY_KEY, next);
    return toSnapshot(next);
  });
}

/** Replaces the working copy and detaches it from any named library project. */
export async function startNewProject(doc: ProjectDoc): Promise<ProjectLibrarySnapshot> {
  return mutateLibrary(async (library) => {
    const next = { ...library, activeProjectId: null };
    await setMany([[CURRENT_PROJECT_KEY, doc], [PROJECT_LIBRARY_KEY, next]]);
    return toSnapshot(next);
  });
}

export interface DebouncedProjectSaver {
  (doc: ProjectDoc, projectId?: string | null): void;
  cancel(): void;
  /** Persist the latest committed edit before leaving the workspace. */
  flush(): Promise<boolean>;
}

/** A trailing-edge saver carrying the identity of the project being edited. */
export function createDebouncedProjectSaver(delayMs = 500, onSaved?: (success: boolean) => void): DebouncedProjectSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { doc: ProjectDoc; projectId?: string | null } | null = null;
  let writing: Promise<boolean> = Promise.resolve(true);
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  const flush = (): Promise<boolean> => {
    const next = pending;
    cancel();
    if (next) {
      writing = saveProjectDoc(next.doc, next.projectId).then((success) => {
        onSaved?.(success);
        return success;
      });
    }
    return writing;
  };
  return Object.assign((doc: ProjectDoc, projectId?: string | null) => {
    cancel();
    pending = { doc, projectId };
    timer = setTimeout(() => { void flush(); }, delayMs);
  }, { cancel, flush });
}
