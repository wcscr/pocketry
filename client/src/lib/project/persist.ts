import { get, set } from "idb-keyval";
import { z } from "zod";

import {
  parseProjectDoc,
  projectDocSchema,
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
const PROJECT_LIBRARY_VERSION = 1 as const;
const PROJECT_NAME_MAX_LENGTH = 80;

const storedProjectSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(PROJECT_NAME_MAX_LENGTH),
    updatedAt: z.string().datetime(),
    doc: projectDocSchema,
  })
  .strict();

const projectLibrarySchema = z
  .object({
    schemaVersion: z.literal(PROJECT_LIBRARY_VERSION),
    activeProjectId: z.string().min(1).max(128).nullable(),
    projects: z.array(storedProjectSchema),
  })
  .strict();

// Library version 1 predates several ProjectDoc migrations. Parse its stable
// envelope independently, then migrate each embedded document below.
const storedProjectEnvelopeSchema = storedProjectSchema.extend({ doc: z.unknown() });
const projectLibraryEnvelopeSchema = projectLibrarySchema.extend({
  projects: z.array(storedProjectEnvelopeSchema),
});

type StoredProject = z.infer<typeof storedProjectSchema>;
type StoredProjectLibrary = z.infer<typeof projectLibrarySchema>;

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
  const result = projectLibraryEnvelopeSchema.safeParse(input);
  if (!result.success) return EMPTY_LIBRARY;
  const projects = result.data.projects.flatMap((project) => {
    const doc = parseProjectDoc(project.doc);
    return doc ? [{ ...project, doc }] : [];
  });
  const activeProjectId = projects.some(
    (project) => project.id === result.data.activeProjectId,
  )
    ? result.data.activeProjectId
    : null;
  return { ...result.data, projects, activeProjectId };
}

async function readStoredLibrary(): Promise<StoredProjectLibrary> {
  try {
    return parseStoredLibrary(await get(PROJECT_LIBRARY_KEY));
  } catch {
    return EMPTY_LIBRARY;
  }
}

function toSnapshot(library: StoredProjectLibrary): ProjectLibrarySnapshot {
  return {
    activeProjectId: library.activeProjectId,
    projects: library.projects
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
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
  return toSnapshot(await readStoredLibrary());
}

/** Best-effort working-copy autosave, also updating the active named project. */
export async function saveProjectDoc(doc: ProjectDoc): Promise<void> {
  try {
    await mutateLibrary(async (library) => {
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
  } catch {
    // Quota or unavailable storage: the in-memory session stays authoritative.
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
    const replacement: StoredProject = { id, name: cleanName, updatedAt: now, doc };
    const projects = library.projects.some((project) => project.id === id)
      ? library.projects.map((project) => (project.id === id ? replacement : project))
      : [...library.projects, replacement];
    const next: StoredProjectLibrary = {
      schemaVersion: PROJECT_LIBRARY_VERSION,
      activeProjectId: id,
      projects,
    };
    await set(CURRENT_PROJECT_KEY, doc);
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
    const next = { ...library, activeProjectId: stored.id };
    await set(CURRENT_PROJECT_KEY, stored.doc);
    await set(PROJECT_LIBRARY_KEY, next);
    return {
      doc: stored.doc,
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
export function createDebouncedProjectSaver(delayMs = 500): DebouncedProjectSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const saver = ((doc: ProjectDoc) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveProjectDoc(doc);
    }, delayMs);
  }) as DebouncedProjectSaver;
  saver.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return saver;
}
