import type { LibraryDirectoryHandle, LibraryFileHandle } from "./folder-library";

/** In-memory model of the native API: a newly created file is empty until
 * close commits its writable stream, and failures leave prior files intact. */
export class MemoryDirectory implements LibraryDirectoryHandle {
  readonly kind = "directory" as const;
  name = "Test library";
  permission: PermissionState = "granted";
  files = new Map<string, string>();
  directories = new Map<string, MemoryDirectory>();
  failClose = false;
  beforeClose?: () => Promise<void>;
  async queryPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    if (!this.directories.has(name)) {
      if (!options?.create) throw new DOMException("Missing directory", "NotFoundError");
      this.directories.set(name, new MemoryDirectory());
    }
    return this.directories.get(name)!;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<LibraryFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException("Missing file", "NotFoundError");
      this.files.set(name, "");
    }
    return {
      kind: "file",
      getFile: async () => ({ text: async () => this.files.get(name)! }),
      createWritable: async () => {
        let pending = "";
        return {
          write: async data => { pending = data; },
          close: async () => {
            await this.beforeClose?.();
            if (this.failClose) throw new Error("Disk full");
            this.files.set(name, pending);
          },
          abort: async () => undefined,
        };
      },
    };
  }
  async *entries(): AsyncIterableIterator<[string, LibraryFileHandle]> {
    for (const name of [...this.files.keys()]) yield [name, await this.getFileHandle(name)];
  }
}
