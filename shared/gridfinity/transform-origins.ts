import { z } from "zod";
import { cutoutPlacementSchema, fingerHoleSchema } from "./cutout";
import { binSpecSchema } from "./types";
import type { BinDoc } from "./history";

/** Creation references are independent of undo retention and selection. */
export const transformOriginsSchema = z.object({
  pockets: z.array(z.object({ cutout: cutoutPlacementSchema, spec: binSpecSchema }).strict()),
  fingerHoles: z.array(fingerHoleSchema),
}).strict();
export type TransformOrigins = z.infer<typeof transformOriginsSchema>;

/** Old projects recover the earliest retained appearance, never a later edit. */
export function recordTransformOrigins(origins: TransformOrigins, docs: readonly BinDoc[]): TransformOrigins {
  const pockets = [...origins.pockets], fingerHoles = [...origins.fingerHoles];
  const pocketIds = new Set(pockets.map(p => p.cutout.id)), fingerIds = new Set(fingerHoles.map(h => h.id));
  for (const doc of docs) {
    for (const cutout of doc.cutouts) if (!pocketIds.has(cutout.id)) {
      pockets.push({ cutout, spec: doc.spec }); pocketIds.add(cutout.id);
    }
    for (const hole of doc.fingerHoles) if (!fingerIds.has(hole.id)) {
      fingerHoles.push(hole); fingerIds.add(hole.id);
    }
  }
  return pockets.length === origins.pockets.length && fingerHoles.length === origins.fingerHoles.length
    ? origins : { pockets, fingerHoles };
}

/** Deleted objects need references only while they can still be restored. */
export function retainTransformOrigins(origins: TransformOrigins, docs: readonly BinDoc[]): TransformOrigins {
  const pocketIds = new Set(docs.flatMap(d => d.cutouts.map(c => c.id)));
  const fingerIds = new Set(docs.flatMap(d => d.fingerHoles.map(h => h.id)));
  return { pockets: origins.pockets.filter(p => pocketIds.has(p.cutout.id)), fingerHoles: origins.fingerHoles.filter(h => fingerIds.has(h.id)) };
}
