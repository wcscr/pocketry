import { z } from "zod";

export const PROJECT_LIBRARY_VERSION = 1 as const;
export const PROJECT_NAME_MAX_LENGTH = 80;

/** Documents are migrated separately so unsupported saved designs stay intact. */
export const storedProjectSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(PROJECT_NAME_MAX_LENGTH),
  updatedAt: z.string().datetime(),
  doc: z.record(z.unknown()),
}).strict();

export const projectLibrarySchema = z.object({
  schemaVersion: z.literal(PROJECT_LIBRARY_VERSION),
  activeProjectId: z.string().min(1).max(128).nullable(),
  projects: z.array(storedProjectSchema),
}).strict();

/** Importing can add independent copies or replace the saved library. */
export type LibraryImportMode = "merge" | "replace";

/** Portable named-library backup; the current design remains open on import. */
export const libraryBackupSchema = z.object({
  format: z.literal("pocketry-library"),
  schemaVersion: z.literal(PROJECT_LIBRARY_VERSION),
  projects: z.array(storedProjectSchema),
}).strict();

export type StoredProject = z.infer<typeof storedProjectSchema>;
export type StoredProjectLibrary = z.infer<typeof projectLibrarySchema>;
export type LibraryBackup = z.infer<typeof libraryBackupSchema>;

/** Immutable folder revisions form a DAG; concurrent heads require recovery. */
export const folderRevisionSchema = z.object({
  format: z.literal("pocketry-folder-revision"),
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  parents: z.array(z.string().uuid()),
  projects: z.array(storedProjectSchema).refine(
    projects => new Set(projects.map(project => project.id)).size === projects.length,
    "Duplicate project identities",
  ),
}).strict();

export type FolderRevision = z.infer<typeof folderRevisionSchema>;
