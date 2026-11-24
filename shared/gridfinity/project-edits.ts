import { z } from "zod";
import { binSpecSchema } from "./types";
import { cutoutPlacementSchema } from "./cutout";
import { binMaterialsSchema } from "./materials";
import { surfaceTextSchema } from "./surface-text";

const compartments = binSpecSchema.in.shape.compartments.unwrap().shape;
const materials = binMaterialsSchema.shape;
const nonempty = (value: object) => Object.keys(value).length > 0;
export const projectEditSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("set_compartments"),
    settings: z.strictObject({
      enabled: z.boolean().optional(),
      rows: compartments.rows.removeDefault().optional(),
      columns: compartments.columns.removeDefault().optional(),
      dividerThicknessMm: compartments.dividerThicknessMm.removeDefault().optional().describe("Divider thickness in millimeters."),
      scoop: compartments.scoop.removeDefault().optional(),
    }).refine(nonempty, "Provide at least one compartment setting."),
  }),
  z.strictObject({
    type: z.literal("set_pocket_clearance"),
    pocketId: z.string().min(1).max(128),
    clearanceMm: cutoutPlacementSchema.in.shape.clearanceMm.removeDefault()
      .describe("Per-side offset in millimeters. Positive expands the pocket and negative contracts it."),
  }),
  z.strictObject({
    type: z.literal("set_label_text"),
    labelId: z.string().min(1).max(128),
    text: surfaceTextSchema.shape.text.describe("Printable wording for an existing surface label. Keeps its font, symbol, size, and attachment."),
  }),
  z.strictObject({
    type: z.literal("set_materials"),
    settings: z.strictObject({
      binColor: materials.binColor.optional(),
      pocketFloorColor: materials.pocketFloorColor.optional(),
      stackingRimColor: materials.stackingRimColor.optional(),
      labelBackgroundColor: materials.labelBackgroundColor.removeDefault().optional(),
      colorPocketFloors: materials.colorPocketFloors.optional(),
      colorStackingRim: materials.colorStackingRim.optional(),
      colorDividerTops: materials.colorDividerTops.removeDefault().optional(),
    }).refine(nonempty, "Provide at least one material setting."),
  }),
]);

export const MAX_PROJECT_EDITS = 16;
export type ProjectEdit = z.infer<typeof projectEditSchema>;
