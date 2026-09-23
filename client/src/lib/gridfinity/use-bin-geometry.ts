import type { ValidationIssue } from "@shared/gridfinity/validate";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BufferGeometry } from "three";

import type {
  CutoutPlacement,
  FingerHole,
  TracedShape,
} from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import type { SurfaceFitCheckStyle } from "@shared/gridfinity/fit-check";

import { toBufferGeometry } from "@/lib/mesh/to-buffer-geometry";
import { createWorkerClient, type WorkerClient } from "@/lib/worker/client";
import { WorkerCancelledError } from "@/lib/worker/protocol";

import {
  MULTICOLOR_FLOOR_THICKNESS_MM,
  MULTICOLOR_RIM_THICKNESS_MM,
  type BuildQuality,
} from "./bin";
import { needsProgressivePreview } from "./preview-policy";
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

/** Batch the first input; subsequent edits cannot postpone this deadline. */
const PREVIEW_THROTTLE_MS = 32;
/** Start expensive rounding only after input has settled and the draft finished. */
const REFINEMENT_IDLE_MS = 300;

type PreviewQueue = {
  running: boolean;
  pending: (() => Promise<void>) | null;
  timer: ReturnType<typeof setTimeout> | undefined;
};
const newPreviewQueue = (): PreviewQueue => ({ running: false, pending: null, timer: undefined });

export interface BinGeometryState {
  /** Latest built preview. Owned by the hook: disposed when replaced. */
  geometry: BufferGeometry | null;
  /** Pocket-floor material volume for the latest preview tier. */
  pocketFloorGeometry: BufferGeometry | null;
  /** Stacking-rim material volume for the latest preview tier. */
  stackingRimGeometry: BufferGeometry | null;
  /** True when the preview contains a pocket-floor material volume. */
  hasPocketFloor: boolean;
  /** True when the preview contains a stacking-rim material volume. */
  hasStackingRim: boolean;
  /** Spec that produced `geometry`; remains stable while a replacement builds. */
  builtSpec: BinSpec | null;
  /** Last detailed statistics; check statsAreStale before treating them as current. */
  stats: BuildBinStats | null;
  statsAreStale: boolean;
  /** Per-cutout build reports from the latest preview (emptied sections). */
  cutoutReports: CutoutBuildReport[];
  /** Solid warnings belong to the current detailed model, never a draft. */
  validationIssues: ValidationIssue[];
  /** The displayed geometry is simplified, even if refinement failed. */
  previewIsDraft: boolean;
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
    style?: SurfaceFitCheckStyle,
  ) => Promise<BuildSurfaceFitCheckResult>;
}

