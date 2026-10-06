import { pegBottomExtensionMm } from "@shared/gridfinity/peg-bottom";
import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { validateLayout } from "@shared/gridfinity/validate";
import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
import type { ManifoldToplevel } from "manifold-3d";

import {
  cutoutPlacementSchema,
  fingerHoleSchema,
  tracedShapeSchema,
  resolvePocketDepth,
} from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

import { Arena } from "@/lib/manifold/arena";
import { createKernel } from "@/lib/manifold/runtime";
import { extractMeshData, preparePrintableSolid } from "@/lib/mesh/mesh-data";
import { objectEdges } from "@/lib/mesh/object-edges";
import type { HandlerContext, HandlerMap } from "@/lib/worker/host";
import { WorkerCancelledError } from "@/lib/worker/protocol";

import {
  applySectionCut,
  buildBinWithCutouts,
  MULTICOLOR_FLOOR_MAX_THICKNESS_MM,
  MULTICOLOR_MIN_THICKNESS_MM,
  MULTICOLOR_RIM_MAX_THICKNESS_MM,
  MULTICOLOR_BORDER_MAX_WIDTH_MM,
  type BinMaterialParts,
  type BinLayout,
} from "./bin";
import { buildFitCheckSolid, buildSurfaceFitCheckSolid } from "./fit-check";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { resolvedProfileFootprint } from "./profile-bottom";
import {
  BUILD_BIN_METHOD,
  BUILD_FIT_CHECK_METHOD,
  BUILD_SURFACE_FIT_CHECK_METHOD,
  RESOLVE_POCKET_GEOMETRY_METHOD,
  type ResolvePocketGeometryRequest,
  type PocketGeometry,
  type BuildBinRequest,
  type BuildBinResult,
  type BuildFitCheckRequest,
  type BuildFitCheckResult,
  type BuildSurfaceFitCheckRequest,
  type BuildSurfaceFitCheckResult,
} from "./worker-api";

function parseMaterialThickness(
  value: number | undefined,
  label: string,
  maxThicknessMm: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isFinite(value) ||
    value < MULTICOLOR_MIN_THICKNESS_MM ||
    value > maxThicknessMm
  ) {
    throw new Error(
      `${label} must be between ${MULTICOLOR_MIN_THICKNESS_MM} and ${maxThicknessMm} mm`,
    );
  }
  return value;
}

/**
 * The geometry worker's method table — the first geometry actually bound to
 * the worker RPC. Factored out of the worker entry so the handlers can be
 * exercised under Vitest in Node with the real WASM, no thread involved.
 *
 * Each build runs in its own {@link Arena}, disposed in `finally`, so a
 * worker that lives all session cannot accumulate WASM handles. Cancellation
 * is cooperative and checked between the expensive stages; manifold calls
 * themselves are uninterruptible, which is why the supersede window matters
 * more than mid-CSG aborts.
 */
