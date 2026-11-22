import { z } from "zod";
import { LIBRARY_FILE_MAX_BYTES, PROJECT_FILE_MAX_BYTES, withinImportLimits } from "../gridfinity/import-limits";
import { PROJECT_NAME_MAX_LENGTH } from "../gridfinity/library";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, type ProjectDoc } from "../gridfinity/project";

export const FOLDER_FORMAT_VERSION = 2;
export const FOLDER_LIMITS = {
  entries: 10_000,
  revisions: 2_000,
  scanBytes: 256 * 1024 * 1024,
  revisionBytes: LIBRARY_FILE_MAX_BYTES,
  projectBytes: PROJECT_FILE_MAX_BYTES,
  changes: 100,
  parents: 32,
  depth: 1_000,
} as const;

export type LibraryErrorCode =
  | "validation" | "not-found" | "stale-base" | "conflict" | "request-reused"
  | "permission" | "unsupported-version" | "resource-limit" | "corrupt" | "storage";

export class LibraryError extends Error {
  constructor(readonly code: LibraryErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "LibraryError";
  }
}

export class LegacyFolderError extends LibraryError {
  constructor(file?: string) {
    super("unsupported-version", "Older Pocketry library. Open Library in Pocketry and choose Recover projects.", { file, version: 1 });
  }
}

export function legacyRevisionId(name: string): string | undefined {
  return /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.pocketry-library\.json$/i.exec(name)?.[1];
}

export const projectIdSchema = z.string().min(1).max(128);
export const requestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
export const revisionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH);
const changeSchema = z.strictObject({
  projectId: projectIdSchema,
  parents: z.array(revisionIdSchema).max(FOLDER_LIMITS.parents),
  name: projectNameSchema,
  doc: z.record(z.string(), z.unknown()).nullable(),
});
export const publicationSchema = z.strictObject({
  format: z.literal("pocketry-folder-revision"),
  version: z.literal(FOLDER_FORMAT_VERSION),
  requestId: requestIdSchema,
  fingerprint: revisionIdSchema,
  changes: z.array(changeSchema).min(1).max(FOLDER_LIMITS.changes),
});
export type Publication = z.infer<typeof publicationSchema>;
export type Change = Publication["changes"][number];

const filePattern = /^pocketry-r(\d+)-([a-f0-9]{64})-([a-f0-9]{64})\.json$/;
export function revisionFile(requestKey: string, revision: string): string {
  return `pocketry-r${FOLDER_FORMAT_VERSION}-${requestKey}-${revision}.json`;
}
export function parseRevisionFile(name: string) {
  const match = filePattern.exec(name);
  return match && { version: Number(match[1]), requestKey: match[2], revision: match[3] };
}
export const encode = (text: string) => new TextEncoder().encode(text);

export async function digest(data: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Inputs and normalized snapshots use sorted object keys across both runtimes.
 * Array order remains meaningful, including history and placement order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const entries = Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return Object.fromEntries(entries);
  });
}

export async function inputFingerprint(value: unknown): Promise<string> {
  return digest(encode(canonicalJson(value)));
}

/** Stable creation/copy identity for retries, scoped to the folder. */
export async function assignedProjectId(requestId: string, slot = 0): Promise<string> {
  return `project-${await inputFingerprint(["project", requestId, slot])}`;
}

export function readFolderProject(input: Record<string, unknown>): ProjectDoc {
  if (typeof input.schemaVersion === "number" && input.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new LibraryError("unsupported-version", "This project needs a newer Pocketry version.", { version: input.schemaVersion });
  }
  if (!withinImportLimits(input)) throw new LibraryError("resource-limit", "The project exceeds Pocketry’s import limits.");
  const doc = parseProjectDoc(input);
  if (!doc) throw new LibraryError("validation", "The project document or history is invalid.");
  return doc;
}
