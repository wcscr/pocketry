import { z } from "zod";
import { MAX_COMPARTMENTS_PER_AXIS } from "./compartments";
import { surfaceTextSurface, surfaceTextWithLegacyColorSchema, textColorSchema } from "./surface-text";
import { withFontSourceValidationCache } from "./local-font";

import {
  footprintTopologyError,
  type BinFootprint,
  type BoundaryEdge,
  type GridCell,
} from "./footprint";
import { D_DIV, D_WALL, GRID_PITCH_DIVISOR, MAX_HOLLOW_WALL_THICKNESS_MM, type GridPitch } from "./standard";

/**
 * The Gridfinity bin specification — what the user asks for, not how it is
 * built. Geometry builders (`client/src/lib/gridfinity`) consume a parsed
 * {@link BinSpec}; nothing here touches WASM.
 *
 * Versioning note: the persisted unit of user data is the `ProjectDoc`, which
 * carries `schemaVersion` and owns migration. `BinSpec` stays version-free
 * because it never leaves the process on its own — it is embedded in a
 * `ProjectDoc` when saved.
 */

/** Maximum span per axis in standard 42 mm cells, independent of grid pitch. */
export const MAX_GRID = 16;
/** Design ceiling: 420 mm before the lip, allowing large-format printer heights. */
export const MAX_HEIGHT_UNITS = 60;
/** Stay below the horizontal-wall singularity at 90 degrees. */
export const MAX_WALL_SLANT_ANGLE_DEG = 89;

/** Selected-pitch cell ceiling for the same maximum physical bin size. */
export function maxGridCells(pitch: GridPitch = "full"): number {
  return MAX_GRID * GRID_PITCH_DIVISOR[pitch];
}

const gridCellSchema = z
  .object({ x: z.number().int(), y: z.number().int() })
  .strict();

const footprintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rectangle") }).strict(),
  z
    .object({ kind: z.literal("custom"), cells: z.array(gridCellSchema).min(1) })
    .strict(),
]);

const boundaryEdgeSchema = z.object({
  cell: gridCellSchema,
  side: z.enum(["north", "south", "east", "west"]),
}).strict();

