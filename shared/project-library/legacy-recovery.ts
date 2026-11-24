import { z } from "zod";
import { withinImportLimits } from "../gridfinity/import-limits";
import { PROJECT_LIBRARY_VERSION, PROJECT_NAME_MAX_LENGTH, storedProjectSchema, type LibraryBackup } from "../gridfinity/library";
import type { FolderFile, LibraryFolder } from "./adapter";
import { digest, encode, FOLDER_LIMITS, inputFingerprint, legacyRevisionId, LibraryError } from "./format";
import { ConnectedLibrary, partitionFolderChanges } from "./library";

const legacyRevisionSchema = z.strictObject({
  format: z.literal("pocketry-folder-revision"),
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  parents: z.array(z.string().uuid()).max(FOLDER_LIMITS.revisions),
  projects: z.array(storedProjectSchema).refine(projects => new Set(projects.map(project => project.id)).size === projects.length),
});

type LegacySource = Pick<LibraryFolder, "entries"> & {
  readLegacyRevision(name: string, maxBytes: number): Promise<FolderFile | null>;
};

function parseRevision(bytes: Uint8Array, file: string) {
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new LibraryError("corrupt", `Could not read older revision ${file}.`); }
  if (!withinImportLimits(input, true)) throw new LibraryError("resource-limit", `The older revision ${file} exceeds Pocketry’s recovery limits.`);
  const revision = legacyRevisionSchema.safeParse(input);
  if (!revision.success || revision.data.id !== legacyRevisionId(file)) {
    throw new LibraryError("corrupt", `The older revision ${file} is invalid or unsupported.`);
  }
  return revision.data;
}

/** Read the complete heads of the old whole-library snapshot format. */
export async function recoverLegacyBackup(source: LegacySource): Promise<LibraryBackup> {
  const revisions = new Map<string, { file: string; parents: string[]; digest: string }>();
  let entries = 0, files = 0;
  let remainingBytes: number = FOLDER_LIMITS.scanBytes;
  const read = async (name: string) => {
    const file = await source.readLegacyRevision(name, Math.min(remainingBytes, FOLDER_LIMITS.revisionBytes));
    if (!file) throw new LibraryError("storage", "The older library changed during recovery. Refresh and try again.");
    remainingBytes -= file.bytes.byteLength;
    return file.bytes;
  };
  for await (const entry of source.entries()) {
    if (++entries > FOLDER_LIMITS.entries) throw new LibraryError("resource-limit", "The older folder has too many entries to recover.");
    if (!legacyRevisionId(entry.name)) continue;
    if (++files > FOLDER_LIMITS.revisions) throw new LibraryError("resource-limit", "The older folder has too many revisions to recover.");
    if (entry.kind !== "file") throw new LibraryError("corrupt", `${entry.name} is not a revision file.`);
    const bytes = await read(entry.name);
    if (!bytes.byteLength) continue; // Incomplete writes never became legacy snapshots.
    const revision = parseRevision(bytes, entry.name);
    revisions.set(revision.id, { file: entry.name, parents: [...new Set(revision.parents)], digest: await digest(bytes) });
  }
  if (!revisions.size) throw new LibraryError("not-found", "No completed older revisions were found.");

  const children = new Map<string, string[]>();
  const pending = new Map<string, number>();
  const ready: string[] = [];
  for (const [id, revision] of revisions) {
    pending.set(id, revision.parents.length);
    if (!revision.parents.length) ready.push(id);
    for (const parent of revision.parents) {
      if (!revisions.has(parent)) throw new LibraryError("corrupt", "An older revision is missing. Restore its file to the folder and try again.");
      const next = children.get(parent) ?? [];
      next.push(id);
      children.set(parent, next);
    }
  }
  for (let index = 0; index < ready.length; index++) {
    for (const child of children.get(ready[index]) ?? []) {
      const remaining = pending.get(child)! - 1;
      pending.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  if (ready.length !== revisions.size) throw new LibraryError("corrupt", "The older revision history contains a cycle.");

  const backup: LibraryBackup = { format: "pocketry-library", schemaVersion: PROJECT_LIBRARY_VERSION, projects: [] };
  const seen = new Set<string>();
  let backupBytes = encode(JSON.stringify(backup)).byteLength;
  for (const id of [...revisions.keys()].sort()) {
    if (children.has(id)) continue;
    const revision = revisions.get(id)!;
    const bytes = await read(revision.file);
    if (await digest(bytes) !== revision.digest) {
      throw new LibraryError("storage", "The older library changed during recovery. Refresh and try again.");
    }
    for (const project of parseRevision(bytes, revision.file).projects) {
      const key = `recovered-${await inputFingerprint([project.id, project.name, project.doc])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      backupBytes += encode(JSON.stringify(project)).byteLength + key.length + 1;
      if (backupBytes > FOLDER_LIMITS.revisionBytes) throw new LibraryError("resource-limit", "The combined older projects are too large to recover in one operation.");
      backup.projects.push({ ...project, id: key });
    }
  }
  return backup;
}

/** Deterministic data and request IDs let a retry finish a partially written
 * recovery using the same native publication rules as a normal folder save. */
export async function publishRecoveredLibrary(backup: LibraryBackup, destination: LibraryFolder): Promise<void> {
  if (!backup.projects.length) throw new LibraryError("not-found", "No saved projects to recover.");
  if (!withinImportLimits(backup, true)) throw new LibraryError("resource-limit", "The older projects exceed Pocketry’s recovery limits.");
  const names = new Set<string>();
  const batches = partitionFolderChanges(backup.projects.map(project => {
    const original = project.name.trim();
    let name = original;
    for (let copy = 2; names.has(name.toLowerCase()); copy++) {
      const suffix = ` (recovered ${copy})`;
      name = original.slice(0, PROJECT_NAME_MAX_LENGTH - suffix.length).trimEnd() + suffix;
    }
    names.add(name.toLowerCase());
    return { projectId: project.id, name, parents: [], doc: project.doc };
  }));

  const plan = await inputFingerprint(batches.map(changes => changes.map(change => [change.projectId, change.name])));
  const library = new ConnectedLibrary(destination);
  for (const [index, changes] of batches.entries()) {
    const outcome = await library.commit({ requestId: `legacy-recovery:${plan}:${index + 1}:${batches.length}`, changes });
    if (outcome.status !== "published") throw new LibraryError("storage", "Recovery could not be verified. Try Recover projects again.");
  }
}
