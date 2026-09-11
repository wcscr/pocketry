import { z } from "zod";

import {
  cutoutPlacementSchema,
  fingerHoleSchema,
  elongatedFingerHoleEndpoints,
  isElongatedFingerHole,
  resolvePocketDepth,
  tracedShapeSchema,
  transformPointPlacement,
  type FingerHole,
} from "./cutout";
import { binSpecSchema } from "./types";

/**
 * The persisted unit of user data: the shape library plus the bin being
 * designed. Versioned from its first commit (the design doc's rule: version
 * the format *before* real user data exists) — bumping `schemaVersion` and
 * adding a migration in `parseProjectDoc` is the upgrade path when persisted
 * feature models change. Version 2 replaces the one-off scoop with typed,
 * per-finger-hole straight/scoop geometry; version 3 adds a per-pocket top
 * edge fillet; version 4 adds nonrectangular cell footprints and boundary-edge
 * label-tab anchors; version 5 adds straight-shaft deep finger scoops; version
 * 6 adds resizable, rotated oblong deep scoops; version 7 promotes finger
 * holes from pocket-relative children to independent, bin-local objects;
 * version 8 adds per-placement X/Y scale and an aspect-ratio-lock preference;
 * version 9 adds per-finger-hole top and bottom edge fillets; version 10 adds
 * optional project names, fixed-size preference, and trace margin provenance.
 * Version 11 removes Lite Base; older projects use the ordinary Gridfinity base.
 * Version 12 adds an optional flat bottom, defaulting off for existing projects.
 * Version 13 adds flat-ended cylindrical finger scoops.
 */

export const PROJECT_SCHEMA_VERSION = 13 as const;

const projectFields = {
  shapes: z.array(tracedShapeSchema),
  spec: binSpecSchema,
  cutouts: z.array(cutoutPlacementSchema),
  fingerHoles: z.array(fingerHoleSchema),
};

const legacyProjectFields = {
  shapes: z.array(tracedShapeSchema),
  spec: binSpecSchema,
  cutouts: z.array(cutoutPlacementSchema),
};

const version7ProjectSchema = z
  .object({
    schemaVersion: z.literal(7),
    ...projectFields,
  })
  .strict();

const version8ProjectSchema = z
  .object({
    schemaVersion: z.literal(8),
    ...projectFields,
  })
  .strict();

const version9ProjectSchema = z.object({ schemaVersion: z.literal(9), ...projectFields }).strict();

export const projectDocSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    ...projectFields,
    name: z.string().trim().min(1).max(80).optional(),
    keepBinSize: z.boolean().optional(),
  })
  .strict();

const version12ProjectSchema = projectDocSchema.extend({ schemaVersion: z.literal(12) });

const version11ProjectSchema = projectDocSchema.extend({ schemaVersion: z.literal(11) });

const version10ProjectSchema = projectDocSchema.extend({ schemaVersion: z.literal(10) });

const legacyProjectSchemas = [1, 2, 3, 4, 5, 6].map((schemaVersion) =>
  z
    .object({
      schemaVersion: z.literal(schemaVersion),
      ...legacyProjectFields,
    })
    .strict(),
);

export type ProjectDoc = z.infer<typeof projectDocSchema>;

type LegacyProjectDoc = z.infer<(typeof legacyProjectSchemas)[number]>;

/** Keeps migrated ids unique now that formerly per-pocket arrays share one list. */
function uniqueFingerHoleId(id: string, used: Set<string>): string {
  let candidate = id;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${id}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function migrateLegacyProject(doc: LegacyProjectDoc): ProjectDoc {
  const usedIds = new Set<string>();
  const fingerHoles: FingerHole[] = [];
  const cutouts = doc.cutouts.map((cutout) => {
    const pocket = resolvePocketDepth(doc.spec, cutout.depth);
    for (const hole of cutout.fingerHoles) {
      const center = transformPointPlacement(hole.center, cutout);
      let rotationDeg = hole.rotationDeg;
      if (isElongatedFingerHole(hole)) {
        const endpoints = elongatedFingerHoleEndpoints(hole);
        const start = transformPointPlacement(endpoints.start, cutout);
        const end = transformPointPlacement(endpoints.end, cutout);
        rotationDeg =
          ((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI + 360) %
          360;
      }
      fingerHoles.push({
        ...hole,
        id: uniqueFingerHoleId(hole.id, usedIds),
        center,
        rotationDeg,
        // Straight holes formerly inherited the parent pocket floor.
        depthMm:
          hole.kind === "straight"
            ? Math.min(120, Math.max(1, pocket.depthMm ?? pocket.infillTopZ + 1))
            : hole.depthMm,
      });
    }
    return { ...cutout, fingerHoles: [] };
  });
  return projectDocSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    shapes: doc.shapes,
    spec: doc.spec,
    cutouts,
    fingerHoles,
  });
}

/**
 * Parses a stored document, returning null on any mismatch — a corrupt or
 * future-versioned doc must never clobber the in-memory state, and rendering
 * an empty designer beats crashing the workspace.
 */
export function parseProjectDoc(input: unknown): ProjectDoc | null {
  const result = projectDocSchema.safeParse(input);
  if (result.success) return result.data;
  // Only legacy documents may contain the removed flag. Keep malformed values
  // and unknown fields invalid, and never mutate the stored source document.
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const doc = input as Record<string, unknown>;
    if (typeof doc.schemaVersion === "number" && doc.schemaVersion >= 1 && doc.schemaVersion <= 10 &&
        doc.spec && typeof doc.spec === "object" && !Array.isArray(doc.spec)) {
      const { liteBase, ...spec } = doc.spec as Record<string, unknown>;
      if (liteBase !== undefined && typeof liteBase !== "boolean") return null;
      input = { ...doc, spec };
    }
  }
  const version12 = version12ProjectSchema.safeParse(input);
  if (version12.success) return projectDocSchema.parse({ ...version12.data, schemaVersion: PROJECT_SCHEMA_VERSION });
  const version11 = version11ProjectSchema.safeParse(input);
  if (version11.success) return projectDocSchema.parse({ ...version11.data, schemaVersion: PROJECT_SCHEMA_VERSION });
  const version10 = version10ProjectSchema.safeParse(input);
  if (version10.success) return projectDocSchema.parse({ ...version10.data, schemaVersion: PROJECT_SCHEMA_VERSION });
  const version9 = version9ProjectSchema.safeParse(input);
  if (version9.success) return projectDocSchema.parse({ ...version9.data, schemaVersion: PROJECT_SCHEMA_VERSION });
  const version8 = version8ProjectSchema.safeParse(input);
  if (version8.success) {
    return projectDocSchema.parse({
      ...version8.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    });
  }
  const version7 = version7ProjectSchema.safeParse(input);
  if (version7.success) {
    return projectDocSchema.parse({
      ...version7.data,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    });
  }
  for (const schema of [...legacyProjectSchemas].reverse()) {
    const migrated = schema.safeParse(input);
    if (migrated.success) return migrateLegacyProject(migrated.data);
  }
  return null;
}
