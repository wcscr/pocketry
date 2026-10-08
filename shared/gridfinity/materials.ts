import { z } from "zod";
import { D_WALL, STACKING_LIP_HEIGHT_ACTUAL, STACKING_LIP_SUPPORT_HEIGHT_MM } from "./standard";

export const BIN_BODY_COLOR = "#bfbfbf" as const;
export const POCKET_FLOOR_COLOR = "#000000" as const;
export const STACKING_RIM_COLOR = POCKET_FLOOR_COLOR;

/** Material regions replace existing volume downward from the original surface. */
export const MULTICOLOR_FLOOR_THICKNESS_MM = 0.6;
export const MULTICOLOR_RIM_THICKNESS_MM = 1.25;
export const MULTICOLOR_BORDER_WIDTH_MM = D_WALL;
export const MULTICOLOR_BORDER_MAX_WIDTH_MM = 20;
export const MULTICOLOR_MIN_THICKNESS_MM = 0.2;
export const MULTICOLOR_FLOOR_MAX_THICKNESS_MM = 3;
export const MULTICOLOR_RIM_MAX_THICKNESS_MM = Math.floor(
  (STACKING_LIP_HEIGHT_ACTUAL + STACKING_LIP_SUPPORT_HEIGHT_MM) * 100,
) / 100;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Project appearance is separate from the geometry and its edit history. */
export const binMaterialsSchema = z.object({
  binColor: colorSchema,
  /** Null follows the bin color; an override belongs to this project. */
  lidColor: colorSchema.nullable().default(null),
  pocketFloorColor: colorSchema,
  stackingRimColor: colorSchema,
  colorPocketFloors: z.boolean(),
  colorStackingRim: z.boolean(),
  pocketFloorThicknessMm: z.number().min(MULTICOLOR_MIN_THICKNESS_MM).max(MULTICOLOR_FLOOR_MAX_THICKNESS_MM),
  stackingRimThicknessMm: z.number().min(MULTICOLOR_MIN_THICKNESS_MM).max(MULTICOLOR_RIM_MAX_THICKNESS_MM),
  borderWidthMm: z.number().min(MULTICOLOR_MIN_THICKNESS_MM).max(MULTICOLOR_BORDER_MAX_WIDTH_MM),
}).strict();

export type BinMaterials = z.infer<typeof binMaterialsSchema>;

/** Also used for old projects that predate saved appearance. */
export const DEFAULT_BIN_MATERIALS: Readonly<BinMaterials> = Object.freeze({
  binColor: BIN_BODY_COLOR,
  lidColor: null,
  pocketFloorColor: POCKET_FLOOR_COLOR,
  stackingRimColor: STACKING_RIM_COLOR,
  colorPocketFloors: true,
  colorStackingRim: true,
  pocketFloorThicknessMm: MULTICOLOR_FLOOR_THICKNESS_MM,
  stackingRimThicknessMm: MULTICOLOR_RIM_THICKNESS_MM,
  borderWidthMm: MULTICOLOR_BORDER_WIDTH_MM,
});
