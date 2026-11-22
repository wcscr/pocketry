import { LIBRARY_FILE_MAX_BYTES, withinImportLimits } from "../gridfinity/import-limits";
import { PROJECT_LIBRARY_VERSION, type LibraryBackup } from "../gridfinity/library";
import { serializeProjectDoc } from "../gridfinity/project";
import { PublicationRejected, type LibraryFolder } from "./adapter";
import {
  assignedProjectId, canonicalJson, digest, encode, FOLDER_FORMAT_VERSION, FOLDER_LIMITS, inputFingerprint, LibraryError,
  parseRevisionFile, projectIdSchema, publicationSchema, readFolderProject, requestIdSchema,
  revisionFile, revisionIdSchema, type Change, type Publication,
} from "./format";

interface ChangeSummary {
  projectId: string;
  parents: string[];
  name: string;
  deleted: boolean;
}

interface Revision {
  id: string;
  file: string;
  requestId: string;
  fingerprint: string;
  updatedAt: string;
  changes: Map<string, ChangeSummary>;
}

export interface ProjectHead {
  revision: string;
  name: string;
  updatedAt: string;
  deleted: boolean;
}

export interface FolderProject {
  projectId: string;
  heads: ProjectHead[];
  conflicted: boolean;
}

interface FolderIndex {
  revisions: Map<string, Revision>;
  projects: Map<string, FolderProject>;
  requests: Map<string, Revision[]>;
  pending: Map<string, string[]>;
  entries: number;
  scanBytes: number;
}

export interface PublicationEvidence {
  revision: string;
  fingerprint: string;
  projectIds: string[];
}

export type RequestOutcome =
  | { status: "not-found" | "pending"; requestId: string; pendingRevisions: string[] }
  | { status: "published" | "published-conflict"; requestId: string; publications: PublicationEvidence[]; projects: FolderProject[]; requestCollision: boolean; pendingRevisions: string[] }
  | { status: "published-unverified" | "uncertain"; requestId: string; revision: string; projectIds: string[]; issue: string };

export interface Mutation {
  requestId: string;
  /** SHA-256 of the typed, bounded caller intent, with all source/base tokens.
   * If absent, derive it from the canonical fully prepared changes. */
  fingerprint?: string;
  changes: Change[];
  /** A user selected the versions to preserve in a fork. */
  resolveHeads?: true;
}

const corruption = (message: string, details?: Record<string, unknown>) => new LibraryError("corrupt", message, details);
const limit = (message: string, details?: Record<string, unknown>) => new LibraryError("resource-limit", message, details);
const sorted = (values: Iterable<string>) => [...values].sort();

async function decodePublication(bytes: Uint8Array, file: string, revision: string, requestKey: string): Promise<Publication> {
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw corruption("A Pocketry revision is unreadable. Its bytes have been preserved.", { file });
  }
  if (typeof input === "object" && input !== null && "version" in input &&
      typeof input.version === "number" && input.version > FOLDER_FORMAT_VERSION) {
    throw new LibraryError("unsupported-version", "This folder needs a newer Pocketry version.", { file, version: input.version });
  }
  const parsed = publicationSchema.safeParse(input);
  if (!parsed.success || await digest(bytes) !== revision || await digest(encode(parsed.data.requestId)) !== requestKey) {
    throw corruption("A Pocketry revision failed its format or integrity check.", { file });
  }
  const changes = parsed.data.changes;
  if (new Set(changes.map(change => change.projectId)).size !== changes.length ||
      changes.some(change => new Set(change.parents).size !== change.parents.length)) {
    throw corruption("A Pocketry revision repeats a project or parent.", { file });
  }
  return parsed.data;
}

/** Validate the complete graph using a bounded, iterative topological walk.
 * References are local to each project even for a multi-project publication. */
