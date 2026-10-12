import type { Outline } from "@shared/geometry/types";

import { toCrossSection } from "@/lib/geometry/offset";
import { withKernel, type Kernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";

import { toModelSpace, type ExportScale } from "./scale";
import { writeBinarySTL, type StlMesh } from "./stl-writer";

/**
 * Binary STL export of traced outlines.
 *
 * The byte-level writer lives in `./stl-writer` (pure, importable without the
 * Vite-only manifold loader) and is re-exported here so existing callers keep
 * their import path; this module owns the outline → solid → mesh part.
 *
 * The legacy writer triangulated the base by fanning from the polygon centroid,
 * hardcoded every facet normal to `(0, 0, 1)`, and — unlike the DXF writer —
 * never flipped Y, so every exported shadow board came out mirrored. All three
 * are structural, not tuning:
 *
 * - A centroid fan is only valid for a star-shaped polygon. For a concave
 *   outline (the geometry this app now produces) the centroid can lie outside
 *   the material, and the fan then emits facets that overlap and invert. There
 *   is no triangulation code here at all: `CrossSection.extrude` builds a
 *   watertight, consistently wound solid, holes included, by construction.
 * - Normals are computed per facet from the cross product.
 * - The flip goes through `toModelSpace`, which the DXF writer also calls.
 */

export { writeBinarySTL, type StlMesh } from "./stl-writer";

export interface StlOptions {
  /** Extrusion depth. Millimetres when `scale` is calibrated. */
  heightMm: number;
  scale: ExportScale;
  /** Up to 80 ASCII characters of provenance. */
  header?: string;
}

/** Extrudes an outline and serialises it as a binary STL. */
export async function generateSTL(
  outline: Outline,
  options: StlOptions,
): Promise<ArrayBuffer> {
  const mesh = await extrudeOutline(outline, options);
  return writeBinarySTL(mesh, options.header);
}

/**
 * Extrudes an outline to a mesh, resolving the manifold runtime on demand.
 *
 * The kernel's arena is disposed when the call finishes, so repeated exports
 * cannot accumulate WASM handles.
 */
export async function extrudeOutline(
  outline: Outline,
  options: StlOptions,
): Promise<StlMesh> {
  const model = toModelSpace(outline, options.scale);
  return withKernel((kernel) =>
    extrudeOutlineWithKernel(kernel, model, options.heightMm),
  );
}

/**
 * Extrudes an **already model-space** outline using a caller-supplied kernel,
 * tracking every handle in `kernel.arena`.
 *
 * Kept separate from {@link extrudeOutline} for the same reason
 * `offsetOutlineWithKernel` is: the geometry worker owns its own kernel and
 * must not create a second one per call.
 */
export function extrudeOutlineWithKernel(
  kernel: Kernel,
  outline: Outline,
  heightMm: number,
): StlMesh {
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    // manifold happily extrudes by NaN and returns an errored (empty) solid,
    // which would silently write an empty file.
    throw new Error(`generateSTL: heightMm must be positive, got ${heightMm}`);
  }

  const section = toCrossSection(kernel, outline);
  // Extruding nothing is not an error, but manifold reports it as one
  // (`InvalidConstruction`), so the empty case is answered before it can be
  // confused with a real failure. An empty solid also has an inverted-infinite
  // bounding box, which would poison the grounding translate below.
  if (section.isEmpty()) return emptyMesh();

  const solid = kernel.arena.track(section.extrude(heightMm));
  const status = solid.status();
  if (status !== "NoError") {
    throw new Error(`generateSTL: manifold reported ${status}`);
  }
  if (solid.isEmpty()) return emptyMesh();

  // `extrude` already rests on the XY plane, but a printer's bed is at z = 0
  // and the invariant is cheap to guarantee rather than assume.
  const minZ = solid.boundingBox().min[2];
  const grounded =
    minZ === 0 ? solid : kernel.arena.track(solid.translate(0, 0, -minZ));

  return extractPrintableMeshData(kernel, grounded);
}

function emptyMesh(): StlMesh {
  return { positions: new Float32Array(), indices: new Uint32Array() };
}

