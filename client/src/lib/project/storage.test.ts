import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitProjectStorage, CURRENT_PROJECT_KEY, PROJECT_LIBRARY_KEY, readProjectStorage } from "./storage";

const adapter = vi.hoisted(() => ({ run: vi.fn(), getMany: vi.fn() }));
vi.mock("idb-keyval", async importOriginal => ({
  ...await importOriginal<typeof import("idb-keyval")>(),
  createStore: () => (mode: IDBTransactionMode, callback: (store: IDBObjectStore) => unknown) => adapter.run(mode, callback),
  getMany: adapter.getMany,
}));

beforeEach(() => vi.clearAllMocks());

/** Control completion separately from requests so a successful put cannot be
 * mistaken for a durable save. These are the IndexedDB events the adapter owns.
 */
function transactionFixture(current: unknown, library: unknown, putError?: Error) {
  const stored = new Map<string, unknown>([[CURRENT_PROJECT_KEY, current], [PROJECT_LIBRARY_KEY, library]]);
  const pending = new Map<string, unknown>();
  const transaction = {
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    error: null,
    abort: vi.fn(() => queueMicrotask(() => transaction.onabort?.())),
  };
  const objectStore = {
    transaction,
    get: (key: string) => {
      const request = { result: stored.get(key), onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    put: vi.fn((value: unknown, key: string) => {
      if (putError) throw putError;
      pending.set(key, value);
    }),
  };
  adapter.run.mockImplementation((_mode, callback) => callback(objectStore));
  return { stored, objectStore, transaction, finish: () => {
    for (const [key, value] of pending) stored.set(key, value);
    transaction.oncomplete?.();
  } };
}

describe("atomic project storage", () => {
  it("reads the working copy and library together", async () => {
    adapter.getMany.mockResolvedValue([{ name: "Current" }, { projects: [] }]);
    expect(await readProjectStorage()).toEqual({ current: { name: "Current" }, library: { projects: [] } });
    expect(adapter.getMany).toHaveBeenCalledWith([CURRENT_PROJECT_KEY, PROJECT_LIBRARY_KEY]);
  });

  it("waits for transaction completion before reporting both writes as saved", async () => {
    const fixture = transactionFixture("old current", "old library");
    let saved = false;
    const result = commitProjectStorage({ current: "old current", library: "old library" },
      [[CURRENT_PROJECT_KEY, "new current"], [PROJECT_LIBRARY_KEY, "new library"]]).then(() => { saved = true; });
    await vi.waitFor(() => expect(fixture.objectStore.put).toHaveBeenCalledTimes(2));
    expect(adapter.run).toHaveBeenCalledWith("readwrite", expect.any(Function));
    expect(saved).toBe(false);
    expect(fixture.stored.get(CURRENT_PROJECT_KEY)).toBe("old current");
    fixture.finish();
    await result;
    expect(fixture.stored.get(CURRENT_PROJECT_KEY)).toBe("new current");
    expect(fixture.stored.get(PROJECT_LIBRARY_KEY)).toBe("new library");
  });

  it.each(["current", "library"] as const)("aborts without writing if another tab changed the %s", async changed => {
    const snapshot = { current: "original current", library: "original library" };
    const fixture = transactionFixture(changed === "current" ? "newer" : snapshot.current,
      changed === "library" ? "newer" : snapshot.library);
    await expect(commitProjectStorage(snapshot, [[CURRENT_PROJECT_KEY, "stale edit"]])).rejects.toThrow("another tab");
    expect(fixture.transaction.abort).toHaveBeenCalledOnce();
    expect(fixture.objectStore.put).not.toHaveBeenCalled();
  });

  it("preserves the actionable storage failure and aborts both writes", async () => {
    const error = new DOMException("Storage full", "QuotaExceededError");
    const fixture = transactionFixture("old", "library", error);
    await expect(commitProjectStorage({ current: "old", library: "library" },
      [[CURRENT_PROJECT_KEY, "new"], [PROJECT_LIBRARY_KEY, "new library"]])).rejects.toBe(error);
    expect(fixture.stored.get(CURRENT_PROJECT_KEY)).toBe("old");
    expect(fixture.transaction.abort).toHaveBeenCalledOnce();
  });
});