function indexProjects(revisions: Map<string, Revision>, requests: Map<string, Revision[]>): Map<string, FolderProject> {
  const children = new Map<string, Set<string>>();
  const dependencies = new Map<string, number>();
  const depths = new Map<string, number>();
  const tips = new Map<string, Set<string>>();
  const ready: string[] = [];
  for (const revision of revisions.values()) {
    const parents = new Set<string>();
    for (const change of revision.changes.values()) {
      let projectTips = tips.get(change.projectId);
      if (!projectTips) tips.set(change.projectId, projectTips = new Set());
      projectTips.add(revision.id);
      for (const parent of change.parents) {
        if (!revisions.get(parent)?.changes.has(change.projectId)) {
          throw corruption("A Pocketry revision has a missing or wrong-project parent.", { revision: revision.id, parent });
        }
        parents.add(parent);
      }
    }
    if (parents.size === 0) ready.push(revision.id);
    dependencies.set(revision.id, parents.size);
    for (const parent of parents) {
      let next = children.get(parent);
      if (!next) children.set(parent, next = new Set());
      next.add(revision.id);
    }
  }
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const id = ready[cursor];
    const revision = revisions.get(id)!;
    for (const change of revision.changes.values()) {
      for (const parent of change.parents) tips.get(change.projectId)!.delete(parent);
    }
    const nextDepth = (depths.get(id) ?? 1) + 1;
    for (const child of children.get(id) ?? []) {
      if (nextDepth > FOLDER_LIMITS.depth) throw limit("The folder history exceeds the maximum parent depth.", { revision: child });
      depths.set(child, Math.max(depths.get(child) ?? 1, nextDepth));
      const remaining = dependencies.get(child)! - 1;
      dependencies.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  if (ready.length !== revisions.size) throw corruption("The folder contains a cyclic revision graph.");

  return new Map([...tips].map(([projectId, heads]) => [projectId, {
    projectId,
    conflicted: heads.size > 1 || [...heads].some(id => requests.get(revisions.get(id)!.requestId)!.length > 1),
    heads: sorted(heads).map(id => {
      const revision = revisions.get(id)!;
      const { name, deleted } = revision.changes.get(projectId)!;
      return { revision: id, name, deleted, updatedAt: revision.updatedAt };
    }),
  }]));
}

export class ConnectedLibrary {
  constructor(private readonly folder: LibraryFolder) {}

  private async scan(): Promise<FolderIndex> {
    const revisions = new Map<string, Revision>();
    const requests = new Map<string, Revision[]>();
    const pending = new Map<string, string[]>();
    let entries = 0, scanBytes = 0, count = 0;
    for await (const entry of this.folder.entries()) {
      if (++entries > FOLDER_LIMITS.entries) throw limit("There are too many entries in the connected folder.");
      const parsed = parseRevisionFile(entry.name);
      if (!parsed) {
        if (/^[a-f0-9-]{36}\.pocketry-library\.json$/i.test(entry.name)) {
          throw new LibraryError("unsupported-version", "This folder contains draft version 1 revisions. Recover them to a separate version 2 folder.", { file: entry.name, version: 1 });
        }
        continue;
      }
      if (++count > FOLDER_LIMITS.revisions) throw limit("There are too many revisions in the connected folder.");
      if (parsed.version !== FOLDER_FORMAT_VERSION) {
        throw new LibraryError("unsupported-version", "This folder uses a different revision format.", { file: entry.name, version: parsed.version });
      }
      if (entry.kind !== "file") throw corruption("A revision entry is not a regular file.", { file: entry.name });
      const file = await this.folder.read(entry.name, Math.min(FOLDER_LIMITS.scanBytes - scanBytes, FOLDER_LIMITS.revisionBytes));
      if (!file) throw new LibraryError("storage", "The folder changed while it was being read. Refresh and try again.", { file: entry.name });
      scanBytes += file.bytes.byteLength;
      if (!file.bytes.byteLength) {
        const files = pending.get(parsed.requestKey) ?? [];
        files.push(parsed.revision);
        pending.set(parsed.requestKey, files);
        continue;
      }
      const value = await decodePublication(file.bytes, entry.name, parsed.revision, parsed.requestKey);
      const revision: Revision = {
        id: parsed.revision,
        file: entry.name,
        requestId: value.requestId,
        fingerprint: value.fingerprint,
        updatedAt: new Date(file.modifiedAt).toISOString(),
        changes: new Map(value.changes.map(({ projectId, parents, name, doc }) =>
          [projectId, { projectId, parents, name, deleted: doc === null }])),
      };
      revisions.set(revision.id, revision);
      const list = requests.get(value.requestId) ?? [];
      list.push(revision);
      requests.set(value.requestId, list);
    }
    return { revisions, projects: indexProjects(revisions, requests), requests, pending, entries, scanBytes };
  }

  async list(): Promise<FolderProject[]> {
    const { projects } = await this.scan();
    return sorted(projects.keys()).map(id => projects.get(id)!)
      .filter(project => project.conflicted || project.heads.some(head => !head.deleted));
  }

  /** Portable backup of the visible named projects, pinned to one folder scan. */
  async backup(): Promise<LibraryBackup> {
    const index = await this.scan();
    if ([...index.projects.values()].some(project => project.conflicted)) {
      throw new LibraryError("conflict", "Resolve competing folder revisions before exporting the library.");
    }
    const backup: LibraryBackup = { format: "pocketry-library", schemaVersion: PROJECT_LIBRARY_VERSION, projects: [] };
    let bytes = encode(JSON.stringify(backup)).byteLength;
    const heads = new Map<string, string[]>();
    for (const [id, project] of index.projects) {
      const head = project.heads[0];
      if (head.deleted) continue;
      const ids = heads.get(head.revision) ?? [];
      ids.push(id);
      heads.set(head.revision, ids);
    }
    for (const [id, projects] of heads) {
      const revision = index.revisions.get(id)!;
      const publication = await this.readPublication(revision);
      for (const projectId of projects) {
        const { name, updatedAt, doc } = this.readChange(revision, publication, projectId);
        const project = { id: projectId, name, updatedAt, doc: serializeProjectDoc(doc) };
        bytes += encode(JSON.stringify(project)).byteLength + 1;
        if (bytes > LIBRARY_FILE_MAX_BYTES) throw limit("The folder library is too large for a portable backup. Export projects individually.");
        backup.projects.push(project);
      }
    }
    backup.projects.sort((a, b) => a.id.localeCompare(b.id));
    if (!withinImportLimits(backup, true)) throw limit("The folder library exceeds portable backup limits. Export projects individually.");
    return backup;
  }

  async read(projectId: string, revisionId?: string) {
    return this.readAt(await this.scan(), projectId, revisionId);
  }

  private async readAt(index: FolderIndex, projectId: string, revisionId?: string) {
    const project = index.projects.get(projectId);
    if (!project) throw new LibraryError("not-found", "The project is not in this folder.", { projectId });
    if (revisionId === undefined && project.conflicted) {
      throw new LibraryError("conflict", "Choose a revision to review the competing versions.", { project });
    }
    const id = revisionId ?? project.heads[0].revision;
    const revision = index.revisions.get(id);
    const change = revision?.changes.get(projectId);
    if (!revision || !change || change.deleted) {
      throw new LibraryError("not-found", "The selected revision has no project document.", { projectId, revision: id });
    }
    return { project, revision: id, ...this.readChange(revision, await this.readPublication(revision), projectId) };
  }

  private async readPublication(revision: Revision) {
    const file = await this.folder.read(revision.file, FOLDER_LIMITS.revisionBytes);
    if (!file?.bytes.byteLength) throw new LibraryError("storage", "The selected revision disappeared while it was being read.", { revision: revision.id });
    const parsed = parseRevisionFile(revision.file)!;
    return decodePublication(file.bytes, revision.file, revision.id, parsed.requestKey);
  }

  private readChange(revision: Revision, publication: Publication, projectId: string) {
    const change = publication.changes.find(entry => entry.projectId === projectId)!;
    const raw = change.doc!;
    const doc = readFolderProject(raw);
    const details = { projectId, revision: revision.id };
    if (encode(canonicalJson(raw)).byteLength > FOLDER_LIMITS.projectBytes) throw limit("The saved project exceeds the byte limit.", details);
    if (doc.name !== change.name) throw corruption("The stored project name disagrees with its revision.", details);
    return { name: change.name, updatedAt: revision.updatedAt, doc };
  }

  private async outcome(requestId: string, index: FolderIndex): Promise<RequestOutcome> {
    const candidates = index.requests.get(requestId) ?? [];
    const pendingRevisions = sorted(index.pending.get(await digest(encode(requestId))) ?? []);
    if (!candidates.length) return { status: pendingRevisions.length ? "pending" : "not-found", requestId, pendingRevisions };
    const publications = [...candidates].sort((a, b) => a.id.localeCompare(b.id)).map(revision => ({
      revision: revision.id, fingerprint: revision.fingerprint, projectIds: sorted(revision.changes.keys()),
    }));
    const ids = sorted(new Set(publications.flatMap(publication => publication.projectIds)));
    const projects = ids.map(id => index.projects.get(id)!);
    return {
      status: candidates.length > 1 || projects.some(project => project.conflicted) ? "published-conflict" : "published",
      requestId, publications, projects, requestCollision: candidates.length > 1, pendingRevisions,
    };
  }

  async inspect(requestId: string, revision?: string): Promise<RequestOutcome> {
    if (!requestIdSchema.safeParse(requestId).success ||
        (revision !== undefined && !revisionIdSchema.safeParse(revision).success)) {
      throw new LibraryError("validation", "Invalid request ID or revision token.");
    }
    try { return await this.outcome(requestId, await this.scan()); }
    catch (error) {
      // When the full scan is blocked, a caller with a candidate token can
      // still confirm publication through the self-identifying revision file.
      if (revision !== undefined) {
        const requestKey = await digest(encode(requestId));
        const file = revisionFile(requestKey, revision);
        const candidate = await this.folder.read(file, FOLDER_LIMITS.revisionBytes).catch(() => null);
        if (candidate?.bytes.byteLength) {
          const value = await decodePublication(candidate.bytes, file, revision, requestKey);
          return {
            status: "published-unverified", requestId, revision,
            projectIds: sorted(value.changes.map(change => change.projectId)),
            issue: error instanceof LibraryError ? error.message : "The complete folder could not be checked.",
          };
        }
      }
      throw error;
    }
  }

  /** Keep the chosen version under its original ID and copy each other live
   * head under a deterministic new ID. Geometry is copied without merging. */
  async keepBoth(requestId: string, projectId: string, expected: string[], keep: string): Promise<RequestOutcome> {
    const index = await this.scan();
    if (expected.length < 2 || expected.length > FOLDER_LIMITS.parents || !expected.includes(keep) ||
        new Set(expected).size !== expected.length) {
      throw new LibraryError("validation", "Select the competing revision to keep under the original project ID.");
    }
    const fingerprint = await inputFingerprint({ type: "keep-both", projectId, expected: sorted(expected), keep });
    const previous = await this.outcome(requestId, index);
    if ("publications" in previous) {
      if (previous.publications.some(candidate => candidate.fingerprint === fingerprint)) return previous;
      throw new LibraryError("request-reused", "This request ID already has different input.");
    }
    const primary = await this.readAt(index, projectId, keep);
    const changes: Change[] = [{ projectId, parents: expected, name: primary.name, doc: primary.doc }];
    for (const token of sorted(expected)) {
      if (token === keep) continue;
      const change = index.revisions.get(token)?.changes.get(projectId);
      if (!change) throw new LibraryError("validation", "A selected revision is missing from this project.", { revision: token });
      if (change.deleted) continue;
      const { doc, name } = await this.readAt(index, projectId, token);
      const ending = changes.length === 1 ? " (conflict copy)" : ` (conflict copy ${changes.length})`;
      changes.push({
        projectId: await assignedProjectId(requestId, changes.length),
        parents: [], name: name.slice(0, 80 - ending.length).trimEnd() + ending, doc,
      });
    }
    return this.commit({ requestId, fingerprint, changes, resolveHeads: true });
  }

  async commit(mutation: Mutation): Promise<RequestOutcome> {
    if (!requestIdSchema.safeParse(mutation.requestId).success || mutation.changes.length < 1 ||
        mutation.changes.length > FOLDER_LIMITS.changes ||
        new Set(mutation.changes.map(change => change.projectId)).size !== mutation.changes.length) {
      throw new LibraryError("validation", "A mutation needs a valid request ID and a bounded set of distinct projects.");
    }
    const changes = mutation.changes.map(change => {
      if (!projectIdSchema.safeParse(change.projectId).success || change.parents.length > FOLDER_LIMITS.parents ||
          new Set(change.parents).size !== change.parents.length ||
          change.parents.some(parent => !revisionIdSchema.safeParse(parent).success)) {
        throw new LibraryError("validation", "Invalid project ID or expected revision list.");
      }
      const doc = change.doc === null ? null : serializeProjectDoc({ ...readFolderProject(change.doc), name: change.name });
      if (doc && encode(canonicalJson(doc)).byteLength > FOLDER_LIMITS.projectBytes) throw limit("The project is too large.");
      return { ...change, parents: sorted(change.parents), doc };
    }).sort((a, b) => a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0);
    const fingerprint = mutation.fingerprint ?? await inputFingerprint(changes);
    const checked = publicationSchema.safeParse({
      format: "pocketry-folder-revision", version: FOLDER_FORMAT_VERSION, requestId: mutation.requestId, fingerprint, changes,
    });
    if (!checked.success || changes.some(change => change.name !== change.name.trim())) {
      throw new LibraryError("validation", "Invalid project name or mutation fingerprint.");
    }
    const value = checked.data;
    const bytes = encode(canonicalJson(value));
    if (bytes.byteLength > FOLDER_LIMITS.revisionBytes) throw limit("The publication is too large.");
    const revision = await digest(bytes);
    const requestKey = await digest(encode(value.requestId));
    const name = revisionFile(requestKey, revision);
    const index = await this.scan();
    const previous = index.requests.get(value.requestId) ?? [];
    if (previous.length) {
      if (!previous.some(candidate => candidate.fingerprint === fingerprint && candidate.id === revision)) {
        throw new LibraryError("request-reused", "This request ID already has different input or output.", { requestId: value.requestId });
      }
      return this.outcome(value.requestId, index);
    }
    const pending = index.pending.get(requestKey) ?? [];
    if (pending.some(id => id !== revision)) {
      throw new LibraryError("request-reused", "This request ID has a different incomplete publication.", { requestId: value.requestId });
    }
    for (const change of changes) {
      const project = index.projects.get(change.projectId);
      const actual = project?.heads.map(head => head.revision) ?? [];
      if (project?.conflicted && !mutation.resolveHeads) {
        throw new LibraryError("conflict", "This project has competing versions. Review the saved revisions before proceeding.", { project });
      }
      if (actual.join() !== change.parents.join() || (!actual.length && change.doc === null)) {
        throw new LibraryError("stale-base", "The expected project heads have changed. Review the current revisions before saving.", { projectId: change.projectId, expected: change.parents, actual });
      }
    }
    const alreadyCounted = pending.includes(revision);
    const revisionCount = index.revisions.size + [...index.pending.values()].reduce((total, list) => total + list.length, 0);
    if ((!alreadyCounted && (revisionCount >= FOLDER_LIMITS.revisions || index.entries >= FOLDER_LIMITS.entries)) ||
        index.scanBytes + bytes.byteLength > FOLDER_LIMITS.scanBytes) throw limit("The publication would exceed the folder limits.");
    // Ensure the next scan can read our own write, including the depth bound.
    const indexed: Revision = {
      id: revision, file: name, requestId: value.requestId, fingerprint, updatedAt: "",
      changes: new Map(changes.map(({ projectId, name, parents, doc }) => [projectId, { projectId, name, parents, deleted: doc === null }])),
    };
    index.revisions.set(revision, indexed);
    index.requests.set(value.requestId, [indexed]);
    indexProjects(index.revisions, index.requests);

    let acknowledged = false;
    let rejected: Error | undefined;
    let issue = "The publication was not visible after the write.";
    try {
      await this.folder.publish(name, bytes);
      acknowledged = true;
    } catch (error) {
      if (error instanceof PublicationRejected) rejected = error.cause;
      issue = "The filesystem did not confirm publication.";
    }
    try {
      const outcome = await this.inspect(value.requestId, revision);
      if ("publications" in outcome && outcome.publications.some(candidate => candidate.revision === revision)) return outcome;
      if (outcome.status === "published-unverified" && outcome.revision === revision) return outcome;
    } catch (error) {
      issue = error instanceof LibraryError ? error.message : "The folder could not be checked after publication.";
    }
    if (rejected) throw rejected;
    return {
      status: acknowledged ? "published-unverified" : "uncertain",
      requestId: value.requestId,
      revision,
      projectIds: sorted(changes.map(change => change.projectId)),
      issue,
    };
  }
}
