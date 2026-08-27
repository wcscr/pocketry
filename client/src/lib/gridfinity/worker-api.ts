import type {
  CutoutPlacementInput,
  TracedShape,
} from "@shared/gridfinity/cutout";
import type { BinSpecInput } from "@shared/gridfinity/types";

import type { MeshData } from "@/lib/mesh/mesh-data";

import type { BuildQuality } from "./bin";
import type { CutoutBuildReport } from "./cutouts";

/**
 * Method contract between the bin-designer UI and the geometry worker.
 * Everything crosses the boundary by structured clone, so only plain data —
 * the spec, shapes and cutouts travel as unparsed input and are re-validated
 * worker-side.
 */

export const BUILD_BIN_METHOD = "buildBin";
export const BUILD_FIT_CHECK_METHOD = "buildFitCheck";

export interface BuildBinLayoutRequest {
  /**
   * The shapes referenced by the cutouts. Shapes are immutable by id in the
   * library, so the request key on the client only fingerprints ids; the
   * geometry itself still rides every request (a few KB after budgeting).
   */
  shapes: TracedShape[];
  cutouts: CutoutPlacementInput[];
}

/**
 * Preview-only section cut: the mesh comes back trimmed to the half-space
 * `axis ≤ offsetMm` so the user can look into pockets. Never applied to
 * exports, and `stats.volumeMm3` still reports the whole bin.
 */
export interface BuildBinSection {
  axis: "x" | "y";
  offsetMm: number;
}

export interface BuildBinRequest {
  spec: BinSpecInput;
  quality: BuildQuality;
  layout?: BuildBinLayoutRequest;
  section?: BuildBinSection;
  /** Split this depth below each printable pocket floor. */
  pocketFloorMaterialThicknessMm?: number;
  /** Split this depth down from the stacking-rim summit. */
  stackingRimMaterialThicknessMm?: number;
}

export interface BuildBinStats {
  triangles: number;
  volumeMm3: number;
  buildMs: number;
}

export interface BuildBinResult {
  mesh: MeshData;
  /** Non-overlapping export meshes whose union is `mesh`. */
  materialMeshes?: {
    body: MeshData;
    pocketFloors?: MeshData;
    stackingRim?: MeshData;
  };
  stats: BuildBinStats;
  /** One entry per requested cutout; `emptied` flags collapsed sections. */
  cutoutReports: CutoutBuildReport[];
}

export interface BuildFitCheckRequest {
  shape: TracedShape;
  cutout: CutoutPlacementInput;
  depthMm: number;
  quality: BuildQuality;
}

export interface BuildFitCheckResult {
  mesh: MeshData;
  stats: BuildBinStats;
}
