// Shared test adapter. Production uses a real IndexedDB compare-and-write
// transaction; tests keep the existing idb-keyval spies for failure injection.
import { vi } from "vitest";

vi.mock("@/lib/project/storage", async importOriginal => {
  const actual = await importOriginal<typeof import("./storage")>();
  const { get, set, setMany } = await import("idb-keyval");
  const read = async () => ({
    current: structuredClone(await get(actual.CURRENT_PROJECT_KEY)),
    library: structuredClone(await get(actual.PROJECT_LIBRARY_KEY)),
  });
  let commits: Promise<void> = Promise.resolve();
  return {
    ...actual,
    readProjectStorage: read,
    commitProjectStorage: (expected: import("./storage").ProjectStorageSnapshot, entries: [string, unknown][]) => {
      const result = commits.then(async () => {
        if (!actual.sameProjectStorage(expected, await read())) throw new actual.ProjectStorageConflictError();
        if (entries.length === 1) await set(entries[0][0], entries[0][1]);
        else await setMany(entries);
      });
      commits = result.catch(() => {});
      return result;
    },
  };
});
