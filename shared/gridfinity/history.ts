import { z } from "zod";

import { cutoutPlacementSchema, fingerHoleSchema } from "./cutout";
import { designLinkErrors } from "./design-links";
import { binSpecSchema } from "./types";

/** The same retention limit applies in memory and in portable projects. */
export const BIN_HISTORY_LIMIT = 50;

/** Committed material state only; selection, camera and drag previews stay local. */
export const binDocSchema = z.object({
  spec: binSpecSchema,
  cutouts: z.array(cutoutPlacementSchema),
  fingerHoles: z.array(fingerHoleSchema),
}).strict().superRefine((doc, ctx) => {
  for (const message of designLinkErrors(doc)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});

export const binHistoryEntrySchema = z.object({
  doc: binDocSchema,
  label: z.string().min(1).max(200),
}).strict();

export const binHistorySchema = z.object({
  stack: z.array(binHistoryEntrySchema).min(1).max(BIN_HISTORY_LIMIT),
  index: z.number().int().nonnegative(),
}).strict().refine((history) => history.index < history.stack.length, {
  message: "History position must identify a saved step",
  path: ["index"],
});

export type BinDoc = z.infer<typeof binDocSchema>;
export type BinHistoryEntry = z.infer<typeof binHistoryEntrySchema>;
export type BinHistory = z.infer<typeof binHistorySchema>;
