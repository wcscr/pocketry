import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { assertRevisionBasename, PublicationRejected, type FolderEntry, type LibraryFolder } from "../../shared/project-library/adapter";
import { digest, encode, LibraryError } from "../../shared/project-library/format";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function storageError(error: unknown): Error {
  if (error instanceof LibraryError) return error;
  if (hasCode(error, "EACCES") || hasCode(error, "EPERM") || hasCode(error, "EROFS")) {
    return new LibraryError("permission", "Access to the configured library folder was denied.");
  }
  if (hasCode(error, "ELOOP")) return new LibraryError("corrupt", "A revision entry is a symbolic link.");
  return new LibraryError("storage", "The configured library folder could not be accessed.");
}

export class NodeLibraryFolder implements LibraryFolder {
  private constructor(readonly root: string, private readonly identity: { dev: bigint; ino: bigint }) {}

  /** The root is selected by the process operator, outside any tool arguments. */
  static async connect(root: string): Promise<NodeLibraryFolder> {
    if (!isAbsolute(root)) throw new LibraryError("validation", "Configure an absolute library folder path.");
    try {
      const canonical = await realpath(root);
      const identity = await stat(canonical, { bigint: true });
      if (!identity.isDirectory()) throw new LibraryError("validation", "The library root must be an existing directory.");
      return new NodeLibraryFolder(canonical, identity);
    } catch (error) { throw storageError(error); }
  }

  private async assertRoot(): Promise<void> {
    const current = await lstat(this.root, { bigint: true });
    if (!current.isDirectory() || current.dev !== this.identity.dev || current.ino !== this.identity.ino ||
        await realpath(this.root) !== this.root) {
      throw new LibraryError("permission", "The configured library directory changed. Reconnect before proceeding.");
    }
  }

  async *entries(): AsyncIterable<FolderEntry> {
    try {
      await this.assertRoot();
      const directory = await opendir(this.root);
      for await (const entry of directory) yield { name: entry.name, kind: entry.isFile() ? "file" : "other" };
    } catch (error) { throw storageError(error); }
  }

  private async readEntry(name: string, maxBytes: number) {
    await this.assertRoot();
    const path = join(this.root, name);
    const entry = await lstat(path).catch(error => {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    });
    if (!entry) return null;
    if (!entry.isFile() || entry.nlink !== 1) {
      throw new LibraryError("corrupt", "Library entries must be regular files without links.", { file: name });
    }
    if (entry.size > maxBytes) throw new LibraryError("resource-limit", "A folder entry exceeds the byte limit.", { file: name });
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const actual = await file.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.ino !== entry.ino || actual.dev !== entry.dev) {
        throw new LibraryError("storage", "A folder entry changed while being opened.", { file: name });
      }
      if (actual.size > maxBytes) throw new LibraryError("resource-limit", "A folder entry exceeds the byte limit.", { file: name });
      const bytes = Buffer.alloc(actual.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new LibraryError("storage", "A folder entry changed while being read.", { file: name });
        offset += bytesRead;
      }
      return { bytes, modifiedAt: actual.mtimeMs };
    } finally { await file.close(); }
  }

  async read(name: string, maxBytes: number) {
    assertRevisionBasename(name);
    try { return await this.readEntry(name, maxBytes); }
    catch (error) { throw storageError(error); }
  }

  async publish(name: string, bytes: Uint8Array): Promise<void> {
    assertRevisionBasename(name);
    await this.publishEntry(name, bytes);
  }

  /** Stable files for native edit locks, outside the revision namespace. */
  async projectLockPath(projectId: string): Promise<string> {
    const key = await digest(encode(projectId));
    const directory = join(this.root, ".pocketry-locks");
    const path = join(directory, `${key}.sqlite`);
    try {
      await this.assertRoot();
      await mkdir(directory, { mode: 0o700 }).catch(error => {
        if (!hasCode(error, "EEXIST")) throw error;
      });
      if (!(await lstat(directory)).isDirectory()) {
        throw new LibraryError("corrupt", "The project lock directory must be a regular directory.");
      }
      const entry = await lstat(path).catch(error => {
        if (!hasCode(error, "ENOENT")) throw error;
        return null;
      });
      if (entry && (!entry.isFile() || entry.nlink !== 1 || entry.size !== 0)) {
        throw new LibraryError("corrupt", "A project lock file was replaced. It must be an empty regular file.", { projectId });
      }
      // Lock databases are never written. SQLite should have no side files to recover.
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        const extra = await lstat(path + suffix).catch(error => {
          if (!hasCode(error, "ENOENT")) throw error;
          return null;
        });
        if (extra) throw new LibraryError("corrupt", "Unexpected project lock database files.", { projectId });
      }
      return path;
    } catch (error) { throw storageError(error); }
  }

  /** Artifact IDs are generated by the service. The same namespace and root
   * confinement apply even though artifacts never participate in the journal. */
  async publishArtifact(extension: "stl" | "3mf" | "pocketry.json", bytes: Uint8Array): Promise<string> {
    if (extension !== "stl" && extension !== "3mf" && extension !== "pocketry.json") throw new TypeError("Invalid artifact format.");
    const name = `pocketry-export-${randomUUID()}.${extension}`;
    await this.publishEntry(name, bytes).catch(error => {
      throw error instanceof PublicationRejected ? error.cause : error;
    });
    return join(this.root, name);
  }

  private async publishEntry(name: string, bytes: Uint8Array): Promise<void> {
    const staging = join(this.root, `.pocketry-incomplete-${randomUUID()}`);
    let staged = false;
    let publishing = false;
    try {
      const existing = await this.readEntry(name, bytes.byteLength);
      if (existing?.bytes.byteLength) {
        if (existing.bytes.equals(bytes)) return;
        throw new LibraryError("corrupt", "The publication destination already contains different bytes.", { file: name });
      }
      const file = await open(staging, "wx", 0o600);
      staged = true;
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally { await file.close(); }
      await this.assertRoot();
      // An equivalent concurrent publication may already have filled the
      // destination. Its bytes are identical under the journal's naming rule.
      publishing = true;
      await rename(staging, join(this.root, name));
      staged = false;
      // Windows does not expose portable directory fsync through Node.
      if (process.platform !== "win32") {
        const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
        try { await directory.sync(); }
        finally { await directory.close(); }
      }
    } catch (error) {
      const cause = storageError(error);
      throw publishing ? cause : new PublicationRejected(cause);
    }
    finally {
      if (staged) await this.assertRoot().then(() => rm(staging, { force: true })).catch(() => {});
    }
  }
}
