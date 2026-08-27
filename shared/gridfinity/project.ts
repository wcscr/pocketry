import { z } from "zod";

import { cutoutPlacementSchema, tracedShapeSchema } from "./cutout";
import { binSpecSchema } from "./types";

/**
 * The persisted unit of user data: the shape library plus the bin being
 * designed. Versioned from its first commit (the design doc's rule: version
 * the format *before* real user data exists) — bumping `schemaVersion` and
 * adding a migration in `parseProjectDoc` is the upgrade path when persisted
 * feature models change. Version 2 replaces the one-off scoop with typed,
 * per-finger-hole straight/scoop geometry; version 3 adds a per-pocket top
 * edge fillet.
 */

export const PROJECT_SCHEMA_VERSION = 3 as const;

const projectFields = {
  shapes: z.array(tracedShapeSchema),
  spec: binSpecSchema,
  cutouts: z.array(cutoutPlacementSchema),
};

export const projectDocSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    ...projectFields,
  })
  .strict();

const projectDocV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...projectFields,
  })
  .strict()
  .transform(({ schemaVersion: _legacyVersion, ...doc }) => ({
    ...doc,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }));

const projectDocV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...projectFields,
  })
  .strict()
  .transform(({ schemaVersion: _legacyVersion, ...doc }) => ({
    ...doc,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }));

export type ProjectDoc = z.infer<typeof projectDocSchema>;

/**
 * Parses a stored document, returning null on any mismatch — a corrupt or
 * future-versioned doc must never clobber the in-memory state, and rendering
 * an empty designer beats crashing the workspace.
 */
export function parseProjectDoc(input: unknown): ProjectDoc | null {
  const result = projectDocSchema.safeParse(input);
  if (result.success) return result.data;
  const migratedV2 = projectDocV2Schema.safeParse(input);
  if (migratedV2.success) return migratedV2.data;
  const migrated = projectDocV1Schema.safeParse(input);
  return migrated.success ? migrated.data : null;
}