export function createBinWorkerHandlers(
  loadRuntime: () => Promise<ManifoldToplevel>,
): HandlerMap {
  const buildBinHandler = async (
    payload: BuildBinRequest,
    context: HandlerContext,
  ) => {
    const spec = parseBinSpec(payload.spec);
    const floorMaterialThicknessMm = parseMaterialThickness(
      payload.pocketFloorMaterialThicknessMm,
      "Pocket-floor material thickness",
      MULTICOLOR_FLOOR_MAX_THICKNESS_MM,
    );
    const rimMaterialThicknessMm = parseMaterialThickness(
      payload.stackingRimMaterialThicknessMm,
      "Stacking-rim material thickness",
      MULTICOLOR_RIM_MAX_THICKNESS_MM,
    );
    const borderWidthMm = parseMaterialThickness(
      payload.borderWidthMm,
      "Top-border color width",
      MULTICOLOR_BORDER_MAX_WIDTH_MM,
    );
    // Re-validate the layout at the boundary, exactly like the spec.
    let layout: BinLayout | null = null;
    if (
      payload.layout &&
      (payload.layout.cutouts.length > 0 || payload.layout.fingerHoles.length > 0)
    ) {
      const shapes = payload.layout.shapes.map((shape) =>
        tracedShapeSchema.parse(shape),
      );
      layout = {
        shapesById: new Map(shapes.map((shape) => [shape.id, shape])),
        cutouts: payload.layout.cutouts.map((cutout) =>
          cutoutPlacementSchema.parse(cutout),
        ),
        fingerHoles: payload.layout.fingerHoles.map((hole) =>
          fingerHoleSchema.parse(hole),
        ),
      };
      // Only the preview approximation drops rounding. Validate the authored
      // settings first, and never alter export requests or the saved layout.
      if (payload.previewDraft === true && payload.exportTopology !== true) {
        layout.cutouts = layout.cutouts.map((cutout) => ({
          ...cutout,
          topFilletMm: 0,
          bottomFilletMm: 0,
        }));
      }
    }
    context.progress(0.05);

    const wasm = await loadRuntime();
    if (context.signal.aborted) throw new WorkerCancelledError();

    const arena = new Arena();
    try {
      const kernel = createKernel(wasm, arena);
      const started = performance.now();
      if (payload.exportTopology && layout?.cutouts.some(c => c.profileBottom || hasRigidPocket(c) || hasPocketTilt(c) || (c.zOffsetMm ?? 0) !== 0)) {
        const errors = validateLayout(spec, layout.cutouts, layout.shapesById, layout.fingerHoles).filter(issue => issue.severity === "error");
        if (errors.length) throw new Error(errors.map(issue => issue.message).join("\n"));
      }
      const { solid, bodySolid: binSolid, textParts, materialParts, cutoutReports, validationIssues } = buildBinWithCutouts(
        kernel,
        spec,
        layout,
        payload.previewDraft === "rounded" && payload.exportTopology !== true
          ? { ...payload.quality, circularSegments: 16, filletProfileStepMm: Math.max(2, payload.quality.filletProfileStepMm ?? 0.5) }
          : payload.quality,
        {
          floorInsertThicknessMm: floorMaterialThicknessMm,
          rimInsertThicknessMm: rimMaterialThicknessMm,
          borderWidthMm,
        },
      );
      if (payload.exportTopology && validationIssues.some(issue => issue.severity === "error")) {
        throw new Error(validationIssues.filter(issue => issue.severity === "error").map(issue => issue.message).join("\n"));
      }
      context.progress(0.7);
      if (context.signal.aborted) throw new WorkerCancelledError();

      // Stats describe the real bin; the section cut below is view-only.
      const volumeMm3 = solid.volume();
      const section =
        payload.section &&
        (payload.section.axis === "x" || payload.section.axis === "y") &&
        Number.isFinite(payload.section.offsetMm)
          ? payload.section
          : null;
      let displayed = section ? applySectionCut(kernel, solid, section) : solid;
      const includePreviewNormals = payload.exportTopology !== true;
      const displayedPart = (part: BinMaterialParts["body"]) =>
        section ? applySectionCut(kernel, part, section) : part;
      let displayedMaterialParts = materialParts
        ? {
            body: displayedPart(materialParts.body),
            pocketFloors: materialParts.pocketFloors
              ? displayedPart(materialParts.pocketFloors)
              : null,
            stackingRim: materialParts.stackingRim
              ? displayedPart(materialParts.stackingRim)
              : null,
          }
        : null;
      if (payload.exportTopology) {
        displayed = preparePrintableSolid(kernel, displayed);
        if (displayedMaterialParts) {
          const floorRegions = materialParts!.floorRegions.map(part => preparePrintableSolid(kernel, part));
          const pocketFloors = displayedMaterialParts.pocketFloors
            ? preparePrintableSolid(kernel, displayedMaterialParts.pocketFloors) : null;
          const stackingRim = displayedMaterialParts.stackingRim
            ? preparePrintableSolid(kernel, displayedMaterialParts.stackingRim) : null;
          // Subtract full insert regions in export precision. Re-subtracting an
          // already clipped accent repeats the pocket boundary and can create
          // coincident faces, especially around an enclosed profile cavity.
          const bodyCutters = [...floorRegions, ...(stackingRim ? [stackingRim] : [])];
          const printableBody = textParts.length
            ? preparePrintableSolid(kernel, displayedPart(binSolid))
            : displayed;
          const body = bodyCutters.length > 0
            ? preparePrintableSolid(kernel, arena.track(kernel.Manifold.difference([printableBody, ...bodyCutters])))
            : printableBody;
          displayedMaterialParts = { body, pocketFloors, stackingRim };
        }
      }
      // Preserve installed coordinates in preview. Pegs-up exports flip the whole
      // assembly onto its highest face (including raised labels); other peg bases
      // lift tips to z=0. Every colour/text part uses exactly the same transform.
      const pegsUp = payload.exportTopology && spec.pegBottom?.underside === "flat";
      const exportLiftMm = payload.exportTopology ? (pegsUp ? solid.boundingBox().max[2] : pegBottomExtensionMm(spec)) : 0;
      const extractOutputMesh = (part: BinMaterialParts["body"], options: { normals: boolean }) => {
        const oriented = pegsUp ? arena.track(part.rotate([180, 0, 0])) : part;
        const data = extractMeshData(kernel, exportLiftMm ? arena.track(oriented.translate([0, 0, exportLiftMm])) : oriented, options);
        // Printable cleanup uses Float32 vertices; fractional bridge heights
        // can leave a sub-micron offset after lifting. Keep bed contacts at zero.
        if (exportLiftMm) {
          for (let i = 2; i < data.positions.length; i += 3) {
            if (Math.abs(data.positions[i]) < 1e-5) data.positions[i] = 0;
          }
        }
        return data;
      };
      const mesh = extractOutputMesh(displayed, {
        // The preview displays the material body when a partition exists.
        // Keep the aggregate topology/stats without shading an unused mesh.
        normals: includePreviewNormals && materialParts === null && textParts.length === 0,
      });
      const materialMeshes = displayedMaterialParts
        ? {
            body: extractOutputMesh(displayedMaterialParts.body, {
              normals: includePreviewNormals,
            }),
            ...(displayedMaterialParts.pocketFloors &&
            !displayedMaterialParts.pocketFloors.isEmpty()
              ? {
                  pocketFloors: extractOutputMesh(
                    displayedMaterialParts.pocketFloors,
                    { normals: includePreviewNormals },
                  ),
                }
              : {}),
            ...(displayedMaterialParts.stackingRim &&
            !displayedMaterialParts.stackingRim.isEmpty()
              ? {
                  stackingRim: extractOutputMesh(
                    displayedMaterialParts.stackingRim,
                    { normals: includePreviewNormals },
                  ),
                }
              : {}),
          }
        : undefined;
      context.progress(0.9);

      const value: BuildBinResult = {
        mesh,
        ...(textParts.length ? {
          ...(payload.exportTopology || !materialMeshes ? {
            bodyMesh: extractOutputMesh(payload.exportTopology
              ? preparePrintableSolid(kernel, binSolid) : displayedPart(binSolid), { normals: includePreviewNormals }),
          } : {}),
          textMeshes: textParts.map(part => ({
            label: part.label, z: pegsUp ? exportLiftMm - part.z : part.z + exportLiftMm,
            // Rotated font contours can leave nearly coincident vertices that
            // crash Manifold's normal calculation. Use the same sub-micron
            // cleanup as printable text before shading a preview, too.
            mesh: extractOutputMesh(preparePrintableSolid(kernel,
              payload.exportTopology ? part.solid : displayedPart(part.solid)), { normals: includePreviewNormals }),
          })),
        } : {}),
        materialMeshes,
        stats: {
          triangles: mesh.indices.length / 3,
          volumeMm3,
          buildMs: performance.now() - started,
        },
        cutoutReports,
        validationIssues,
      };
      const transfer: Transferable[] = [mesh.positions.buffer, mesh.indices.buffer];
      for (const extra of [value.bodyMesh, ...(value.textMeshes?.map(part => part.mesh) ?? [])]) {
        if (extra) {
          transfer.push(extra.positions.buffer, extra.indices.buffer);
          if (extra.normals) transfer.push(extra.normals.buffer);
        }
      }
      if (mesh.normals) transfer.push(mesh.normals.buffer);
      if (materialMeshes) {
        transfer.push(
          materialMeshes.body.positions.buffer,
          materialMeshes.body.indices.buffer,
        );
        if (materialMeshes.body.normals) {
          transfer.push(materialMeshes.body.normals.buffer);
        }
        if (materialMeshes.pocketFloors) {
          transfer.push(
            materialMeshes.pocketFloors.positions.buffer,
            materialMeshes.pocketFloors.indices.buffer,
          );
          if (materialMeshes.pocketFloors.normals) {
            transfer.push(materialMeshes.pocketFloors.normals.buffer);
          }
        }
        if (materialMeshes.stackingRim) {
          transfer.push(
            materialMeshes.stackingRim.positions.buffer,
            materialMeshes.stackingRim.indices.buffer,
          );
          if (materialMeshes.stackingRim.normals) {
            transfer.push(materialMeshes.stackingRim.normals.buffer);
          }
        }
      }
      return { value, transfer };
    } finally {
      arena.dispose();
    }
  };

  const buildFitCheckHandler = async (
    payload: BuildFitCheckRequest,
    context: HandlerContext,
  ) => {
    const shape = tracedShapeSchema.parse(payload.shape);
    const cutout = cutoutPlacementSchema.parse(payload.cutout);
    context.progress(0.05);

    const wasm = await loadRuntime();
    if (context.signal.aborted) throw new WorkerCancelledError();

    const arena = new Arena();
    try {
      const kernel = createKernel(wasm, arena);
      const started = performance.now();
      const solid = buildFitCheckSolid(
        kernel,
        shape,
        cutout,
        payload.depthMm,
        payload.quality,
      );
      context.progress(0.7);
      if (context.signal.aborted) throw new WorkerCancelledError();

      const volumeMm3 = solid.volume();
      const mesh = extractMeshData(kernel, solid, { normals: true });
      context.progress(0.9);
      const value: BuildFitCheckResult = {
        mesh,
        stats: {
          triangles: mesh.indices.length / 3,
          volumeMm3,
          buildMs: performance.now() - started,
        },
      };
      const transfer: Transferable[] = [mesh.positions.buffer, mesh.indices.buffer];
      if (mesh.normals) transfer.push(mesh.normals.buffer);
      return { value, transfer };
    } finally {
      arena.dispose();
    }
  };

  const buildSurfaceFitCheckHandler = async (
    payload: BuildSurfaceFitCheckRequest,
    context: HandlerContext,
  ) => {
    const spec = parseBinSpec(payload.spec);
    const shapes = payload.layout.shapes.map((shape) =>
      tracedShapeSchema.parse(shape),
    );
    const layout: BinLayout = {
      shapesById: new Map(shapes.map((shape) => [shape.id, shape])),
      cutouts: payload.layout.cutouts.map((cutout) =>
        cutoutPlacementSchema.parse(cutout),
      ),
      fingerHoles: payload.layout.fingerHoles.map((hole) =>
        fingerHoleSchema.parse(hole),
      ),
    };
    context.progress(0.05);

    const wasm = await loadRuntime();
    if (context.signal.aborted) throw new WorkerCancelledError();

    const arena = new Arena();
    try {
      const kernel = createKernel(wasm, arena);
      const started = performance.now();
      const solid = buildSurfaceFitCheckSolid(
        kernel,
        spec,
        layout,
        payload.thicknessMm,
        payload.quality,
        payload.style,
      );
      context.progress(0.7);
      if (context.signal.aborted) throw new WorkerCancelledError();

      const volumeMm3 = solid.volume();
      const mesh = extractMeshData(kernel, solid, { normals: true });
      context.progress(0.9);
      const value: BuildSurfaceFitCheckResult = {
        mesh,
        stats: {
          triangles: mesh.indices.length / 3,
          volumeMm3,
          buildMs: performance.now() - started,
        },
      };
      const transfer: Transferable[] = [mesh.positions.buffer, mesh.indices.buffer];
      if (mesh.normals) transfer.push(mesh.normals.buffer);
      return { value, transfer };
    } finally {
      arena.dispose();
    }
  };

  const resolvePocketGeometryHandler = async (payload: ResolvePocketGeometryRequest, context: HandlerContext) => {
    const spec = parseBinSpec(payload.spec);
    const pockets = payload.pockets.map(pocket => ({ shape: tracedShapeSchema.parse(pocket.shape), cutout: cutoutPlacementSchema.parse(pocket.cutout) }));
    const wasm = await loadRuntime();
    if (context.signal.aborted) throw new WorkerCancelledError();
    const arena = new Arena();
    try {
      const kernel = createKernel(wasm, arena);
      const value: PocketGeometry[] = pockets.map(({ shape, cutout }) => {
        if (context.signal.aborted) throw new WorkerCancelledError();
        if (hasRigidPocket(cutout)) {
          const geometry = resolvedPocketGeometry(kernel, shape, cutout, spec);
          return { ...geometry, edges: objectEdges(geometry.mesh) };
        }
        return { full: resolvedProfileFootprint(kernel, shape.outlineMm, cutout),
          opening: resolvedProfileFootprint(kernel, shape.outlineMm, cutout, resolvePocketDepth(spec, cutout.depth).infillTopZ) };
      });
      const transfer: Transferable[] = value.flatMap(part => part.mesh
        ? [part.mesh.positions.buffer, part.mesh.indices.buffer, ...(part.mesh.normals ? [part.mesh.normals.buffer] : [])] : []);
      return { value, transfer };
    } finally {
      arena.dispose();
    }
  };

  return {
    [BUILD_BIN_METHOD]: buildBinHandler,
    [BUILD_FIT_CHECK_METHOD]: buildFitCheckHandler,
    [BUILD_SURFACE_FIT_CHECK_METHOD]: buildSurfaceFitCheckHandler,
    [RESOLVE_POCKET_GEOMETRY_METHOD]: resolvePocketGeometryHandler,
  } satisfies HandlerMap;
}
