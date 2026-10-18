import { z } from "zod";

/** Session-only placement intent. Reusable shapes remain centred on their origin. */
export const tracePlacementSchema = z.object({
  batchId: z.string().min(1),
  role: z.literal("hole").optional(),
  center: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
}).strict();

export type TracePlacement = z.infer<typeof tracePlacementSchema>;
export type TracePlacements = Readonly<Record<string, TracePlacement>>;
