/** The adapter works with single, core-generated basenames. Unrelated entries
 * are ignored by the core, but count toward the directory enumeration limit. */
export interface FolderEntry {
  name: string;
  kind: "file" | "other";
}

export interface FolderFile {
  bytes: Uint8Array;
  modifiedAt: number;
}

export interface LibraryFolder {
  entries(): AsyncIterable<FolderEntry>;
  /** Enforce the byte limit before allocating or reading the payload. */
  read(name: string, maxBytes: number): Promise<FolderFile | null>;
  /** Publish complete bytes. On an error the final file may already exist.
   * The same name always represents identical bytes for cooperating writers. */
  publish(name: string, bytes: Uint8Array): Promise<void>;
}

/** The attempted write failed before its publication boundary. */
export class PublicationRejected extends Error {
  constructor(readonly cause: Error) {
    super(cause.message);
    this.name = "PublicationRejected";
  }
}

export function assertRevisionBasename(name: string): void {
  if (!/^pocketry-r2-[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(name)) {
    throw new TypeError("Invalid Pocketry revision basename.");
  }
}
