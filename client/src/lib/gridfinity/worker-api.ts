import type { ValidationIssue } from "@shared/gridfinity/validate";
import type {
  CutoutPlacementInput,
  FingerHole,
  TracedShape,
} from "@shared/gridfinity/cutout";
import type { BinSpecInput } from "@shared/gridfinity/types";
import type { SurfaceFitCheckStyle } from "@shared/gridfinity/fit-check";

import type { MeshData } from "@/lib/mesh/mesh-data";
import type { Outline } from "@shared/geometry/types";
import type { SurfaceText } from "@shared/gridfinity/surface-text";

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
export const BUILD_SURFACE_FIT_CHECK_METHOD = "buildSurfaceFitCheck";
export const RESOLVE_POCKET_GEOMETRY_METHOD = "resolvePocketGeometry";

/** Detached selection geometry; crease extraction also stays off the UI thread. */
export interface PocketGeometry {
  full: Outline;
  opening: Outline;
  mesh?: MeshData;
  edges?: [number, number, number][];
}

export interface ResolvePocketGeometryRequest {
  spec: BinSpecInput;
  pockets: { shape: TracedShape; cutout: CutoutPlacementInput }[];
}
export const SURFACE_FIT_CHECK_MIN_THICKNESS_MM = 0.4;
export const SURFACE_FIT_CHECK_MAX_THICKNESS_MM = 3;
export const SURFACE_FIT_CHECK_DEFAULT_THICKNESS_MM = 0.8;

export interface BuildBinLayoutRequest {
  /**
   * The shapes referenced by the cutouts. Shapes are immutable by id in the
   * library, so the request key on the client only fingerprints ids; the
   * geometry itself still rides every request (a few KB after budgeting).
   */
  shapes: TracedShape[];
  cutouts: CutoutPlacementInput[];
  fingerHoles: FingerHole[];
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
  /** Return topology-preserving meshes without preview-only vertex normals. */
  exportTopology?: boolean;
  /** Fast preview: true omits pocket rounding; rounded keeps coarser fillets. Ignored for exports. */
  previewDraft?: boolean | "rounded";
  /** Split this depth below pocket floors or the interior floor of a hollow bin. */
  pocketFloorMaterialThicknessMm?: number;
  /** Split this depth down from the lip summit or flush perimeter wall top. */
  stackingRimMaterialThicknessMm?: number;
  /** Inward width of the flush top border. Ignored when the bin has a lip. */
  borderWidthMm?: number;
}

export interface BuildBinStats {
  triangles: number;
  volumeMm3: number;
  buildMs: number;
}

export interface BuildBinResult {
  /** Bin without text for multipart 3MF or preview without color partitions. */
  bodyMesh?: MeshData;
  /** One independent mesh and identifying label per text part. */
  textMeshes?: { label: SurfaceText; z: number; mesh: MeshData }[];
  /** Complete topology; preview normals are omitted when materialMeshes supplies the view. */
  mesh: MeshData;
  /** Separate lid, already face-down on z=0 for printing; never section-cut. */
  lidMesh?: MeshData;
  /** Non-overlapping bin material meshes; text always remains separate. */
  materialMeshes?: {
    body: MeshData;
    pocketFloors?: MeshData;
    stackingRim?: MeshData;
  };
  stats: BuildBinStats;
  /** One entry per requested cutout; `emptied` flags collapsed sections. */
  cutoutReports: CutoutBuildReport[];
  validationIssues?: ValidationIssue[];
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

export interface BuildSurfaceFitCheckRequest {
  spec: BinSpecInput;
  layout: BuildBinLayoutRequest;
  thicknessMm: number;
  style?: SurfaceFitCheckStyle;
  quality: BuildQuality;
}

export type BuildSurfaceFitCheckResult = BuildFitCheckResult;
