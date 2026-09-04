import { z } from "zod";

import {
  cutoutPlacementSchema,
  fingerHoleSchema,
  oblongDeepScoopEndpoints,
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
 * version 9 adds per-finger-hole top and bottom edge fillets.
 */

export const PROJECT_SCHEMA_VERSION = 9 as const;

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

export const projectDocSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    ...projectFields,
  })
  .strict();

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
      if (hole.kind === "oblong-deep-scoop") {
        const endpoints = oblongDeepScoopEndpoints(hole);
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
