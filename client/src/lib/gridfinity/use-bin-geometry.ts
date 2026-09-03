import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BufferGeometry } from "three";

import type {
  CutoutPlacement,
  FingerHole,
  TracedShape,
} from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";

import { toBufferGeometry } from "@/lib/mesh/to-buffer-geometry";
import { createWorkerClient, type WorkerClient } from "@/lib/worker/client";
import { WorkerCancelledError } from "@/lib/worker/protocol";

import {
  MULTICOLOR_FLOOR_THICKNESS_MM,
  MULTICOLOR_RIM_THICKNESS_MM,
  type BuildQuality,
} from "./bin";
import type { CutoutBuildReport } from "./cutouts";
import {
  BUILD_BIN_METHOD,
  BUILD_FIT_CHECK_METHOD,
  BUILD_SURFACE_FIT_CHECK_METHOD,
  type BuildBinRequest,
  type BuildBinResult,
  type BuildBinSection,
  type BuildBinStats,
  type BuildFitCheckRequest,
  type BuildFitCheckResult,
  type BuildSurfaceFitCheckRequest,
  type BuildSurfaceFitCheckResult,
} from "./worker-api";

export interface BinGeometryLayout {
  shapes: TracedShape[];
  cutouts: CutoutPlacement[];
  fingerHoles: FingerHole[];
}

/**
 * Debounce before a build is dispatched. Slider drags emit a burst of spec
 * changes; the worker's supersede channel already cancels stale requests, and
 * the debounce keeps most of them from ever being sent (plan: "Performance").
 */
const DEBOUNCE_MS = 120;

export interface BinGeometryState {
  /** Latest built preview. Owned by the hook: disposed when replaced. */
  geometry: BufferGeometry | null;
  /** Exact pocket-floor material volume for the latest preview. */
  pocketFloorGeometry: BufferGeometry | null;
  /** Exact stacking-rim material volume for the latest preview. */
  stackingRimGeometry: BufferGeometry | null;
  /** True when the preview contains a pocket-floor material volume. */
  hasPocketFloor: boolean;
  /** True when the preview contains a stacking-rim material volume. */
  hasStackingRim: boolean;
  /** Spec that produced `geometry`; remains stable while a replacement builds. */
  builtSpec: BinSpec | null;
  stats: BuildBinStats | null;
  /** Per-cutout build reports from the latest preview (emptied sections). */
  cutoutReports: CutoutBuildReport[];
  building: boolean;
  /** 0..1 as reported by the worker while building. */
  progress: number;
  error: string | null;
  /**
   * One-off build at a different quality — the export path. Runs on its own
   * supersede channel so it never cancels the live preview.
   */
  buildOnce: (
    quality: BuildQuality,
    options?: {
      pocketFloorMaterialThicknessMm?: number;
      stackingRimMaterialThicknessMm?: number;
    },
  ) => Promise<BuildBinResult>;
  /** Builds a standalone filled outline for an inexpensive print-fit check. */
  buildFitCheck: (
    shape: TracedShape,
    cutout: CutoutPlacement,
    depthMm: number,
    quality: BuildQuality,
  ) => Promise<BuildFitCheckResult>;
  /** Builds the complete pocket-layout surface as a thin printable plate. */
  buildSurfaceFitCheck: (
    thicknessMm: number,
    quality: BuildQuality,
  ) => Promise<BuildSurfaceFitCheckResult>;
}

/**
 * Live bin geometry over the worker pipeline: spec in, `BufferGeometry` out,
 * with debounce, supersede-on-newer, cooperative cancel, and progress — the
 * G2 milestone contract ("reacting to sliders without jank").
 */
