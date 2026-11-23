import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { LibraryError } from "../../shared/project-library/format";
import type { NodeLibraryFolder } from "../project-library/node-folder";

type AcquireLock = (projectId: string) => Promise<() => void>;
interface EditSession {
  projectId: string;
  token: string;
  release: () => void;
  active: boolean;
}

export class ProjectBusyError extends Error {
  constructor(readonly projectId: string, message = "This project is being edited by an automation worker.") {
    super(message);
  }
}

/** An MCP worker can hold one edit session. A standalone mutation takes a
 * temporary lock for its whole read, edit, and publication operation. */
export class ProjectEditLocks {
  private session?: EditSession;

  constructor(private readonly acquire: AcquireLock) {}

  async begin<T extends object>(projectId: string, prepare: () => Promise<T>): Promise<T & { editToken: string }> {
    const current = this.session;
    if (current?.projectId === projectId) {
      // A retry on the same worker can recover a lost begin_edit reply.
      return { ...await this.run(projectId, current.token, prepare), editToken: current.token };
    }
    if (current) throw new ProjectBusyError(current.projectId, "End this worker’s current edit session first.");
    const release = await this.acquire(projectId);
    if (this.session) {
      release();
      throw new ProjectBusyError(projectId, "End this worker’s current edit session first.");
    }
    const session = { projectId, token: randomUUID(), release, active: true };
    this.session = session;
    try {
      const result = await prepare();
      session.active = false;
      return { ...result, editToken: session.token };
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async run<T>(projectId: string, token: string | undefined, operation: () => Promise<T>): Promise<T> {
    if (token !== undefined) {
      const session = this.owned(projectId, token);
      session.active = true;
      try { return await operation(); }
      finally { session.active = false; }
    }
    if (this.session?.projectId === projectId) {
      throw new ProjectBusyError(projectId, "Use the edit token for this worker’s active session.");
    }
    const release = await this.acquire(projectId);
    try { return await operation(); }
    finally { release(); }
  }

  end(projectId: string, token: string): void {
    this.owned(projectId, token);
    this.close();
  }

  /** Called after the transport has drained its active command. */
  close(): void {
    const session = this.session;
    this.session = undefined;
    session?.release();
  }

  private owned(projectId: string, token: string): EditSession {
    const session = this.session;
    if (!session || session.projectId !== projectId || session.token !== token) {
      throw new LibraryError("validation", "This edit token is not active for this project in this worker.", { projectId });
    }
    if (session.active) throw new ProjectBusyError(projectId);
    return session;
  }
}

// The repo uses Node 26 with older Node declaration files. Only these built-in
// SQLite methods are needed. Early Node 26 exposes the class as DatabaseSync.
type LockDatabase = { exec(sql: string): void; close(): void };
type OpenLockDatabase = new (path: string, options: { timeout: number }) => LockDatabase;
const sqlite = createRequire(import.meta.url)("node:sqlite") as {
  Database?: OpenLockDatabase;
  DatabaseSync: OpenLockDatabase;
};
const Database = sqlite.Database ?? sqlite.DatabaseSync;
const SQLITE_BUSY = 5;

export function nodeProjectEditLocks(folder: NodeLibraryFolder): ProjectEditLocks {
  return new ProjectEditLocks(async projectId => {
    const path = await folder.projectLockPath(projectId);
    let database: LockDatabase | undefined;
    try {
      const connection = new Database(path, { timeout: 0 });
      database = connection;
      // SQLite may create a rollback journal at BEGIN even without any writes.
      // Keep it in memory so a killed worker leaves only the stable lock file.
      connection.exec("PRAGMA journal_mode=MEMORY; BEGIN IMMEDIATE");
      return () => connection.close();
    } catch (cause) {
      database?.close();
      if (cause instanceof Error && "errcode" in cause && typeof cause.errcode === "number" &&
        (cause.errcode & 0xff) === SQLITE_BUSY) {
        throw new ProjectBusyError(projectId);
      }
      throw new LibraryError("storage", "The project edit lock could not be opened.", { projectId });
    }
  });
}
