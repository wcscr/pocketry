import { pgTable, text, serial, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Shape of the `images.metadata` JSON blob.
 *
 * Declared as a Zod schema first and fed to the column's `$type<>()` below, so
 * the runtime validation and the compile-time type stay in lockstep. This also
 * has to be handed back to `createInsertSchema` as a field refinement:
 * drizzle-zod cannot see through `$type<>()` on a jsonb column and would
 * otherwise infer the nested properties as `unknown`.
 */
export const imageMetadataSchema = z.object({
  width: z.number(),
  height: z.number(),
  fileSize: z.number(),
  pixelsPerMm: z.number().optional(),
  dimensions: z
    .object({
      widthMm: z.number().optional(),
      heightMm: z.number().optional(),
    })
    .optional(),
});

export type ImageMetadata = z.infer<typeof imageMetadataSchema>;

export const images = pgTable("images", {
  id: serial("id").primaryKey(),
  originalName: text("original_name").notNull(),
  svgData: text("svg_data").notNull(),
  metadata: jsonb("metadata").$type<ImageMetadata>(),
  sessionId: varchar("session_id").notNull(),
});

export const insertImageSchema = createInsertSchema(images, {
  // `.nullish()` is required: supplying a field refinement replaces the schema
  // drizzle-zod would have derived, including the optional/nullable wrapper it
  // adds for a nullable column. Without it, omitting `metadata` is rejected.
  metadata: imageMetadataSchema.nullish(),
}).pick({
  originalName: true,
  svgData: true,
  metadata: true,
  sessionId: true,
});

export type InsertImage = z.infer<typeof insertImageSchema>;
export type Image = typeof images.$inferSelect;
