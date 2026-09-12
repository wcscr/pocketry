import { get, set } from "idb-keyval";
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
  try {
    return parseProjectDoc(await get(CURRENT_PROJECT_KEY));
  } catch {
    return null;
  }
}

export async function loadProjectLibrary(): Promise<ProjectLibrarySnapshot> {
  await libraryMutationQueue;
  try { return toSnapshot(await readStoredLibrary()); }
  catch { return toSnapshot(EMPTY_LIBRARY); }
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
      let name = project.name;
      let suffix = 1;
      while (projects.some((existing) =>
        existing.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
      )) {
        const ending = suffix === 1 ? " (imported)" : ` (imported ${suffix})`;
        name = `${project.name.slice(0, PROJECT_NAME_MAX_LENGTH - ending.length).trimEnd()}${ending}`;
        suffix++;
      }
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
export async function saveProjectDoc(doc: ProjectDoc): Promise<boolean> {
  try {
    await mutateLibrary(async (library) => {
      const previous: unknown = await get(CURRENT_PROJECT_KEY);
      if (previous != null && parseProjectDoc(previous) === null) {
        throw new Error("The existing working copy is unreadable and has been preserved.");
      }
      await set(CURRENT_PROJECT_KEY, doc);
      if (!library.activeProjectId) return;
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
      await set(PROJECT_LIBRARY_KEY, { ...library, projects });
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
    await set(CURRENT_PROJECT_KEY, namedDoc);
    await set(PROJECT_LIBRARY_KEY, next);
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
    await set(CURRENT_PROJECT_KEY, doc);
    await set(PROJECT_LIBRARY_KEY, next);
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
    await set(CURRENT_PROJECT_KEY, doc);
    await set(PROJECT_LIBRARY_KEY, next);
    return toSnapshot(next);
  });
}

export interface DebouncedProjectSaver {
  (doc: ProjectDoc): void;
  cancel(): void;
}

/** A trailing-edge saver; placement drags otherwise emit dozens of writes. */
export function createDebouncedProjectSaver(delayMs = 500, onSaved?: (success: boolean) => void): DebouncedProjectSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const saver = ((doc: ProjectDoc) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveProjectDoc(doc).then((success) => onSaved?.(success));
    }, delayMs);
  }) as DebouncedProjectSaver;
  saver.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return saver;
}
