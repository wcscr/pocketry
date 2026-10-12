import { createStore, getMany, promisifyRequest, type UseStore } from "idb-keyval";

// Keep the original idb-keyval database and keys so existing work stays readable.
export const CURRENT_PROJECT_KEY = "tooltrace:project:v1";
export const PROJECT_LIBRARY_KEY = "tooltrace:project-library:v1";
export interface ProjectStorageSnapshot { current: unknown; library: unknown }

export class ProjectStorageConflictError extends Error {
  constructor() {
    super("Projects changed in another tab. Download a backup of your edits, then reload this tab before continuing. The other tab's saved work has been kept.");
    this.name = "ProjectStorageConflictError";
  }
}

/** Compare the raw stored documents, including unsupported fields and versions. */
export function sameProjectStorage(a: ProjectStorageSnapshot, b: ProjectStorageSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function readProjectStorage(): Promise<ProjectStorageSnapshot> {
  const [current, library] = await getMany<unknown>([CURRENT_PROJECT_KEY, PROJECT_LIBRARY_KEY]);
  return { current, library };
}

let store: UseStore | undefined;
/** Compare and write in one IndexedDB transaction. A second tab cannot slip a
 * write between the stale-copy check and the commit, even without Web Locks.
 */
export async function commitProjectStorage(expected: ProjectStorageSnapshot, entries: [string, unknown][]): Promise<void> {
  store ??= createStore("keyval-store", "keyval");
  await store("readwrite", async objectStore => {
    const completed = promisifyRequest(objectStore.transaction);
    let failure: unknown;
    try {
      const [current, library] = await Promise.all([
        promisifyRequest(objectStore.get(CURRENT_PROJECT_KEY)),
        promisifyRequest(objectStore.get(PROJECT_LIBRARY_KEY)),
      ]);
      if (!sameProjectStorage(expected, { current, library })) throw new ProjectStorageConflictError();
      for (const [key, value] of entries) objectStore.put(value, key);
    } catch (cause) {
      failure = cause;
      try { objectStore.transaction.abort(); } catch { /* A failed request may already have aborted it. */ }
    }
    try { await completed; }
    catch (cause) { throw failure ?? cause; }
  });
}
