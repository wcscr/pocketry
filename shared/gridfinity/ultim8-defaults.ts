import { arbitrarySizePatch } from "./bin-size";
import type { BinMaterials } from "./materials";
import { DEFAULT_PEG_BOTTOM } from "./peg-bottom";
import { HEIGHT_UNIT_MM } from "./standard";
import type { BinSpecInput, BinSpec } from "./types";

/** Settings shared by explicit jig setup and the /ultim8 entry. Does not mutate
 * the source or validate pocket depths; the setup dialog previews its reducer
 * transaction before applying these patches. Custom footprints retain their shape. */
export function ultim8Defaults(spec: BinSpec, bodyThicknessMm: number, bodyColor: string): {
  patch: Partial<BinSpecInput>;
  materialPatch: Partial<BinMaterials>;
} {
  return {
    patch: {
      flatBottom: false, pegBottom: { ...DEFAULT_PEG_BOTTOM },
      arbitrarySizeMm: arbitrarySizePatch(spec)?.arbitrarySizeMm ?? spec.arbitrarySizeMm,
      heightUnits: bodyThicknessMm / HEIGHT_UNIT_MM,
      lip: "none", fill: "solid", fillHeightPercent: 100, textColor: null,
    },
    materialPatch: {
      colorPocketFloors: false, colorStackingRim: false,
      pocketFloorColor: bodyColor, stackingRimColor: bodyColor,
    },
  };
}