/**
 * Live bin geometry over the worker pipeline: spec in, `BufferGeometry` out,
 * with an interactive worker and a separate detail/export worker. Each preview
 * lane retains one physical RPC and one replaceable pending request.
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
  /** Live gesture values for preview only; exports still use the committed arguments above. */
  livePreview?: {
    spec: BinSpec;
    layout: BinGeometryLayout;
    /** Stable only during one transient gesture; omit for commits/project changes. */
    gesture?: object;
  },
): BinGeometryState {
  const previewSpec = livePreview?.spec ?? spec;
  const previewLayout = livePreview?.layout ?? layout;
  const clientRef = useRef<WorkerClient | null>(null);
  const interactiveClientRef = useRef<WorkerClient | null>(null);
  const previewQueueRef = useRef<PreviewQueue>(newPreviewQueue());
  const refinementQueueRef = useRef<PreviewQueue>(newPreviewQueue());
  const inputRef = useRef({ key: "", gesture: undefined as object | undefined, epoch: 0 });
  const sequenceRef = useRef(0);
  const displayedSequenceRef = useRef(0);
  const previousKeysRef = useRef<{ model: string; unrounded: string } | null>(null);
  const detailedCostsRef = useRef(new Map<string, number>());
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
  const [statsAreStale, setStatsAreStale] = useState(false);
  const [cutoutReports, setCutoutReports] = useState<CutoutBuildReport[]>([]);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [previewIsDraft, setPreviewIsDraft] = useState(false);
  const [building, setBuilding] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ensureClient = useCallback((): WorkerClient => {
    clientRef.current ??= createWorkerClient(
      () =>
        new Worker(new URL("./bin.worker.ts", import.meta.url), {
          type: "module", name: "pocketry-detail",
        }),
    );
    return clientRef.current;
  }, []);

  // At most two lazy workers. Detailed previews share the export worker;
  // interactive requests never wait behind either detailed builds or exports.
  const ensureInteractiveClient = useCallback((): WorkerClient => {
    interactiveClientRef.current ??= createWorkerClient(
      () => new Worker(new URL("./bin.worker.ts", import.meta.url), { type: "module", name: "pocketry-interactive" }),
    );
    return interactiveClientRef.current;
  }, []);

  // Plain-data value key so the effect ignores object identity churn.
  // Shape geometry is deliberately excluded: shapes are immutable by id in
  // the library, so id + pointCount fingerprints them.
  const modelInputs = useMemo(
    () =>
      ({
        spec: previewSpec,
        segments: quality.circularSegments,
        fingerHoleChordTolerance: quality.fingerHoleChordToleranceMm,
        budget: quality.cutoutVertexBudget,
        filletStep: quality.filletProfileStepMm,
        cutouts: previewLayout?.cutouts ?? [],
        fingerHoles: previewLayout?.fingerHoles ?? [],
        shapeKeys: previewLayout?.shapes.map((shape) => `${shape.id}:${shape.pointCount}`) ?? [],
        pocketFloorThicknessMm:
          previewMaterials.pocketFloorThicknessMm ??
          MULTICOLOR_FLOOR_THICKNESS_MM,
        stackingRimThicknessMm:
          previewMaterials.stackingRimThicknessMm ??
          MULTICOLOR_RIM_THICKNESS_MM,
      }),
    [
      previewSpec,
      quality.circularSegments,
      quality.fingerHoleChordToleranceMm,
      quality.cutoutVertexBudget,
      quality.filletProfileStepMm,
      previewLayout,
      previewMaterials.pocketFloorThicknessMm,
      previewMaterials.stackingRimThicknessMm,
    ],
  );

  const modelKey = useMemo(() => JSON.stringify(modelInputs), [modelInputs]);
  const requestKey = JSON.stringify([modelKey, section ?? null]);
  const gesture = livePreview?.gesture;
  // Layout effects invalidate the publication boundary before worker replies.
  // Returning to the same history entry starts a new epoch, so an old gesture
  // can never revive after undo, project replacement, or a completed gesture.
  useLayoutEffect(() => {
    const previous = inputRef.current;
    inputRef.current = { key: requestKey, gesture,
      epoch: previous.epoch + (previous.gesture !== gesture ? 1 : 0) };
  }, [requestKey, gesture]);

  useEffect(() => {
    let stale = false;
    let interactiveSettled = false;
    let idleReady = false;
    let refinementRequested = false;
    let detailedPublished = false;
    // Capture queue ownership for this worker lifetime, including StrictMode.
    const interactiveQueue = previewQueueRef.current;
    const refinementQueue = refinementQueueRef.current;
    const sequence = ++sequenceRef.current;
    const epoch = inputRef.current.epoch;
    const unroundedKey = JSON.stringify({ ...modelInputs,
      cutouts: previewLayout?.cutouts.map(c => ({ ...c, topFilletMm: 0, bottomFilletMm: 0 })) ?? [] });
    const previous = previousKeysRef.current;
    const sectionOnly = previous?.model === modelKey;
    const roundingOnly = previous?.unrounded === unroundedKey && previous.model !== modelKey;
    previousKeysRef.current = { model: modelKey, unrounded: unroundedKey };
    // Cost is reused for positional edits, but not across changed dimensions,
    // depth/rounding settings, materials, quality, or shape identities.
    const costKey = JSON.stringify({ ...modelInputs,
      cutouts: previewLayout?.cutouts.map(c => ({ ...c, position: undefined, rotationDeg: undefined })) ?? [] });
    const needsRefinement = !sectionOnly && needsProgressivePreview(
      previewSpec, previewLayout, quality, detailedCostsRef.current.get(costKey),
    );
    setBuilding(true);
    setProgress(0);
    setError(null);
    setStatsAreStale(true);
    setCutoutReports([]);
    setValidationIssues([]);

    const request: BuildBinRequest = {
      spec: previewSpec,
      quality,
      layout:
        previewLayout && (previewLayout.cutouts.length > 0 || previewLayout.fingerHoles.length > 0)
          ? { shapes: previewLayout.shapes, cutouts: previewLayout.cutouts, fingerHoles: previewLayout.fingerHoles }
          : undefined,
      section: section ?? undefined,
      pocketFloorMaterialThicknessMm:
        previewMaterials.pocketFloorThicknessMm ?? MULTICOLOR_FLOOR_THICKNESS_MM,
      stackingRimMaterialThicknessMm:
        previewMaterials.stackingRimThicknessMm ?? MULTICOLOR_RIM_THICKNESS_MM,
    };

    const publish = (result: BuildBinResult, draft: boolean, interactive = false) => {
      const current = inputRef.current;
      const obsolete = stale || current.key !== requestKey;
      const intermediate = obsolete && interactive && gesture !== undefined &&
        current.gesture === gesture && current.epoch === epoch;
      if ((obsolete && !intermediate) || sequence < displayedSequenceRef.current || (draft && detailedPublished)) return;
      displayedSequenceRef.current = sequence;
      const next = toBufferGeometry(result.materialMeshes?.body ?? result.mesh);
      const nextPocketFloor = result.materialMeshes?.pocketFloors
        ? toBufferGeometry(result.materialMeshes.pocketFloors) : null;
      const nextStackingRim = result.materialMeshes?.stackingRim
        ? toBufferGeometry(result.materialMeshes.stackingRim) : null;
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
      setBuiltSpec(previewSpec);
      setPreviewIsDraft(draft);
      // Approximate volumes and collapse reports must not masquerade as the
      // final model. Keep exports independent of displayed preview geometry.
      if (!draft && !intermediate) {
        setStats(result.stats);
        setStatsAreStale(false);
        setCutoutReports(result.cutoutReports ?? []);
        setValidationIssues(result.validationIssues ?? []);
      }
      if (!intermediate) {
        setError(null);
        setBuilding(draft);
        setProgress(draft ? 0 : 1);
      }
      if (!draft) detailedPublished = true;
    };

    const rememberCost = (result: BuildBinResult) => {
      if (section) return;
      const costs = detailedCostsRef.current;
      if (costs.size >= 16 && !costs.has(costKey)) costs.delete(costs.keys().next().value!);
      costs.set(costKey, result.stats.buildMs);
    };
    const enqueue = (queue: PreviewQueue, job: () => Promise<void>) => {
      if (queue.running) queue.pending = job;
      else void job();
    };
    const drain = (queue: PreviewQueue) => {
      queue.running = false;
      const next = queue.pending;
      queue.pending = null;
      if (next) void next();
    };
    const refine = async () => {
      refinementQueue.running = true;
      try {
        const result = await ensureClient().call<BuildBinResult>(BUILD_BIN_METHOD, request, {
          channel: "preview",
          onProgress: (value) => { if (!stale) setProgress(value); },
        });
        rememberCost(result);
        publish(result, false);
      } catch (cause: unknown) {
        if (stale || cause instanceof WorkerCancelledError) return;
        setError(`Detailed preview failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        setBuilding(false);
      } finally {
        drain(refinementQueue);
      }
    };
    const maybeRefine = () => {
      if (stale || !needsRefinement || !interactiveSettled || !idleReady || refinementRequested) return;
      refinementRequested = true;
      enqueue(refinementQueue, refine);
    };
    const buildInteractive = async () => {
      interactiveQueue.running = true;
      try {
        const result = await ensureInteractiveClient().call<BuildBinResult>(
          BUILD_BIN_METHOD,
          needsRefinement ? { ...request, previewDraft: roundingOnly ? "rounded" : true } : request,
          {
            channel: "preview",
            onProgress: (value) => { if (!stale) setProgress(value); },
          },
        );
        if (!needsRefinement) rememberCost(result);
        publish(result, needsRefinement, true);
      } catch (cause: unknown) {
        if (stale || cause instanceof WorkerCancelledError) return;
        // A draft is optional. If it fails, try the authored detailed geometry
        // before reporting an error; a failed simple build has no fallback.
        if (!needsRefinement) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setBuilding(false);
        }
      } finally {
        interactiveSettled = true;
        drain(interactiveQueue);
        maybeRefine();
      }
    };
    // Throttle, rather than restart a debounce on every pointer event: a
    // continuous 60/120 Hz drag must still produce drafts. Once a job is in
    // flight, its completion immediately drains the newest pending edit.
    interactiveQueue.pending = buildInteractive;
    if (!interactiveQueue.running && interactiveQueue.timer === undefined) {
      interactiveQueue.timer = setTimeout(() => {
        interactiveQueue.timer = undefined;
        const next = interactiveQueue.pending;
        interactiveQueue.pending = null;
        if (next) void next();
      }, PREVIEW_THROTTLE_MS);
    }
    const idleTimer = needsRefinement ? setTimeout(() => {
      idleReady = true;
      maybeRefine();
    }, REFINEMENT_IDLE_MS) : undefined;

    return () => {
      stale = true;
      clearTimeout(idleTimer);
      if (interactiveQueue.pending === buildInteractive) interactiveQueue.pending = null;
      if (refinementQueue.pending === refine) refinementQueue.pending = null;
    };
    // requestKey encodes spec + quality + layout by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, ensureClient, ensureInteractiveClient]);

  // Tear the worker down with the workspace.
  useEffect(
    () => () => {
      inputRef.current = { key: "", gesture: undefined, epoch: inputRef.current.epoch + 1 };
      previousKeysRef.current = null;
      previewQueueRef.current.pending = null;
      clearTimeout(previewQueueRef.current.timer);
      previewQueueRef.current = newPreviewQueue();
      refinementQueueRef.current.pending = null;
      refinementQueueRef.current = newPreviewQueue();
      interactiveClientRef.current?.dispose();
      interactiveClientRef.current = null;
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
        exportTopology: true,
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
    [requestKey, ensureClient, spec, layout],
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
      style: SurfaceFitCheckStyle = "full",
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
        style,
        quality: exportQuality,
      };
      return ensureClient().call<BuildSurfaceFitCheckResult>(
        BUILD_SURFACE_FIT_CHECK_METHOD,
        request,
        { channel: "surface-fit-check-export" },
      );
    },
    // A commit can change export inputs without changing the live preview key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestKey, ensureClient, spec, layout],
  );

  return {
    geometry,
    pocketFloorGeometry,
    stackingRimGeometry,
    hasPocketFloor,
    hasStackingRim,
    builtSpec,
    stats,
    statsAreStale,
    cutoutReports,
    validationIssues,
    previewIsDraft,
    building,
    progress,
    error,
    buildOnce,
    buildFitCheck,
    buildSurfaceFitCheck,
  };
}
