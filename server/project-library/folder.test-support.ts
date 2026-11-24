import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BrowserLibraryFolder } from "../../client/src/lib/project/browser-folder";
import { parseBinSpec } from "../../shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION } from "../../shared/gridfinity/project";
import type { LibraryFolder } from "../../shared/project-library/adapter";

/** Models the native handle and close semantics against the same real directory
 * used by the Node adapter. It does not test a browser picker or permission UI. */
export function modelBrowserFolder(root: string) {
  let allowed = true;
  let interruptClose = false;
  const handle = (directory: string) => ({
    name: directory.split("/").at(-1)!,
    queryPermission: async () => allowed ? "granted" : "prompt",
    requestPermission: async () => { allowed = true; return "granted"; },
    async *entries() {
      if (!allowed) throw new DOMException("Denied", "NotAllowedError");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        yield [entry.name, { kind: entry.isFile() ? "file" : "directory" }];
      }
    },
    async getDirectoryHandle(name: string) {
      const child = join(directory, name);
      await mkdir(child, { recursive: true });
      return handle(child);
    },
    async getFileHandle(name: string, { create = false } = {}) {
      if (!allowed) throw new DOMException("Denied", "NotAllowedError");
      const path = join(directory, name);
      if (create) await (await open(path, "a")).close();
      else await stat(path).catch(() => { throw new DOMException("Missing", "NotFoundError"); });
      return {
        async getFile() {
          const mtime = (await stat(path)).mtimeMs;
          return new File([await readFile(path)], name, { lastModified: mtime });
        },
        async createWritable() {
          const staging = join(directory, ".model-" + randomUUID());
          return {
            write: (bytes: Uint8Array) => writeFile(staging, bytes),
            close: async () => {
              if (interruptClose) throw new DOMException("Interrupted", "AbortError");
              await rename(staging, path);
            },
            abort: async () => { /* Staging is ignored by the journal. */ },
          };
        },
      };
    },
  });
  return {
    folder: new BrowserLibraryFolder(handle(root) as unknown as ConstructorParameters<typeof BrowserLibraryFolder>[0]),
    revoke: () => { allowed = false; },
    interrupt: (value: boolean) => { interruptClose = value; },
  };
}

export const folderFixture = (name = "Socket bin", columns = 2) => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  name,
  shapes: [],
  spec: parseBinSpec({ gridX: 2, gridY: 1, heightUnits: 3, fill: "none", compartments: { columns } }),
  cutouts: [],
  fingerHoles: [],
});

/** Ensure independent writers both finish preflight before either publishes. */
export function raceFolders(first: LibraryFolder, second: LibraryFolder) {
  let count = 0;
  const gate = Promise.withResolvers<void>();
  return [first, second].map<LibraryFolder>(folder => ({
    entries: () => folder.entries(),
    read: (name, limit) => folder.read(name, limit),
    publish: async (name, bytes) => {
      if (++count === 2) gate.resolve();
      await gate.promise;
      await folder.publish(name, bytes);
    },
  }));
}
