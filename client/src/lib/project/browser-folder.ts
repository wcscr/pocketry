import { del, get, keys, set } from "idb-keyval";
import { assertRevisionBasename, PublicationRejected, type FolderEntry, type LibraryFolder } from "@shared/project-library/adapter";
import type { Mutation } from "@shared/project-library/library";
import { LibraryError } from "@shared/project-library/format";

type PermissionOptions = { mode: "readwrite" };
type DirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
  queryPermission(options: PermissionOptions): Promise<PermissionState>;
  requestPermission(options: PermissionOptions): Promise<PermissionState>;
};
const pickDirectory = () => (window as Window & {
  showDirectoryPicker?: (options: PermissionOptions) => Promise<DirectoryHandle>;
}).showDirectoryPicker;

const KEY = "pocketry:connected-project-library-directory";
export type FolderIntent = { candidateRevision?: string } & (
  | { kind: "commit"; mutation: Mutation }
  | { kind: "keep-both"; requestId: string; projectId: string; expected: string[]; keep: string }
);
const PENDING = "pocketry:connected-folder-request:";
export const folderRequestId = (intent: FolderIntent) => intent.kind === "commit" ? intent.mutation.requestId : intent.requestId;
type PendingRequest = { directory: DirectoryHandle; intent: FolderIntent };
const access = { mode: "readwrite" } as const;

function browserError(error: unknown): Error {
  if (error instanceof LibraryError) return error;
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return new LibraryError("permission", "Pocketry needs permission to access the connected folder.");
  }
  if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NoModificationAllowedError")) {
    return new LibraryError("storage", "The connected folder could not be written. It may be full or in use.");
  }
  return new LibraryError("storage", "The connected folder could not be accessed.");
}

export class BrowserLibraryFolder implements LibraryFolder {
  constructor(private readonly directory: DirectoryHandle) {}
  get name() { return this.directory.name; }

  static supported() { return typeof pickDirectory() === "function"; }

  static async saved() {
    const handle = await get<DirectoryHandle>(KEY);
    return handle ? new BrowserLibraryFolder(handle) : null;
  }

  static async choose() {
    const picker = pickDirectory();
    if (!picker) throw new LibraryError("permission", "This browser does not support connecting a folder.");
    const parent = await picker.call(window, access);
    const handle = await parent.getDirectoryHandle("pocketry-library", { create: true }) as DirectoryHandle;
    await set(KEY, handle);
    return new BrowserLibraryFolder(handle);
  }

  static async disconnect() { await del(KEY); }

  async sameDirectory(other: BrowserLibraryFolder) { return this.directory.isSameEntry(other.directory); }

  async remember(intent: FolderIntent) {
    await set(PENDING + folderRequestId(intent), { directory: this.directory, intent } satisfies PendingRequest);
  }

  async forget(requestId: string) { await del(PENDING + requestId); }

  async pending(): Promise<FolderIntent[]> {
    const stored = (await keys()).filter((key): key is string => typeof key === "string" && key.startsWith(PENDING));
    const result: FolderIntent[] = [];
    for (const key of stored) {
      const candidate = await get<PendingRequest>(key);
      if (candidate && await this.directory.isSameEntry(candidate.directory)) result.push(candidate.intent);
      if (result.length === 20) break;
    }
    return result;
  }

  async canWrite() { return await this.directory.queryPermission(access) === "granted"; }
  async renew() { return await this.directory.requestPermission(access) === "granted"; }

  async *entries(): AsyncIterable<FolderEntry> {
    try {
      for await (const [name, handle] of this.directory.entries()) {
        yield { name, kind: handle.kind === "file" ? "file" : "other" };
      }
    } catch (error) { throw browserError(error); }
  }

  async read(name: string, maxBytes: number) {
    assertRevisionBasename(name);
    try {
      const handle = await this.directory.getFileHandle(name);
      const file = await handle.getFile();
      if (file.size > maxBytes) throw new LibraryError("resource-limit", "A folder entry exceeds the byte limit.", { file: name });
      return { bytes: new Uint8Array(await file.arrayBuffer()), modifiedAt: file.lastModified };
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw browserError(error);
    }
  }

  async publish(name: string, bytes: Uint8Array): Promise<void> {
    assertRevisionBasename(name);
    let publishing = false;
    try {
      const existing = await this.read(name, bytes.byteLength);
      if (existing?.bytes.byteLength) {
        if (existing.bytes.every((value, index) => value === bytes[index]) && existing.bytes.length === bytes.length) return;
        throw new LibraryError("corrupt", "The publication destination already contains different bytes.", { file: name });
      }
      const handle = await this.directory.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      try {
        await writer.write(bytes);
        publishing = true;
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
    } catch (error) {
      const cause = browserError(error);
      throw publishing ? cause : new PublicationRejected(cause);
    }
  }
}
