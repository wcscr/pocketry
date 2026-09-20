import { z } from "zod";
import { outlineSchema, vec2Schema } from "./gridfinity/cutout";

const finite = z.number().finite();
const outline = outlineSchema.min(0);
const imageUrl = z.string().max(60_000_000).regex(/^data:image\/[a-z0-9.+-]+;base64,/i);
const rotation = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const margin = finite.min(0).max(5).nullable();
const calibrationFields = {
  startX: finite, startY: finite, endX: finite, endY: finite, lengthMm: finite.positive(),
};
const calibration = z.object(calibrationFields).refine((value) =>
  Math.hypot(value.endX - value.startX, value.endY - value.startY) > 0);
const paper = z.enum(["a4", "letter"]);
const template = z.enum(["a4", "letter", "a4-experimental", "letter-experimental"]);
const perspective = z.object({
  source: z.enum(["template", "manual"]),
  points: z.tuple([vec2Schema, vec2Schema, vec2Schema, vec2Schema]),
  paper: paper.optional(), template: template.optional(),
  correspondences: z.object({ source: z.array(vec2Schema), destinationMm: z.array(vec2Schema) })
    .refine((value) => value.source.length === value.destinationMm.length && value.source.length >= 4).optional(),
});
const historyEntry = z.object({
  outline, label: z.string(), margin,
  refinementBase: outline.optional(), baselineMarginPx: finite.optional(),
  tolerancePx: finite.nonnegative().optional(), smoothing: finite.nonnegative().optional(),
  hasManualEdits: z.boolean().optional(),
});

/** The current browser-local Trace draft, separate from portable Bin projects.
 * Runtime-only processing flags and repeated image URLs are deliberately omitted.
 */
export const traceDraftSchema = z.object({
  schemaVersion: z.literal(1),
  detectionComplete: z.boolean(),
  referencesAttempted: z.boolean(),
  state: z.object({
    imageUrl, fileName: z.string(),
    imageSize: z.object({ width: finite.positive(), height: finite.positive() }),
    imageRotation: rotation,
    outline, rawOutline: outline,
    selection: z.object({ shapeIndex: finite.int().nonnegative(), ringIndex: finite.int().min(-1) }).nullable(),
    history: z.object({ stack: z.array(historyEntry).min(1).max(50), index: finite.int().nonnegative() })
      .refine((value) => value.index < value.stack.length),
    sensitivity: finite.min(0).max(255), includeInteriorHoles: z.boolean(),
    tolerancePx: finite.nonnegative(), smoothing: finite.nonnegative(), margin,
    calibration: calibration.nullable(), pendingAutoCalibration: calibration.nullable(),
    pendingPaperCalibration: calibration.nullable(), pendingAidRequiresPerspective: z.boolean(),
    pendingCalibrationSource: z.enum(["sheet", "strip"]).nullable(),
    calibrationSource: z.enum(["manual", "sheet", "strip"]).nullable(),
    draftCalibration: z.object(calibrationFields).partial().nullable(),
    rulerLengthMm: finite.positive(), rulerLengthInput: z.string().max(200),
    pendingPerspective: perspective.nullable(), manualPerspectivePoints: z.array(vec2Schema).max(4),
    perspectiveOriginalImageUrl: imageUrl.nullable(), perspectiveOriginalImageRotation: rotation.nullable(),
    perspectiveCorrection: z.object({ source: z.enum(["template", "manual"]), paper, template: template.optional() }).nullable(),
    region: z.object({ x: finite, y: finite, width: finite.nonnegative(), height: finite.nonnegative() }).nullable(),
    mode: z.enum(["navigate", "remove", "pan", "region", "edit", "calibrate", "measure", "perspective"]),
    exportFormat: z.enum(["svg", "dxf", "dwg", "stl"]), extrusionHeight: finite.positive(),
  }),
});

export type TraceDraft = z.infer<typeof traceDraftSchema>;