export const binSpecSchema = z
  .object({
    /** Editable raised labels on the interior's horizontal surface. */
    surfaceTexts: z.array(surfaceTextWithLegacyColorSchema).max(32).default([])
      .refine(labels => new Set(labels.map(label => label.id)).size === labels.length, "Text ids must be unique."),
    /** One saved color for all labels; null inherits the displayed edge-band color. */
    textColor: textColorSchema.nullable().optional(),
    /** Number of selected-pitch grid cells along x. */
    gridX: z.number().int().min(1).max(maxGridCells("quarter")),
    /** Number of selected-pitch grid cells along y. */
    gridY: z.number().int().min(1).max(maxGridCells("quarter")),
    /** Standard 42 mm cells, or equal half/quarter-pitch subdivisions. */
    gridPitch: z.enum(["full", "half", "quarter"]).default("full"),
    /** Exact outer rectangle dimensions; null uses the retained Gridfinity grid. */
    arbitrarySizeMm: z.object({ width: z.number().min(10).max(671.5), length: z.number().min(10).max(671.5) }).strict().nullable().default(null),
    /** Rectangular legacy footprint or a canonical connected cell mask. */
    footprint: footprintSchema.default({ kind: "rectangle" }),
    /** Body height divided by 7 mm; grid bins use 0.5u increments, arbitrary bins use exact mm. */
    heightUnits: z.number().min(2 / 7).max(MAX_HEIGHT_UNITS),
    /** Stacking lip on the rim. `none` gives a flush top. */
    lip: z.enum(["standard", "none"]).default("standard"),
    /**
     * Interior fill. `solid` fills to the selected height, ready for
     * cutouts to be subtracted — the Pocketry pocket workflow, hence the
     * default. `none` is the classic hollow storage bin.
     */
    fill: z.enum(["none", "solid"]).default("solid"),
    /** Interior floor-to-wall radius, retained while solid; zero leaves sharp edges. */
    bottomFilletRadiusMm: z.number().min(0).max(50).default(0),
    /** Hollow sub-bins; retained while solid fill is enabled. */
    compartments: z.object({
      /** Missing preserves the original count-driven behavior of saved grids. */
      enabled: z.boolean().optional(),
      rows: z.number().int().min(1).max(MAX_COMPARTMENTS_PER_AXIS).default(1),
      columns: z.number().int().min(1).max(MAX_COMPARTMENTS_PER_AXIS).default(1),
      dividerThicknessMm: z.number().min(D_WALL).max(MAX_HOLLOW_WALL_THICKNESS_MM).default(D_DIV),
      scoop: z.boolean().default(false),
    }).strict().default({}),
    /** Null follows bin height; a number fixes hollow-wall thickness, retained while solid. */
    wallThicknessMm: z.number().min(D_WALL).max(MAX_HOLLOW_WALL_THICKNESS_MM).nullable().default(null),
    /** Prototype: tilt one or both opposing walls above the fixed base along one axis. */
    wallSlant: z.object({
      axis: z.enum(["x", "y"]),
      angleDeg: z.number().min(-MAX_WALL_SLANT_ANGLE_DEG).max(MAX_WALL_SLANT_ANGLE_DEG),
      /** Missing keeps older designs slanting both opposing walls. */
      side: z.enum(["both", "negative", "positive"]).optional(),
    }).strict().nullable().default(null),
    /** Percentage of available fill height above the fixed base; retained while hollow. */
    fillHeightPercent: z.number().min(1).max(100).default(100),
    /** Resize existing fixed depths with fill edits; unchecking restores their baseline. */
    adjustFixedPocketDepths: z.boolean().default(true),
    /** Smooth underside without Gridfinity sockets; preserves outer size and pocket heights. */
    flatBottom: z.boolean().default(false),
    /** Arbitrary sizing applied this flat bottom; an explicit bottom choice clears it. */
    autoFlatBottom: z.boolean().default(false),
    /** Integral Wham Bam Systems ULTIM8-compatible pegs with upright roots/web or a flat backing printed pegs up. */
    pegBottom: z.object({
      diameterMm: z.number().min(4).max(5).default(4.8),
      lengthMm: z.number().min(2).max(5).default(4),
      // Preserve pre-underside projects; new bottoms use DEFAULT_PEG_BOTTOM.
      underside: z.enum(["sloped", "bridged", "flat"]).default("sloped"),
      // Preserve every-hole geometry in projects saved before density was explicit.
      density: z.union([z.literal("corners"), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(1),
    }).strict().nullable().default(null),
    /** ⌀6.5 × 2.4 mm magnet pockets, four per cell, opening downward. */
    magnetHoles: z.boolean().default(false),
    /**
     * Crush ribs in the magnet bore: eight sinusoidal lobes (waist ⌀5.9)
     * the magnet crushes on insertion — press fit, no glue. Only meaningful
     * with `magnetHoles`.
     */
    magnetCrushRibs: z.boolean().default(false),
    /** ⌀3 mm M3 screw holes through the base, four per cell. */
    screwHoles: z.boolean().default(false),
    /**
     * Label tab: a sloped shelf hung from the top of one wall (upstream
     * `TAB_POLYGON`). `width` is either the full wall or one nominal 42 mm
     * section at an end; `wall` names the bin edge in the y-up bin frame
     * (`north` = +y, the layout view's top).
     */
    labelTab: z
      .object({
        wall: z.enum(["north", "south", "east", "west"]).default("north"),
        /** New tabs follow the acute-angle side; absent preserves a saved explicit wall. */
        autoWall: z.boolean().optional(),
        /** Repeat the selected tab on every hollow sub-bin; absent keeps the outer wall. */
        scope: z.enum(["outer", "compartments"]).optional(),
        /** Exact boundary anchor for an irregular footprint; null keeps wall-based rectangle behavior. */
        edge: boundaryEdgeSchema.nullable().default(null),
        width: z.enum(["full", "center", "left", "right"]).default("full"),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .transform(({ surfaceTexts, textColor, ...spec }) => ({
    ...spec,
    // Unreleased per-label color projects migrate to their first chosen color.
    textColor: textColor !== undefined ? textColor : surfaceTexts.find(label => label.color !== undefined)?.color ?? null,
    // Retarget hollow-bin labels without changing their authored placement or size.
    // This also normalizes imported projects and every saved history entry.
    surfaceTexts: surfaceTexts.map(({ color: _legacyColor, ...label }) => spec.fill === "none"
      ? { ...label, surface: surfaceTextSurface(spec, label) } : label),
  }))
  .superRefine((spec, context) => {
    if (!spec.arbitrarySizeMm && (spec.heightUnits < 1 || Math.abs(spec.heightUnits * 2 - Math.round(spec.heightUnits * 2)) > 1e-7)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["heightUnits"], message: "Gridfinity heights use 0.5u increments." });
    }
    if (spec.arbitrarySizeMm && (!(spec.flatBottom || spec.pegBottom) || spec.footprint.kind !== "rectangle")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["arbitrarySizeMm"], message: "Arbitrary sizes require a rectangular footprint and a flat bottom or Wham Bam Systems ULTIM8-compatible pegs." });
    }
    if (spec.pegBottom && spec.pegBottom.underside !== "flat" && spec.pegBottom.density !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pegBottom", "density"], message: "Sparse pegs require the flat backing, printed with pegs up." });
    }
    if (spec.heightUnits < 1 && spec.lip === "standard") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["lip"], message: "Bodies below 7 mm require the stacking lip to be off." });
    }
    if (spec.flatBottom && spec.pegBottom) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pegBottom"],
        message: "Choose either a flat bottom or a Wham Bam Systems ULTIM8-compatible peg bottom." });
    }
    if (spec.autoFlatBottom && (!spec.arbitrarySizeMm || !spec.flatBottom || spec.pegBottom)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["autoFlatBottom"],
        message: "Automatic flat bottoms require arbitrary sizing and a flat bottom without pegs." });
    }
    const maximum = maxGridCells(spec.gridPitch);
    for (const axis of ["gridX", "gridY"] as const) {
      if (spec[axis] > maximum) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "number",
          maximum,
          inclusive: true,
          path: [axis],
          message: `Bin dimensions cannot exceed ${MAX_GRID} standard 42 mm cells per axis.`,
        });
      }
    }
    if (spec.gridX > maximum || spec.gridY > maximum) return;
    if (spec.footprint.kind !== "custom") return;
    const error = footprintTopologyError(
      spec.gridX,
      spec.gridY,
      spec.footprint.cells,
    );
    if (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["footprint", "cells"],
        message: error,
      });
    }
  });

export type BinSpec = z.infer<typeof binSpecSchema>;
export type BinSpecInput = z.input<typeof binSpecSchema>;
export type { BinFootprint, BoundaryEdge, GridCell };

/** Parses unknown input into a {@link BinSpec}, throwing on invalid shape. */
export function parseBinSpec(input: unknown): BinSpec {
  return withFontSourceValidationCache(() => binSpecSchema.parse(input));
}
