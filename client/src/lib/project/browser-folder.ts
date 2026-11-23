import { del, get, keys, set, update } from "idb-keyval";
import { z } from "zod";
import { assertRevisionBasename, PublicationRejected, type FolderEntry, type LibraryFolder } from "@shared/project-library/adapter";
import { ConnectedLibrary, type Mutation } from "@shared/project-library/library";
import { legacyRevisionId, LibraryError, projectIdSchema, projectNameSchema, revisionIdSchema } from "@shared/project-library/format";

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
const RECOVERED_DIRECTORY = "pocketry-recovered";
export type FolderIntent = { candidateRevision?: string } & (
  | { kind: "commit"; mutation: Mutation }
  | { kind: "keep-both"; requestId: string; projectId: string; expected: string[]; keep: string }
);
type SavedConnection = { directory: DirectoryHandle; parentName: string; id?: string };
export const folderDraftSchema = z.object({
  connectionId: z.uuid(), projectId: projectIdSchema, revision: revisionIdSchema, name: projectNameSchema,
});
export type FolderDraft = z.infer<typeof folderDraftSchema>;

function connection(value: DirectoryHandle | SavedConnection): SavedConnection {
  return "directory" in value ? value : { directory: value, parentName: value.name };
}
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
  constructor(private readonly directory: DirectoryHandle, private readonly parentName?: string,
    readonly id: string = crypto.randomUUID()) {}
  get name() { return this.parentName ?? this.directory.name; }

  static supported() { return typeof pickDirectory() === "function"; }

  static async saved() {
    let saved = await get<DirectoryHandle | SavedConnection>(KEY);
    if (!saved) return null;
    if (!connection(saved).id) {
      // Legacy handles get one identity even if two tabs restore them together.
      await update<DirectoryHandle | SavedConnection | undefined>(KEY, latest => {
        if (!latest) { saved = undefined; return latest; }
        const current = connection(latest);
        saved = current.id ? current : { ...current, id: crypto.randomUUID() };
        return saved;
      });
      if (!saved) return null;
    }
    const { directory, parentName, id } = connection(saved);
    return new BrowserLibraryFolder(directory, parentName, id);
  }

  static async choose() {
    const picker = pickDirectory();
    if (!picker) throw new LibraryError("permission", "This browser does not support connecting a folder.");
    const parent = await picker.call(window, access);
    const root = await parent.getDirectoryHandle("pocketry-library", { create: true }) as DirectoryHandle;
    const source = new BrowserLibraryFolder(root, parent.name);
    const recovered = await source.findCompletedRecovery();
    const handle = recovered?.directory ?? root;
    const previous = await BrowserLibraryFolder.saved();
    const id = previous && await handle.isSameEntry(previous.directory) ? previous.id : crypto.randomUUID();
    await set(KEY, { directory: handle, parentName: parent.name, id } satisfies SavedConnection);
    return new BrowserLibraryFolder(handle, parent.name, id);
  }

  static async disconnect() { await del(KEY); }

  async findCompletedRecovery() {
    let directory: DirectoryHandle;
    try { directory = await this.directory.getDirectoryHandle(RECOVERED_DIRECTORY) as DirectoryHandle; }
    catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotFoundError") return null;
      throw browserError(cause);
    }
    const recovered = new BrowserLibraryFolder(directory, this.name);
    return await new ConnectedLibrary(recovered).hasCompletedLegacyRecovery() ? recovered : null;
  }

  async createRecoveryFolder() {
    try {
      const directory = await this.directory.getDirectoryHandle(RECOVERED_DIRECTORY, { create: true }) as DirectoryHandle;
      return new BrowserLibraryFolder(directory, this.name);
    } catch (cause) { throw browserError(cause); }
  }

  async activateRecovery(recovered: BrowserLibraryFolder) {
    let active: SavedConnection | undefined;
    await update<SavedConnection | DirectoryHandle | undefined>(KEY, saved => {
      if (!saved) return saved;
      const previous = connection(saved);
      active = previous.id === this.id
        ? { directory: recovered.directory, parentName: recovered.name, id: recovered.id }
        : previous;
      return active;
    });
    if (active?.id && await recovered.directory.isSameEntry(active.directory)) {
      return new BrowserLibraryFolder(active.directory, active.parentName, active.id);
    }
    throw new LibraryError("storage", "The connection changed in another tab. Choose the original folder again to open the recovered library.");
  }

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
  async renew() {
    try { return await this.directory.requestPermission(access) === "granted"; }
    catch (cause) {
      if (cause instanceof DOMException && ["AbortError", "NotAllowedError", "SecurityError"].includes(cause.name)) return false;
      throw browserError(cause);
    }
  }

  async *entries(): AsyncIterable<FolderEntry> {
    try {
      for await (const [name, handle] of this.directory.entries()) {
        yield { name, kind: handle.kind === "file" ? "file" : "other" };
      }
    } catch (error) { throw browserError(error); }
  }

  async read(name: string, maxBytes: number) {
    assertRevisionBasename(name);
    return this.readFile(name, maxBytes);
  }

  async readLegacyRevision(name: string, maxBytes: number) {
    if (!legacyRevisionId(name)) throw new TypeError("Invalid older Pocketry revision filename.");
    return this.readFile(name, maxBytes);
  }

  private async readFile(name: string, maxBytes: number) {
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