export function useBinGeometry(
  spec: BinSpec,
  quality: BuildQuality,
  layout?: BinGeometryLayout,
  /** Preview-only section cut; exports via `buildOnce` are never cut. */
  section?: BuildBinSection | null,
  /** Material-band choices create exact non-overlapping preview solids. */
  previewMaterials: {
    pocketFloorThicknessMm?: number;
    stackingRimThicknessMm?: number;
  } = {},
): BinGeometryState {
  const clientRef = useRef<WorkerClient | null>(null);
  const geometryRef = useRef<BufferGeometry | null>(null);
  const pocketFloorGeometryRef = useRef<BufferGeometry | null>(null);
  const stackingRimGeometryRef = useRef<BufferGeometry | null>(null);

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [pocketFloorGeometry, setPocketFloorGeometry] =
    useState<BufferGeometry | null>(null);
  const [stackingRimGeometry, setStackingRimGeometry] =
    useState<BufferGeometry | null>(null);
  const [hasPocketFloor, setHasPocketFloor] = useState(false);
  const [hasStackingRim, setHasStackingRim] = useState(false);
  const [builtSpec, setBuiltSpec] = useState<BinSpec | null>(null);
  const [stats, setStats] = useState<BuildBinStats | null>(null);
  const [cutoutReports, setCutoutReports] = useState<CutoutBuildReport[]>([]);
  const [building, setBuilding] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ensureClient = useCallback((): WorkerClient => {
    clientRef.current ??= createWorkerClient(
      () =>
        new Worker(new URL("./bin.worker.ts", import.meta.url), {
          type: "module",
        }),
    );
    return clientRef.current;
  }, []);

  // Plain-data value key so the effect ignores object identity churn.
  // Shape geometry is deliberately excluded: shapes are immutable by id in
  // the library, so id + pointCount fingerprints them.
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        spec,
        segments: quality.circularSegments,
        budget: quality.cutoutVertexBudget,
        filletStep: quality.filletProfileStepMm,
        cutouts: layout?.cutouts ?? [],
        fingerHoles: layout?.fingerHoles ?? [],
        shapeKeys: layout?.shapes.map((shape) => `${shape.id}:${shape.pointCount}`) ?? [],
        section: section ?? null,
        pocketFloorThicknessMm:
          previewMaterials.pocketFloorThicknessMm ??
          MULTICOLOR_FLOOR_THICKNESS_MM,
        stackingRimThicknessMm:
          previewMaterials.stackingRimThicknessMm ??
          MULTICOLOR_RIM_THICKNESS_MM,
      }),
    [
      spec,
      quality.circularSegments,
      quality.cutoutVertexBudget,
      quality.filletProfileStepMm,
      layout,
      section,
      previewMaterials.pocketFloorThicknessMm,
      previewMaterials.stackingRimThicknessMm,
    ],
  );

  useEffect(() => {
    let stale = false;
    setBuilding(true);
    setProgress(0);

    const timer = setTimeout(() => {
      const request: BuildBinRequest = {
        spec,
        quality,
        layout:
          layout && (layout.cutouts.length > 0 || layout.fingerHoles.length > 0)
            ? {
                shapes: layout.shapes,
                cutouts: layout.cutouts,
                fingerHoles: layout.fingerHoles,
              }
            : undefined,
        section: section ?? undefined,
        pocketFloorMaterialThicknessMm:
          previewMaterials.pocketFloorThicknessMm ??
          MULTICOLOR_FLOOR_THICKNESS_MM,
        stackingRimMaterialThicknessMm:
          previewMaterials.stackingRimThicknessMm ??
          MULTICOLOR_RIM_THICKNESS_MM,
      };
      ensureClient()
        .call<BuildBinResult>(BUILD_BIN_METHOD, request, {
          channel: "preview",
          onProgress: (value) => {
            if (!stale) setProgress(value);
          },
        })
        .then((result) => {
          if (stale) return;
          const next = toBufferGeometry(
            result.materialMeshes?.body ?? result.mesh,
          );
          const nextPocketFloor = result.materialMeshes?.pocketFloors
            ? toBufferGeometry(result.materialMeshes.pocketFloors)
            : null;
          const nextStackingRim = result.materialMeshes?.stackingRim
            ? toBufferGeometry(result.materialMeshes.stackingRim)
            : null;
          geometryRef.current?.dispose();
          pocketFloorGeometryRef.current?.dispose();
          stackingRimGeometryRef.current?.dispose();
          geometryRef.current = next;
          pocketFloorGeometryRef.current = nextPocketFloor;
          stackingRimGeometryRef.current = nextStackingRim;
          setGeometry(next);
          setPocketFloorGeometry(nextPocketFloor);
          setStackingRimGeometry(nextStackingRim);
          setHasPocketFloor(nextPocketFloor !== null);
          setHasStackingRim(nextStackingRim !== null);
          setBuiltSpec(spec);
          setStats(result.stats);
          setCutoutReports(result.cutoutReports ?? []);
          setError(null);
          setBuilding(false);
          setProgress(1);
        })
        .catch((cause: unknown) => {
          if (stale || cause instanceof WorkerCancelledError) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setBuilding(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // requestKey encodes spec + quality + layout by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, ensureClient]);

  // Tear the worker down with the workspace.
  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
      geometryRef.current?.dispose();
      geometryRef.current = null;
      pocketFloorGeometryRef.current?.dispose();
      pocketFloorGeometryRef.current = null;
      stackingRimGeometryRef.current?.dispose();
      stackingRimGeometryRef.current = null;
    },
    [],
  );

  const buildOnce = useCallback(
    (
      exportQuality: BuildQuality,
      options: {
        pocketFloorMaterialThicknessMm?: number;
        stackingRimMaterialThicknessMm?: number;
      } = {},
    ): Promise<BuildBinResult> => {
      const request: BuildBinRequest = {
        spec,
        quality: exportQuality,
        layout:
          layout && (layout.cutouts.length > 0 || layout.fingerHoles.length > 0)
            ? {
                shapes: layout.shapes,
                cutouts: layout.cutouts,
                fingerHoles: layout.fingerHoles,
              }
            : undefined,
        pocketFloorMaterialThicknessMm:
          options.pocketFloorMaterialThicknessMm,
        stackingRimMaterialThicknessMm:
          options.stackingRimMaterialThicknessMm,
      };
      return ensureClient().call<BuildBinResult>(BUILD_BIN_METHOD, request, {
        channel: "export",
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestKey, ensureClient],
  );

  const buildFitCheck = useCallback(
    (
      shape: TracedShape,
      cutout: CutoutPlacement,
      depthMm: number,
      exportQuality: BuildQuality,
    ): Promise<BuildFitCheckResult> => {
      const request: BuildFitCheckRequest = {
        shape,
        cutout,
        depthMm,
        quality: exportQuality,
      };
      return ensureClient().call<BuildFitCheckResult>(BUILD_FIT_CHECK_METHOD, request, {
        channel: "fit-check-export",
      });
    },
    [ensureClient],
  );

  const buildSurfaceFitCheck = useCallback(
    (
      thicknessMm: number,
      exportQuality: BuildQuality,
    ): Promise<BuildSurfaceFitCheckResult> => {
      if (
        !layout ||
        (layout.cutouts.length === 0 && layout.fingerHoles.length === 0)
      ) {
        return Promise.reject(
          new Error("Add at least one tool pocket before exporting a surface fit test."),
        );
      }
      const request: BuildSurfaceFitCheckRequest = {
        spec,
        layout: {
          shapes: layout.shapes,
          cutouts: layout.cutouts,
          fingerHoles: layout.fingerHoles,
        },
        thicknessMm,
        quality: exportQuality,
      };
      return ensureClient().call<BuildSurfaceFitCheckResult>(
        BUILD_SURFACE_FIT_CHECK_METHOD,
        request,
        { channel: "surface-fit-check-export" },
      );
    },
    // requestKey encodes the current spec and layout by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestKey, ensureClient],
  );

  return {
    geometry,
    pocketFloorGeometry,
    stackingRimGeometry,
    hasPocketFloor,
    hasStackingRim,
    builtSpec,
    stats,
    cutoutReports,
    building,
    progress,
    error,
    buildOnce,
    buildFitCheck,
    buildSurfaceFitCheck,
  };
}
