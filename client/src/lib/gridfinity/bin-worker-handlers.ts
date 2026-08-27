import type { ManifoldToplevel } from "manifold-3d";

import {
  cutoutPlacementSchema,
  tracedShapeSchema,
} from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

import { Arena } from "@/lib/manifold/arena";
import { createKernel } from "@/lib/manifold/runtime";
import { extractMeshData } from "@/lib/mesh/mesh-data";
import type { HandlerContext, HandlerMap } from "@/lib/worker/host";
import { WorkerCancelledError } from "@/lib/worker/protocol";

import {
  applySectionCut,
  buildBinWithCutouts,
  MULTICOLOR_FLOOR_MAX_THICKNESS_MM,
  MULTICOLOR_MIN_THICKNESS_MM,
  MULTICOLOR_RIM_MAX_THICKNESS_MM,
  type BinMaterialParts,
  type BinLayout,
} from "./bin";
import { buildFitCheckSolid } from "./fit-check";
import {
  BUILD_BIN_METHOD,
  BUILD_FIT_CHECK_METHOD,
  type BuildBinRequest,
  type BuildBinResult,
  type BuildFitCheckRequest,
  type BuildFitCheckResult,
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
    // Re-validate the layout at the boundary, exactly like the spec.
    let layout: BinLayout | null = null;
    if (payload.layout && payload.layout.cutouts.length > 0) {
      const shapes = payload.layout.shapes.map((shape) =>
        tracedShapeSchema.parse(shape),
      );
      layout = {
        shapesById: new Map(shapes.map((shape) => [shape.id, shape])),
        cutouts: payload.layout.cutouts.map((cutout) =>
          cutoutPlacementSchema.parse(cutout),
        ),
      };
    }
    context.progress(0.05);

    const wasm = await loadRuntime();
    if (context.signal.aborted) throw new WorkerCancelledError();

    const arena = new Arena();
    try {
      const kernel = createKernel(wasm, arena);
      const started = performance.now();
      const { solid, materialParts, cutoutReports } = buildBinWithCutouts(
        kernel,
        spec,
        layout,
        payload.quality,
        {
          floorInsertThicknessMm: floorMaterialThicknessMm,
          rimInsertThicknessMm: rimMaterialThicknessMm,
        },
      );
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
      const displayed = section ? applySectionCut(kernel, solid, section) : solid;

      const mesh = extractMeshData(kernel, displayed, { normals: true });
      const displayedPart = (part: BinMaterialParts["body"]) =>
        section ? applySectionCut(kernel, part, section) : part;
      const displayedMaterialParts = materialParts
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
      const materialMeshes = displayedMaterialParts
        ? {
            body: extractMeshData(kernel, displayedMaterialParts.body, {
              normals: true,
            }),
            ...(displayedMaterialParts.pocketFloors &&
            !displayedMaterialParts.pocketFloors.isEmpty()
              ? {
                  pocketFloors: extractMeshData(
                    kernel,
                    displayedMaterialParts.pocketFloors,
                    { normals: true },
                  ),
                }
              : {}),
            ...(displayedMaterialParts.stackingRim &&
            !displayedMaterialParts.stackingRim.isEmpty()
              ? {
                  stackingRim: extractMeshData(
                    kernel,
                    displayedMaterialParts.stackingRim,
                    { normals: true },
                  ),
                }
              : {}),
          }
        : undefined;
      context.progress(0.9);

      const value: BuildBinResult = {
        mesh,
        materialMeshes,
        stats: {
          triangles: mesh.indices.length / 3,
          volumeMm3,
          buildMs: performance.now() - started,
        },
        cutoutReports,
      };
      const transfer: Transferable[] = [mesh.positions.buffer, mesh.indices.buffer];
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

  return {
    [BUILD_BIN_METHOD]: buildBinHandler,
    [BUILD_FIT_CHECK_METHOD]: buildFitCheckHandler,
  } satisfies HandlerMap;
}
