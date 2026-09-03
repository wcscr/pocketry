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
 * edge fillet; version 4 adds nonrectangular cell footprints and boundary-edge
 * label-tab anchors; version 5 removes the modeled lite base and migrates old
 * projects to the ordinary Gridfinity base.
 */

export const PROJECT_SCHEMA_VERSION = 5 as const;

const projectFields = {
  shapes: z.array(tracedShapeSchema),
  spec: binSpecSchema,
  cutouts: z.array(cutoutPlacementSchema),
};

/** Accepts the removed v1-v4 field, then parses the remaining current spec. */
const legacyBinSpecSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const { liteBase, ...current } = input as Record<string, unknown>;
  // Old project writers always stored a boolean. Preserve fail-closed parsing
  // for corrupt documents instead of silently accepting arbitrary values.
  return liteBase === undefined || typeof liteBase === "boolean" ? current : input;
}, binSpecSchema);

const legacyProjectFields = {
  shapes: z.array(tracedShapeSchema),
  spec: legacyBinSpecSchema,
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
    ...legacyProjectFields,
  })
  .strict()
  .transform(({ schemaVersion: _legacyVersion, ...doc }) => ({
    ...doc,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }));

const projectDocV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...legacyProjectFields,
  })
  .strict()
  .transform(({ schemaVersion: _legacyVersion, ...doc }) => ({
    ...doc,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }));

const projectDocV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    ...legacyProjectFields,
  })
  .strict()
  .transform(({ schemaVersion: _legacyVersion, ...doc }) => ({
    ...doc,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }));

const projectDocV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    ...legacyProjectFields,
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
  const migratedV4 = projectDocV4Schema.safeParse(input);
  if (migratedV4.success) return migratedV4.data;
  const migratedV3 = projectDocV3Schema.safeParse(input);
  if (migratedV3.success) return migratedV3.data;
  const migratedV2 = projectDocV2Schema.safeParse(input);
  if (migratedV2.success) return migratedV2.data;
  const migrated = projectDocV1Schema.safeParse(input);
  return migrated.success ? migrated.data : null;
}
