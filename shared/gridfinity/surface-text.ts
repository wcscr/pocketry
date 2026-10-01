import { z } from "zod";

export const textColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color.");
export const SURFACE_TEXT_FONTS = [
  { id: "sans", name: "Sans" },
  { id: "sans-bold", name: "Sans Bold" },
  { id: "serif", name: "Serif" },
  { id: "serif-bold", name: "Serif Bold" },
  { id: "mono", name: "Monospace" },
  { id: "helvetiker", name: "Helvetiker" },
  { id: "helvetiker-bold", name: "Helvetiker Bold" },
  { id: "optimer", name: "Optimer" },
  { id: "optimer-bold", name: "Optimer Bold" },
  { id: "gentilis", name: "Gentilis" },
  { id: "gentilis-bold", name: "Gentilis Bold" },
] as const;

/** Planar raised labels, in the bin's y-up millimetre frame. */
export const surfaceTextSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().min(1).max(120).refine(value => value.trim().length > 0, "Enter some text.")
    .refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a single line of text."),
  position: z.object({ x: z.number().finite().min(-672).max(672), y: z.number().finite().min(-672).max(672) }).strict(),
  font: z.enum(["sans", "sans-bold", "serif", "serif-bold", "mono", "helvetiker", "helvetiker-bold",
    "optimer", "optimer-bold", "gentilis", "gentilis-bold"]).default("sans"),
  /** Font em size; actual glyph height depends on the characters. */
  sizeMm: z.number().finite().min(2).max(40).default(6),
  heightMm: z.number().finite().min(0.2).max(5).default(0.8),
  rotationDeg: z.number().finite().min(-180).max(180).default(0),
}).strict();

export type SurfaceText = z.infer<typeof surfaceTextSchema>;
