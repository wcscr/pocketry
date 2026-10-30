import { arbitrarySizePatch } from "./bin-size";
import type { BinMaterials } from "./materials";
import { DEFAULT_PEG_BOTTOM } from "./peg-bottom";
import { HEIGHT_UNIT_MM } from "./standard";
import type { BinSpecInput, BinSpec } from "./types";

/** Starter footprint for new Wham Bam Systems ULTIM8-compatible fixtures. */
export const DEFAULT_ULTIM8_FOOTPRINT_MM: Readonly<{ width: number; length: number }> = { width: 100, length: 60 };
/** Body thickness for a new fixture, excluding the locating peg extension. */
export const DEFAULT_ULTIM8_BODY_THICKNESS_MM = 5;

/** Settings shared by explicit jig setup and the /ultim8 entry. Does not mutate
 * the source or validate pocket depths; the setup dialog previews its reducer
 * transaction before applying these patches. Only new projects supply a footprint
 * override; conversions keep their dimensions and custom footprints keep their shape. */
export function ultim8Defaults(spec: BinSpec, bodyThicknessMm: number, bodyColor: string, footprintSizeMm?: Readonly<{ width: number; length: number }>): {
  patch: Partial<BinSpecInput>;
  materialPatch: Partial<BinMaterials>;
} {
  return {
    patch: {
      flatBottom: false, autoFlatBottom: false, pegBottom: { ...DEFAULT_PEG_BOTTOM },
      arbitrarySizeMm: spec.footprint.kind === "rectangle" && footprintSizeMm ? { ...footprintSizeMm }
        : arbitrarySizePatch(spec)?.arbitrarySizeMm ?? spec.arbitrarySizeMm,
      heightUnits: bodyThicknessMm / HEIGHT_UNIT_MM,
      lip: "none", fill: "solid", fillHeightPercent: 100, textColor: null,
    },
    materialPatch: {
      colorPocketFloors: false, colorStackingRim: false,
      pocketFloorColor: bodyColor, stackingRimColor: bodyColor,
    },
  };
}
