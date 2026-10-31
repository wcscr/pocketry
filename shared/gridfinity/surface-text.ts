import { z } from "zod";
import { localFontSchema } from "./local-font";
import { hardwareSymbol, hardwareSymbolIdSchema } from "./hardware-symbols";

export const textColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color.");
export const SURFACE_TEXT_FONTS = [
  { id: "sans", name: "Sans" },
  { id: "sans-bold", name: "Sans Bold" },
  { id: "helvetiker", name: "Helvetiker" },
  { id: "helvetiker-bold", name: "Helvetiker Bold" },
  { id: "mono", name: "Monospace" },
] as const;

/** Planar raised labels, in the bin's y-up millimetre frame. */
const surfaceTextFields = z.object({
  id: z.string().min(1).max(100),
  /** Optional object-list name, independent of the printed wording. */
  name: z.string().trim().min(1).optional(),
  text: z.string().max(120)
    .refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a single line of text."),
  /** Optional bundled hardware outline before the wording. */
  symbol: hardwareSymbolIdSchema.optional(),
  /** Independent symbol angle; absent keeps the catalog's default orientation. */
  symbolRotationDeg: z.number().finite().min(-180).max(180).optional(),
  /** Unrotated symbol height; absent preserves the legacy shared text size. */
  symbolSizeMm: z.number().finite().min(2).max(40).optional(),
  /** Gap before any leading text spaces; absent keeps the quarter-em spacing. */
  symbolGapMm: z.number().finite().min(0).max(40).optional(),
  position: z.object({ x: z.number().finite().min(-672).max(672), y: z.number().finite().min(-672).max(672) }).strict(),
  /** Absent uses solid fill when available; hollow bins always use label tabs. */
  surface: z.enum(["bin", "label-tab"]).optional(),
  font: z.union([z.enum(["sans", "sans-bold", "mono", "helvetiker", "helvetiker-bold"]), localFontSchema]).default("sans"),
  /** Font em size; glyph height depends on the characters. */
  sizeMm: z.number().finite().min(2).max(40).default(6),
  heightMm: z.number().finite().min(0.2).max(5).default(0.8),
  rotationDeg: z.number().finite().min(-180).max(180).default(0),
}).strict();

const hasContent = (label: z.infer<typeof surfaceTextFields>) => !!label.symbol || label.text.trim().length > 0;
const contentError = { message: "Enter some text or choose a symbol.", path: ["text"] };
export const surfaceTextSchema = surfaceTextFields.refine(hasContent, contentError);
/** Older projects stored color per label; BinSpec migrates it to the shared text color. */
export const surfaceTextWithLegacyColorSchema = surfaceTextFields.extend({ color: textColorSchema.optional() }).refine(hasContent, contentError);

export type SurfaceText = z.infer<typeof surfaceTextSchema>;

/** Hollow bins have no selectable fill surface, including for older saved labels. */
export function surfaceTextSurface(spec: { fill: "none" | "solid" }, label?: Pick<SurfaceText, "surface">): "bin" | "label-tab" {
  return spec.fill === "none" ? "label-tab" : label?.surface ?? "bin";
}

/** Retain the original spacing for labels without an explicit gap. */
export function surfaceTextSymbolGap(label: SurfaceText): number {
  return label.symbolGapMm ?? label.sizeMm * 0.25;
}

/** Prefer a custom name, then wording, then the symbol name for symbol-only labels. */
export function surfaceTextName(label: SurfaceText): string {
  return label.name ?? (label.text.trim() ? label.text : label.symbol ? hardwareSymbol(label.symbol).name : label.text);
}

/** Keep rotations continuous across the pointer-angle seam and inside the saved range. */
export function normalizeSurfaceTextRotation(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}
