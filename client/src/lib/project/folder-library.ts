import { folderRevisionSchema, type FolderRevision, type StoredProject } from "@shared/gridfinity/library";

/** Small structural interfaces for the user-visible File System Access API.
 * This deliberately does not use the browser's origin-private filesystem. */
export interface LibraryFileHandle {
  kind: "file";
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface LibraryDirectoryHandle {
  kind: "directory";
  name: string;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LibraryDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LibraryFileHandle>;
  entries(): AsyncIterableIterator<[string, LibraryDirectoryHandle | LibraryFileHandle]>;
}
type FolderPickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: "readwrite" }) => Promise<LibraryDirectoryHandle>;
};

export function supportsLibraryFolder(): boolean {
  return typeof window !== "undefined" && typeof (window as FolderPickerWindow).showDirectoryPicker === "function";
}

/** Call directly from the click handler, before any asynchronous work. */
export function pickLibraryFolder(): Promise<LibraryDirectoryHandle> {
  const picker = (window as FolderPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("Folder access is unavailable. Use desktop Chrome or Edge, or export a library backup.");
  return picker.call(window, { id: "pocketry-library", mode: "readwrite" });
}

export type FolderState = "browser" | "saving" | "saved" | "permission-required" | "conflict" | "error";
export interface FolderStatus { state: FolderState; folderName: string | null; message?: string }
let status: FolderStatus = { state: "browser", folderName: null };
const listeners = new Set<() => void>();
export const getFolderStatus = () => status;
export function subscribeFolderStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportFolderStatus(next: FolderStatus): void {
  status = next;
  listeners.forEach(listener => listener());
}
export class FolderConflictError extends Error {
  constructor() { super("The folder changed in another tab or browser. Keep both versions to preserve your pending work and load the latest library."); }
}
export class FolderPermissionError extends Error {
  constructor() { super("Folder permission is required. Reconnect to resume saving; your current design can still be exported."); }
}
export function reportFolderError(cause: unknown, folderName: string): void {
  const permission = cause instanceof FolderPermissionError || (cause instanceof Error && cause.name === "NotAllowedError");
  reportFolderStatus({ folderName, state: permission ? "permission-required" : cause instanceof FolderConflictError ? "conflict" : "error",
    message: cause instanceof Error ? cause.message : "Could not read or save the folder. Export your current project to keep your work." });
}

const DIRECTORY = "pocketry-library";
const SUFFIX = ".pocketry-library.json";
const sameHeads = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export const projectContentKey = (project: StoredProject) => JSON.stringify({ id: project.id, name: project.name, doc: project.doc });
const contentKey = (projects: StoredProject[]) => JSON.stringify(projects.map(projectContentKey));

/** Append-only full snapshots: no shared manifest or project file is overwritten.
 * Each completed revision names all heads it extends. A racing write therefore
 * produces two retained heads, even if it happens after the last conflict check.
 * Web Locks alone cannot protect writes from different browsers/profiles.
 */
export class FolderLibrary {
  heads: string[] = [];
  projects: StoredProject[] = [];
  constructor(readonly directory: LibraryDirectoryHandle) {}

  private async scan(): Promise<{ revisions: Map<string, FolderRevision>; heads: string[] }> {
    if (await this.directory.queryPermission({ mode: "readwrite" }) !== "granted") throw new FolderPermissionError();
    const revisions = new Map<string, FolderRevision>();
    for await (const [name, handle] of this.directory.entries()) {
      if (!name.endsWith(SUFFIX)) continue;
      if (handle.kind !== "file") throw new Error(`Unreadable library revision: ${name}. Existing files have been kept intact.`);
      const text = await (await handle.getFile()).text();
      // Creating a new file exposes an empty entry before its writable stream
      // closes atomically. Empty entries are unfinished writes, never heads.
      if (!text) continue;
      let revision: FolderRevision;
      try { revision = folderRevisionSchema.parse(JSON.parse(text)); }
      catch { throw new Error(`Unreadable or newer library revision: ${name}. Existing files have been kept intact.`); }
      if (name !== `${revision.id}${SUFFIX}`) throw new Error(`Library revision identity mismatch: ${name}.`);
      revisions.set(revision.id, revision);
    }
    const parents = new Set<string>();
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error("The library revision history is cyclic. Files have been kept intact.");
      const revision = revisions.get(id);
      if (!revision) throw new Error("A library revision is missing. Restore the missing files before saving.");
      visiting.add(id);
      for (const parent of revision.parents) { parents.add(parent); visit(parent); }
      visiting.delete(id);
      visited.add(id);
    };
    revisions.forEach(revision => visit(revision.id));
    return { revisions, heads: [...revisions.keys()].filter(id => !parents.has(id)).sort() };
  }

  static async open(root: LibraryDirectoryHandle, create: boolean, expectedHeads?: string[]): Promise<FolderLibrary> {
    if (await root.queryPermission({ mode: "readwrite" }) !== "granted") throw new FolderPermissionError();
    const directory = await root.getDirectoryHandle(DIRECTORY, { create });
    const library = new FolderLibrary(directory);
    const { revisions, heads } = await library.scan();
    library.heads = expectedHeads ?? heads;
    library.projects = library.heads.length === 1 ? revisions.get(library.heads[0])?.projects ?? [] : [];
    if (library.heads.some(id => !revisions.has(id))) throw new Error("The saved library revision is missing. Files have been kept intact.");
    return library;
  }

  async assertCurrent(): Promise<void> {
    const { heads, revisions } = await this.scan();
    if (heads.length > 1 || !sameHeads(heads, this.heads) ||
      (heads.length === 1 && JSON.stringify(revisions.get(heads[0])!.projects) !== JSON.stringify(this.projects))) throw new FolderConflictError();
  }

  async write(projects: StoredProject[], resolving = false): Promise<void> {
    const { heads, revisions } = await this.scan();
    if ((!resolving && (heads.length > 1 || (heads.length === 1 && JSON.stringify(revisions.get(heads[0])!.projects) !== JSON.stringify(this.projects)))) ||
      !sameHeads(heads, this.heads)) throw new FolderConflictError();
    if (!resolving && heads.length === 1 && contentKey(projects) === contentKey(this.projects)) return;
    const revision: FolderRevision = { format: "pocketry-folder-revision", schemaVersion: 1,
      id: crypto.randomUUID(), parents: [...heads], projects };
    folderRevisionSchema.parse(revision);
    const text = JSON.stringify(revision);
    const file = await this.directory.getFileHandle(`${revision.id}${SUFFIX}`, { create: true });
    const writable = await file.createWritable();
    try { await writable.write(text); await writable.close(); }
    catch (cause) { await writable.abort().catch(() => undefined); throw cause; }
    if (await (await file.getFile()).text() !== text) throw new Error("The folder write could not be verified. Export your current project and retry.");
    this.heads = [revision.id];
    this.projects = projects;
    await this.assertCurrent();
  }

  /** Explicit recovery unions current heads and the caller's pending project.
   * Differing versions of an identity get a fresh ID and a visible suffix.
   * No revision is deleted, including versions removed from the current list. */
  async keepBoth(pending?: StoredProject): Promise<void> {
    const { heads, revisions } = await this.scan();
    const projects: StoredProject[] = [];
    const seen = new Set<string>();
    for (const project of [...heads.flatMap(id => revisions.get(id)!.projects), ...(pending ? [pending] : [])]) {
      const key = projectContentKey(project);
      if (seen.has(key)) continue;
      seen.add(key);
      let next = project;
      if (projects.some(existing => existing.id === next.id || existing.name === next.name)) {
        let suffix = 1;
        let name: string;
        do {
          const ending = suffix === 1 ? " (conflict)" : ` (conflict ${suffix})`;
          name = `${project.name.slice(0, 80 - ending.length)}${ending}`;
          suffix++;
        } while (projects.some(existing => existing.name === name));
        next = { ...project, id: crypto.randomUUID(), name,
          doc: { ...project.doc, name } };
      }
      projects.push(next);
    }
    this.heads = heads;
    await this.write(projects, true);
  }
}
