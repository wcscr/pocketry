import { z } from "zod";

export const surfaceFitCheckStyleSchema = z.enum(["full", "outline"]);
export type SurfaceFitCheckStyle = z.infer<typeof surfaceFitCheckStyleSchema>;
export const SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM = 5;
