import { z } from "zod";

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

/** Hard ceilings, so a typo cannot ask manifold for a metre of bin. */
export const MAX_GRID = 16;
export const MAX_HEIGHT_UNITS = 42;

export const binSpecSchema = z
  .object({
    /** Number of 42 mm grid cells along x. */
    gridX: z.number().int().min(1).max(MAX_GRID),
    /** Number of 42 mm grid cells along y. */
    gridY: z.number().int().min(1).max(MAX_GRID),
    /** Standard 42 mm cells, or equal half/quarter-pitch subdivisions. */
    gridPitch: z.enum(["full", "half", "quarter"]).default("full"),
    /** Height in 7 mm units, including the base, excluding the stacking lip. */
    heightUnits: z.number().int().min(1).max(MAX_HEIGHT_UNITS),
    /** Stacking lip on the rim. `none` gives a flush top. */
    lip: z.enum(["standard", "none"]).default("standard"),
    /**
     * Interior fill. `solid` fills to the lip support line, ready for
     * cutouts to be subtracted — the Pocketry pocket workflow, hence the
     * default. `none` is the classic hollow storage bin.
     */
    fill: z.enum(["none", "solid"]).default("solid"),
    /**
     * Lite base: hollow thin-shell sockets under a chamfered lattice
     * instead of a solid base — much less plastic and print time. Magnet
     * and screw holes are not supported on a lite base (yet).
     */
    liteBase: z.boolean().default(false),
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
        width: z.enum(["full", "center", "left", "right"]).default("full"),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export type BinSpec = z.infer<typeof binSpecSchema>;
export type BinSpecInput = z.input<typeof binSpecSchema>;

/** Parses unknown input into a {@link BinSpec}, throwing on invalid shape. */
export function parseBinSpec(input: unknown): BinSpec {
  return binSpecSchema.parse(input);
}
