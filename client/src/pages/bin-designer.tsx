import { surfaceTextZ } from "@/lib/gridfinity/surface-text";
import { DEFAULT_BIN_MATERIALS, type BinMaterials } from "@shared/gridfinity/materials";
import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { SelectionLinkControls } from "@/components/gridfinity/linked-design-controls";
import { retainTransformOrigins } from "@shared/gridfinity/transform-origins";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { ToastAction } from "@/components/ui/toast";
import { usePocketGeometry } from "@/hooks/use-pocket-geometry";
import { Box, History, Redo2, Undo2 } from "lucide-react";
import { defaultPocketFloorThicknessMm, pocketDepths, pocketName, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CanvasWarnings } from "@/components/gridfinity/canvas-warnings";
import { validateBinSpec, validateLayout, validatePocketFloorMaterials, type ValidationIssue } from "@shared/gridfinity/validate";
import { issueSettingsTarget } from "@/lib/gridfinity/issue-settings";
import { MobileBinActions } from "@/components/gridfinity/mobile-bin-actions";
import { BinControlsPanel } from "@/components/gridfinity/bin-controls-panel";
import { BinViewport, type MaterialColorTarget } from "@/components/gridfinity/bin-viewport";
import { LayoutCanvas } from "@/components/gridfinity/layout-canvas";
import { EditHistoryMenu } from "@/components/history/edit-history-menu";
import { usePanelState } from "@/components/layout/panel-context";
import { BinEditingWorkspace } from "@/components/gridfinity/selection-inspector";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { canHandleCanvasShortcut } from "@/lib/canvas-keyboard";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectDoc,
} from "@shared/gridfinity/project";
import { placementFootprint } from "@shared/gridfinity/cutout";
import { SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM, type SurfaceFitCheckStyle } from "@shared/gridfinity/fit-check";

import {
  autoArrangeLayout,
  autoPlaceFresh,
  autoPlaceIncremental,
} from "@/lib/gridfinity/autoplace";
import {
  binDimensionsMm,
  EXPORT_QUALITY,
  PREVIEW_QUALITY,
} from "@/lib/gridfinity/bin";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import { placedPocketSplitBoundaries } from "@/lib/gridfinity/layout-measure";
import type { BuildBinSection } from "@/lib/gridfinity/worker-api";
import { downloadBlob } from "@/lib/download";
import {
  binSizeLabel,
  downloadModelWithProject,
  exportFilePart,
  prepareProjectExport,
} from "@/lib/project/export";
import { generateLayoutDXF, generateLayoutSVG } from "@/lib/export/layout";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf, type ThreeMfObject } from "@/lib/mesh/threemf";
import {
  createDebouncedProjectSaver,
  deleteProjectFromLibrary,
  duplicateProjectInLibrary,
  exportProjectLibrary,
  importProjectLibrary,
  importProjectToLibrary,
  loadProjectDoc,
  loadProjectLibrary,
  openProjectFromLibrary,
  renameProjectInLibrary,
  saveProjectDoc,
  saveProjectToLibrary,
  startNewProject,
  type ProjectLibrarySnapshot,
} from "@/lib/project/persist";
import type { LibraryImportMode } from "@shared/gridfinity/library";
import { cn } from "@/lib/utils";
import { WorkerCancelledError } from "@/lib/worker/protocol";
import {
  BinProvider,
  getCommittedBinDoc,
  INITIAL_BIN_SPEC,
  useBin,
  type BinViewMode,
} from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";

const EMPTY_PROJECT_LIBRARY: ProjectLibrarySnapshot = {
  activeProjectId: null,
  projects: [],
};

/**
 * The Gridfinity bin designer workspace (milestone G3): traced shapes arrive
 * from the trace workspace through the app-level shape library, get
 * auto-placed into an auto-sized **solid** bin, and can be moved/rotated in
 * the 2D Layout view; the 3D view previews the worker-built pockets.
 */
export default function BinDesignerPage(): JSX.Element {
  return (
    <BinProvider>
      <BinDesignerWorkspace />
    </BinProvider>
  );
}

function BinDesignerWorkspace(): JSX.Element {
  const { inspectorEnabled: inspectorPrototype, enabled: experimentalEnabled, setEnabled: setExperimentalEnabled, setSettingsOpen } = useExperimentalFeatures();
  const { panelOpen, setPanelOpen, libraryRequested } = usePanelState();
  const [quickAdjustOpen, setQuickAdjustOpen] = useState(false);
  const [pocketEditorRequest, setPocketEditorRequest] = useState(0);
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<{ id: string; focusId?: string }>();
  useEffect(() => {
    if (!libraryRequested) return;
    setSettingsSectionRequest({ id: "bin-settings-project" });
    setPanelOpen(true);
  }, [libraryRequested, setPanelOpen]);
  const editMaterialColor = (target: MaterialColorTarget) => {
    if (target === "text" && !experimentalEnabled) { setSettingsOpen(true); return; }
    setSettingsSectionRequest({ id: "bin-settings-materials", focusId: `input-${target}-color` });
    setPanelOpen(true);
  };
  const editSelectedPocket = () => {
    setSettingsSectionRequest(undefined);
    if (!isMobile) {
      if (!inspectorPrototype) setPanelOpen(true);
      setPocketEditorRequest((request) => request + 1);
    }
  };
  const { toast } = useToast();
  const bin = useBin();
  useEffect(() => {
    if (bin.editError?.startsWith("Enable experimental tools")) toast({ title: "Change not applied", description: bin.editError,
      action: <ToastAction altText="Enable experimental tools" onClick={() => setExperimentalEnabled(true)}>Enable tools</ToastAction> });
  }, [bin.editError, setExperimentalEnabled, toast]);
  const { spec, cutouts, fingerHoles, viewMode, dispatch } = bin;
  const isMobile = useIsMobile();
  const [textPositionRequest, setTextPositionRequest] = useState(0);
  const editSurfaceText = (id: string, inline = false) => {
    if (!experimentalEnabled) return;
    dispatch({ type: "SELECT_SURFACE_TEXT", id });
    if (!isMobile && inspectorPrototype) setPocketEditorRequest(request => request + 1);
    if (!isMobile || panelOpen) setSettingsSectionRequest({ id: "bin-settings-text" });
    if (!inspectorPrototype && !isMobile) setPanelOpen(true);
  };
  const positionText = () => {
    dispatch({ type: "SELECT_SURFACE_TEXT", id: bin.selectedSurfaceTextId });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    setTextPositionRequest(request => request + 1);
    setSettingsSectionRequest({ id: "bin-settings-text" });
    // The standard mobile drawer covers the canvas; return to it for dragging.
    setPanelOpen(!isMobile);
  };
  useEffect(() => {
    if (isMobile && bin.editorMode !== "placement") setPanelOpen(false);
  }, [bin.editorMode, isMobile, setPanelOpen]);
  useEffect(() => {
    if (panelOpen || !isMobile || bin.editorMode !== "placement") setQuickAdjustOpen(false);
  }, [panelOpen, isMobile, bin.editorMode]);
  const library = useShapeLibrary();
  // Sliders and canvas drags update the visible controls transiently, but the
  // history entry remains the last committed design until pointer-up. Exports
  // and autosaves retain that snapshot; the interactive preview also receives
  // live gesture values so its fast drafts can follow the controls.
  const committedDoc = getCommittedBinDoc(bin);
  const committedSpec = committedDoc.spec;
  const committedCutouts = committedDoc.cutouts;
  const committedFingerHoles = committedDoc.fingerHoles;
  // Present current terminology for older saved history without rewriting it.
  const historyEntries = useMemo(() => bin.history.stack.map(({ label }) => ({
    label: label.replace(/\bfinger[ -]holes?\b/gi, (term) =>
      term.startsWith("F") ? "Finger access" : "finger access"),
  })), [bin.history.stack]);

  const [exporting, setExporting] = useState(false);
  const [section, setSection] = useState<BuildBinSection | null>(null);
  const [hideInspectionPocketOutline, setHideInspectionPocketOutline] = useState(false);
  const [materials, setMaterials] = useState<BinMaterials>(DEFAULT_BIN_MATERIALS);
  const { binColor, pocketFloorColor, stackingRimColor, colorPocketFloors,
    colorStackingRim, pocketFloorThicknessMm, stackingRimThicknessMm, borderWidthMm } = materials;
  const patchMaterials = (patch: Partial<BinMaterials>) => setMaterials(current => ({ ...current, ...patch }));
  const edgeBandColor = colorStackingRim ? stackingRimColor : binColor;
  const [projectLibrary, setProjectLibrary] = useState(EMPTY_PROJECT_LIBRARY);
  const [projectLibraryReady, setProjectLibraryReady] = useState(false);
  const [projectRestoreFailed, setProjectRestoreFailed] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [projectLibraryError, setProjectLibraryError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [keepBinSize, setKeepBinSize] = useState(false);

  // One validation result drives both the canvas feedback and export gates,
  // including when the controls are collapsed or the mobile drawer is closed.
  const layoutIssues = useMemo(() => {
    const shapesById = new Map(library.shapes.map((shape) => [shape.id, shape]));
    return [
      ...validateBinSpec(spec).issues,
      ...validateLayout(spec, cutouts, shapesById, fingerHoles),
      ...validatePocketFloorMaterials(spec, cutouts, shapesById, colorPocketFloors ? pocketFloorThicknessMm : 0),
    ];
  }, [spec, cutouts, fingerHoles, library.shapes, colorPocketFloors, pocketFloorThicknessMm]);
  const revealIssue = (issue: ValidationIssue) => {
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    const settings = issueSettingsTarget(issue.code);
    if (settings) {
      setPanelOpen(true);
      setSettingsSectionRequest(settings);
      return;
    }
    if (issue.cutoutIds?.length) {
      const next = issue.cutoutIds.find((id) => id !== bin.selectedCutoutId) ?? issue.cutoutIds[0];
      dispatch({ type: "SELECT_CUTOUT", id: next });
      editSelectedPocket();
    } else {
      setPanelOpen(true);
      if (issue.fingerHoleIds?.length) {
        dispatch({ type: "SELECT_FINGER_HOLE", id: issue.fingerHoleIds[0] });
        setSettingsSectionRequest({ id: "bin-settings-finger-holes" });
      } else {
        setSettingsSectionRequest({ id: "bin-settings-size" });
      }
    }
  };

  // Restore the saved project before anything else touches state; pending
  // consumption below is gated on `hydrated` so an arrival from the trace
  // workspace places into the *restored* layout, not the empty default.
  useEffect(() => {
    let cancelled = false;
    void loadProjectDoc().then(async (doc) => {
      if (cancelled) return;
      let saved: ProjectLibrarySnapshot;
      try {
        saved = await loadProjectLibrary(doc);
      } catch (cause) {
        if (cancelled) return;
        saved = await loadProjectLibrary().catch(error => {
          if (!cancelled) setProjectLibraryError(error instanceof Error ? error.message : "The browser library could not be read.");
          return EMPTY_PROJECT_LIBRARY;
        });
        // A failed restore must never bind this older in-memory document to
        // another tab's current autosave target.
        saved = { ...saved, activeProjectId: null };
        if (cancelled) return;
        setProjectRestoreFailed(true);
        setSaveStatus("error");
        setSaveError(cause instanceof Error ? cause.message : "The saved project could not be recovered. Keep this page open and download a backup.");
        toast({ title: "Could not restore project to library",
          description: `${cause instanceof Error ? cause.message : String(cause)} Your current design is still open. Export it or save it with a new name to keep your work.`,
          variant: "destructive" });
      }
      if (cancelled) return;
      setProjectLibrary(saved);
      setProjectLibraryReady(true);
      const restoredName = saved.projects.find((project) => project.id === saved.activeProjectId)?.name;
      if (doc?.name && restoredName && restoredName !== doc.name) {
        toast({ title: "Project recovered",
          description: `Your latest work was saved as “${restoredName}”. The earlier library version is still available.` });
      }
      if (doc) {
        setDraftName(doc.name ?? null);
        setKeepBinSize(doc.keepBinSize ?? false);
        setMaterials(doc.materials ?? DEFAULT_BIN_MATERIALS);
        library.mergeShapes(doc.shapes);
        dispatch({
          type: "HYDRATE",
          spec: doc.spec,
          cutouts: doc.cutouts,
          fingerHoles: doc.fingerHoles,
          history: doc.history,
          transformOrigins: doc.transformOrigins,
        });
      } else {
        dispatch({ type: "MARK_HYDRATED" });
      }
    }).catch(async cause => {
      if (cancelled) return;
      setProjectRestoreFailed(true);
      setSaveStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "The saved project could not be read. Reload to retry; stored work has been kept intact.");
      // Keep the saved library available for backup even when the working copy
      // cannot be opened. Never hydrate or autosave the empty fallback design.
      try {
        const saved = await loadProjectLibrary();
        if (!cancelled) setProjectLibrary({ ...saved, activeProjectId: null });
      } catch (error) {
        if (!cancelled) setProjectLibraryError(error instanceof Error ? error.message : "The browser library could not be read.");
      }
      if (!cancelled) setProjectLibraryReady(true);
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: the doc is read once per workspace visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentProjectName = useMemo(
    () =>
      projectLibrary.projects.find(
        (project) => project.id === projectLibrary.activeProjectId,
      )?.name ?? draftName,
    [projectLibrary, draftName],
  );

  // Autosave everything the doc covers, debounced; suppressed until
  // hydration so the empty default never overwrites a real project.
  const saveProject = useMemo(() => createDebouncedProjectSaver(500, (success, error) => {
    setSaveStatus(success ? "saved" : "error");
    setSaveError(success ? null : error?.name === "QuotaExceededError"
      ? "Browser storage is full. Keep this page open and download a backup of your edits."
      : error?.message ?? "Could not save in this browser. Keep this page open and download a backup of your edits.");
  }), []);
  const currentProjectDoc = useMemo<ProjectDoc>(
    () => ({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      ...(currentProjectName ? { name: currentProjectName } : {}),
      keepBinSize,
      materials,
      shapes: library.shapes,
      ...committedDoc,
      history: bin.history,
      transformOrigins: retainTransformOrigins(bin.transformOrigins, bin.history.stack.map(e => e.doc)),
    }),
    [library.shapes, committedDoc, bin.history, bin.transformOrigins, currentProjectName, keepBinSize, materials],
  );
  useEffect(() => {
    if (!bin.hydrated || projectBusy || projectRestoreFailed) return;
    setSaveStatus("saving");
    saveProject(currentProjectDoc, projectLibrary.activeProjectId);
  }, [bin.hydrated, currentProjectDoc, saveProject, projectLibrary.activeProjectId, projectBusy, projectRestoreFailed]);

  useEffect(() => {
    const flush = () => { void saveProject.flush(); };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [saveProject]);

  // Exports and autosaves use the same committed design/history snapshot.
  const exportProjectDoc = currentProjectDoc;

  // Consume shapes freshly arrived from the trace workspace: auto-place them
  // (incrementally when the bin already has arranged pockets) and make sure
  // the bin is solid — pockets need material.
  useEffect(() => {
    if (!bin.hydrated) return;
    const pendingIds = library.consumePending();
    if (pendingIds.length === 0) return;
    const newShapes = library.shapes.filter((shape) => pendingIds.includes(shape.id) && !cutouts.some((cutout) => cutout.shapeId === shape.id));
    if (newShapes.length === 0) return;

    const shapesById = new Map(library.shapes.map((shape) => [shape.id, shape]));
    const result =
      cutouts.length === 0 && !keepBinSize
        ? autoPlaceFresh(newShapes, spec.lip, spec.gridPitch)
        : autoPlaceIncremental(newShapes, {
            spec,
            lip: spec.lip,
            gridPitch: spec.gridPitch,
            gridX: spec.gridX,
            gridY: spec.gridY,
            existing: cutouts,
            keepBinSize,
            shapesById,
          });

    const gridX = keepBinSize ? spec.gridX : Math.max(result.gridX, cutouts.length > 0 ? spec.gridX : 0);
    const gridY = keepBinSize ? spec.gridY : Math.max(result.gridY, cutouts.length > 0 ? spec.gridY : 0);
    dispatch({
      type: "ADD_PLACED",
      cutouts: result.cutouts.map(cutout => {
        const chosen = library.pendingDepths[cutout.shapeId];
        return { ...cutout, depth: chosen?.mode === "to-floor"
          ? { mode: "remaining" as const, floorThicknessMm: defaultPocketFloorThicknessMm(spec) }
          : chosen ?? cutout.depth };
      }),
      gridX,
      gridY,
      // Automatic placement chooses the smallest rectangular Gridfinity bin.
      // Irregular footprints require the explicit footprint editor.
      footprint: keepBinSize ? spec.footprint : { kind: "rectangle" },
    });
    if (gridX !== spec.gridX || gridY !== spec.gridY) toast({ title: "Bin resized for new tools", description: "Undo restores the previous layout. Turn on Keep bin size fixed to prevent automatic growth." });
    if (spec.fill !== "solid") {
      dispatch({ type: "PATCH_SPEC", patch: { fill: "solid" } });
    }
    if (result.overflow) {
      toast({
        title: "Tool does not fit",
        description:
          keepBinSize ? "The bin size is fixed. Move the highlighted tools, reduce their size, or enlarge the bin." : "Even the largest bin cannot hold this layout — check the trace's scale.",
        variant: "destructive",
      });
    }
    // Pending arrivals and hydration are the triggers; the rest reads fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.pendingIds, bin.hydrated]);

  // Only the shapes the layout references ride along to the worker.
  const layout = useMemo(() => {
    const referenced = new Set(cutouts.map((cutout) => cutout.shapeId));
    return {
      shapes: library.shapes.filter((shape) => referenced.has(shape.id)),
      cutouts,
      fingerHoles,
    };
  }, [library.shapes, cutouts, fingerHoles]);

  const committedLayout = useMemo(() => {
    const referenced = new Set(
      committedCutouts.map((cutout) => cutout.shapeId),
    );
    return {
      shapes: library.shapes.filter((shape) => referenced.has(shape.id)),
      cutouts: committedCutouts,
      fingerHoles: committedFingerHoles,
    };
  }, [library.shapes, committedCutouts, committedFingerHoles]);

  const measurementShapes = useMemo(() => new Map(layout.shapes.map(shape => [shape.id, shape])), [layout.shapes]);
  const measurementTop = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  const profileOutlines = usePocketGeometry(layout.cutouts, measurementShapes, spec);
  const measurementOutlines = useMemo(() => {
    return layout.cutouts.flatMap((cutout) => {
      const shape = measurementShapes.get(cutout.shapeId);
      if (!shape) return [];
      const outline = cutout.profileBottom || hasRigidPocket(cutout) ? profileOutlines.get(cutout.id)?.opening
        ?? [] : placementFootprint(shape, cutout).outline;
      return outline.length ? [outline] : [];
    });
  }, [layout, measurementShapes, measurementTop, profileOutlines]);

  const measurementSplitBoundaries = useMemo(
    () => placedPocketSplitBoundaries(layout.cutouts, new Map(layout.shapes.map(shape => [shape.id, shape]))),
    [layout],
  );

  const {
    geometry,
    textGeometries,
    pocketFloorGeometry,
    stackingRimGeometry,
    hasPocketFloor,
    hasStackingRim,
    builtSpec,
    stats,
    statsAreStale,
    cutoutReports,
    validationIssues: solidIssues = [],
    previewIsDraft,
    building,
    progress,
    error,
    retryPreview,
    buildOnce,
    buildFitCheck,
    buildSurfaceFitCheck,
  } = useBinGeometry(
    committedSpec,
    PREVIEW_QUALITY,
    committedLayout,
    section,
    { pocketFloorThicknessMm, stackingRimThicknessMm, borderWidthMm },
    { spec, layout, gesture: spec !== committedSpec || cutouts !== committedCutouts || fingerHoles !== committedFingerHoles ? committedDoc : undefined },
  );

  // Pure and worker validation can both report the same invalid insertion.
  const issues = [...layoutIssues, ...solidIssues.filter(issue => !layoutIssues.some(local =>
    local.code === issue.code && local.message === issue.message && local.severity === issue.severity
    && JSON.stringify(local.cutoutIds) === JSON.stringify(issue.cutoutIds)))];
  const editablePockets = useMemo(() => cutouts.flatMap(cutout => {
    const shape = library.shapes.find(shape => shape.id === cutout.shapeId);
    return shape ? [{ cutout, shape }] : [];
  }), [cutouts, library.shapes]);

  // Keep the camera matched to the mesh that is actually on screen. If the
  // requested dimensions change, the old mesh and framing stay untouched
  // until the worker delivers their replacement together.
  const builtDimensions = useMemo(
    () => binDimensionsMm(builtSpec ?? committedSpec),
    [builtSpec, committedSpec],
  );
  const fitSize = useMemo(() => {
    return {
      widthMm: builtDimensions.widthMm,
      lengthMm: builtDimensions.lengthMm,
      heightMm: builtDimensions.totalHeightMm,
    };
  }, [builtDimensions]);

  // Surface collapsed cutouts once per occurrence, not once per rebuild.
  const emptiedSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const report of cutoutReports) {
      if (report.emptied && !emptiedSeenRef.current.has(report.id)) {
        emptiedSeenRef.current.add(report.id);
        const cutout = cutouts.find((c) => c.id === report.id);
        const shape = layout.shapes.find((s) => s.id === cutout?.shapeId);
        toast({
          title: "Pocket vanished",
          description: `“${cutout ? pocketName(cutout, shape) : "A pocket"}” collapsed under its clearance/corner settings — increase clearance toward zero or reduce outline corner rounding.`,
          variant: "destructive",
        });
      }
      if (!report.emptied) emptiedSeenRef.current.delete(report.id);
    }
  }, [cutoutReports, cutouts, layout.shapes, toast]);

  const handleAutoArrange = useCallback(() => {
    const shapesById = new Map(library.shapes.map((shape) => [shape.id, shape]));
    const result = autoArrangeLayout(
      cutouts,
      shapesById,
      spec.lip,
      spec.gridPitch,
      fingerHoles,
      undefined,
      keepBinSize ? spec : undefined,
    );
    if (!result) return;
    dispatch({
      type: "REPLACE_LAYOUT",
      cutouts: result.cutouts,
      gridX: result.gridX,
      gridY: result.gridY,
      // Rearranging tools must not silently convert the bin into an irregular
      // footprint. That remains an explicit Layout editing operation.
      footprint: keepBinSize ? spec.footprint : { kind: "rectangle" },
      historyLabel: "Auto-arrange tool pockets",
    });
    if (result.overflow) {
      toast({
        title: "Does not fit",
        description: keepBinSize ? "The bin size is fixed. Adjust the highlighted pockets or increase the bin size." : "Even the largest bin cannot hold this arrangement.",
        variant: "destructive",
      });
    }
  }, [cutouts, fingerHoles, library.shapes, spec.lip, spec.gridPitch, dispatch, toast, keepBinSize, spec]);

  const handleExportLayout = useCallback(
    async (format: "dxf" | "svg", includeProject: boolean) => {
      const { spec, cutouts, fingerHoles, shapes } = exportProjectDoc;
      const shapesById = new Map(shapes.map((shape) => [shape.id, shape]));
      const project = prepareProjectExport(exportProjectDoc, currentProjectName, "layout");
      const model = format === "dxf"
        ? new Blob([await generateLayoutDXF(spec, cutouts, shapesById, fingerHoles)], { type: "application/dxf" })
        : new Blob([await generateLayoutSVG(spec, cutouts, shapesById, fingerHoles)], { type: "image/svg+xml" });
      downloadModelWithProject(model, format, project, includeProject);
    },
    [exportProjectDoc, currentProjectName],
  );

  const handleExportProject = useCallback(() => {
    const project = prepareProjectExport(currentProjectDoc, currentProjectName);
    downloadBlob(
      project.backup,
      `${project.baseName}.pocketry.json`,
    );
    toast({
      title: "Backup exported",
      description: "Created a portable Pocketry JSON backup.",
    });
  }, [currentProjectDoc, currentProjectName, toast]);

  const handleExportLibrary = useCallback(async () => {
    setProjectBusy(true);
    try {
      const backup = await exportProjectLibrary(bin.hydrated ? currentProjectDoc : undefined);
      downloadBlob(
        new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
        `pocketry-library-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
      toast({ title: "Library exported", description: `${backup.projects.length} named designs exported as JSON.` });
    } catch (cause) {
      toast({ title: "Could not export library", description: cause instanceof Error ? cause.message : "The library could not be read.", variant: "destructive" });
    } finally {
      setProjectBusy(false);
    }
  }, [currentProjectDoc, bin.hydrated, toast]);

  const handleImportLibrary = useCallback(async (file: File, mode: LibraryImportMode): Promise<boolean> => {
    setProjectBusy(true);
    if (mode === "replace") saveProject.cancel();
    try {
      let input: unknown;
      try {
        input = JSON.parse(await file.text());
      } catch {
        throw new Error("The file could not be read as JSON. No designs were imported.");
      }
      const result = await importProjectLibrary(input, mode, mode === "replace" ? currentProjectDoc : undefined);
      setProjectLibrary(result.library);
      if (mode === "replace") setDraftName(null);
      toast({
        title: mode === "replace" ? "Library replaced" : "Library imported",
        description: mode === "replace"
          ? `${result.imported} designs imported. Your current design is still open as an unnamed draft.`
          : `${result.imported} designs added, ${result.upgraded} upgraded, ${result.renamed} renamed.`,
      });
      return true;
    } catch (cause) {
      toast({ title: "Could not import library", description: cause instanceof Error ? cause.message : "No designs were imported.", variant: "destructive" });
      return false;
    } finally {
      setProjectBusy(false);
    }
  }, [toast, saveProject, currentProjectDoc]);

  /** Save while the outgoing named project still owns the autosave target. */
  const saveBeforeReplacingProject = useCallback(async () => {
    saveProject.cancel();
    if (!projectLibrary.activeProjectId) return;
    const saved = await saveProjectDoc(currentProjectDoc, projectLibrary.activeProjectId);
    setSaveStatus(saved ? "saved" : "error");
    if (!saved) setSaveError("Your current changes could not be saved. Keep this page open and download a backup before switching projects.");
    if (!saved) throw new Error("Your current changes could not be saved. The current project has been kept open.");
  }, [saveProject, currentProjectDoc, projectLibrary.activeProjectId]);

  const handleImportProject = useCallback(
    async (input: ProjectDoc): Promise<boolean> => {
      setProjectBusy(true);
      try {
        await saveBeforeReplacingProject();
        const opened = await importProjectToLibrary(input);
        const { doc } = opened;
        setDraftName(null);
        setKeepBinSize(doc.keepBinSize ?? false);
        setMaterials(doc.materials ?? DEFAULT_BIN_MATERIALS);
        library.replaceShapes(doc.shapes);
        dispatch({
          type: "HYDRATE",
          spec: doc.spec,
          cutouts: doc.cutouts,
          fingerHoles: doc.fingerHoles,
          history: doc.history,
          transformOrigins: doc.transformOrigins,
        });
        setSection(null);
        setProjectLibrary(opened.library);
        setProjectRestoreFailed(false);
        toast({
          title: "Backup imported",
          description: `${doc.shapes.length} shape${doc.shapes.length === 1 ? "" : "s"}, ${doc.cutouts.length} pocket${doc.cutouts.length === 1 ? "" : "s"}. Saved to your library and opened as “${doc.name}”.`,
        });
        return true;
      } catch (cause) {
        toast({
          title: "Could not import backup",
          description: cause instanceof Error ? cause.message : String(cause),
          variant: "destructive",
        });
        return false;
      } finally {
        setProjectBusy(false);
      }
    },
    [library, dispatch, saveBeforeReplacingProject, toast],
  );

  const handleNewProject = useCallback(async (saveDraftName?: string): Promise<boolean> => {
    const doc: ProjectDoc = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shapes: [],
      spec: INITIAL_BIN_SPEC,
      cutouts: [],
      fingerHoles: [],
    };
    setProjectBusy(true);
    try {
      await saveBeforeReplacingProject();
      const saved = saveDraftName === undefined ? await startNewProject(doc)
        : await startNewProject(doc, { doc: currentProjectDoc, name: saveDraftName });
      setDraftName(null);
      setKeepBinSize(false);
      setMaterials(DEFAULT_BIN_MATERIALS);
      library.replaceShapes([]);
      dispatch({
        type: "HYDRATE",
        spec: doc.spec,
        cutouts: doc.cutouts,
        fingerHoles: doc.fingerHoles,
        history: doc.history,
        transformOrigins: doc.transformOrigins,
      });
      setSection(null);
      setProjectLibrary(saved);
      setProjectRestoreFailed(false);
      toast({
        title: "New project ready",
        description: saveDraftName === undefined ? "Ready for a new design." : `Your draft was saved as “${saveDraftName.trim()}” in this browser’s library.`,
      });
      return true;
    } catch (cause) {
      toast({
        title: "Could not start project",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
      return false;
    } finally {
      setProjectBusy(false);
    }
  }, [library, dispatch, saveBeforeReplacingProject, currentProjectDoc, toast]);

  const handleSaveProject = useCallback(async (name: string): Promise<boolean> => {
    setProjectBusy(true);
    saveProject.cancel();
    try {
      const saved = await saveProjectToLibrary(
        currentProjectDoc,
        name,
        projectLibrary.activeProjectId,
      );
      setProjectLibrary(saved);
      setProjectRestoreFailed(false);
      toast({
        title: "Project saved",
        description: "It will keep updating automatically in this browser’s library.",
      });
      return true;
    } catch (cause) {
      toast({
        title: "Could not save project",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
      return false;
    } finally {
      setProjectBusy(false);
    }
  }, [currentProjectDoc, projectLibrary.activeProjectId, saveProject, toast]);

  const handleDuplicateProject = useCallback(async (projectId: string): Promise<string | null> => {
    setProjectBusy(true);
    try {
      const copied = await duplicateProjectInLibrary(projectId, currentProjectDoc);
      setProjectLibrary(copied.library);
      toast({ title: "Project duplicated", description: copied.project.name });
      return copied.project.id;
    } catch (cause) {
      toast({
        title: "Could not duplicate project",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
      return null;
    } finally {
      setProjectBusy(false);
    }
  }, [currentProjectDoc, toast]);

  const handleRenameProject = useCallback(async (projectId: string, name: string): Promise<boolean> => {
    setProjectBusy(true);
    const active = projectId === projectLibrary.activeProjectId;
    if (active) saveProject.cancel();
    try {
      const saved = active
        ? await saveProjectToLibrary(currentProjectDoc, name, projectId)
        : await renameProjectInLibrary(projectId, name);
      setProjectLibrary(saved);
      if (active) setProjectRestoreFailed(false);
      toast({ title: "Project renamed" });
      return true;
    } catch (cause) {
      toast({
        title: "Could not rename project",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
      return false;
    } finally {
      setProjectBusy(false);
    }
  }, [currentProjectDoc, projectLibrary.activeProjectId, saveProject, toast]);

  const handleOpenProject = useCallback(async (projectId: string): Promise<boolean> => {
    setProjectBusy(true);
    try {
      await saveBeforeReplacingProject();
      const opened = await openProjectFromLibrary(projectId);
      setDraftName(opened.project.name);
      setKeepBinSize(opened.doc.keepBinSize ?? false);
      setMaterials(opened.doc.materials ?? DEFAULT_BIN_MATERIALS);
      library.replaceShapes(opened.doc.shapes);
      dispatch({
        type: "HYDRATE",
        spec: opened.doc.spec,
        cutouts: opened.doc.cutouts,
        fingerHoles: opened.doc.fingerHoles,
        history: opened.doc.history,
        transformOrigins: opened.doc.transformOrigins,
      });
      setSection(null);
      setProjectLibrary(opened.library);
      setProjectRestoreFailed(false);
      toast({
        title: "Project opened",
        description: `“${opened.project.name}” will resume here automatically.`,
      });
      return true;
    } catch (cause) {
      toast({
        title: "Could not open project",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
      return false;
    } finally {
      setProjectBusy(false);
    }
  }, [library, dispatch, saveBeforeReplacingProject, toast]);

  const handleDeleteProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      if (projectId === projectLibrary.activeProjectId) return false;
      setProjectBusy(true);
      try {
        const saved = await deleteProjectFromLibrary(projectId);
        setProjectLibrary(saved);
        toast({
          title: "Removed from library",
          description: "The named library copy was removed.",
        });
        return true;
      } catch (cause) {
        toast({
          title: "Could not remove project",
          description: cause instanceof Error ? cause.message : String(cause),
          variant: "destructive",
        });
        return false;
      } finally {
        setProjectBusy(false);
      }
    },
    [projectLibrary.activeProjectId, toast],
  );

  const handleRefreshProjects = useCallback(() => {
    void loadProjectLibrary().then(saved => {
      // Listing saved entries must not switch this tab's open document.
      setProjectLibrary(current => ({ ...saved, activeProjectId: current.activeProjectId }));
      setProjectLibraryError(null);
    }).catch(cause => setProjectLibraryError(cause instanceof Error ? cause.message : "The browser library could not be read. Try again."));
  }, []);

  // Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes — guarded against
  // text inputs so the shortcuts don't eat form editing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (viewMode === "3d" && canHandleCanvasShortcut(event)
        && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
        if (experimentalEnabled && bin.selectedSurfaceTextId) {
          event.preventDefault();
          dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: spec.surfaceTexts.filter(label => label.id !== bin.selectedSurfaceTextId) }, historyLabel: "Remove surface text" });
          return;
        }
        if (bin.selection.length) {
          event.preventDefault(); dispatch({ type: "REMOVE_SELECTION" }); return;
        }
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!canHandleCanvasShortcut(event) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "d" && bin.editorMode === "placement" && bin.selection.length) {
        dispatch({ type: "DUPLICATE_SELECTION", ids: bin.selection.map(source => ({ source, id: crypto.randomUUID() })) });
        event.preventDefault(); return;
      }
      if (key === "z") {
        dispatch({ type: event.shiftKey ? "REDO" : "UNDO" });
        event.preventDefault();
      } else if (key === "y") {
        dispatch({ type: "REDO" });
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, experimentalEnabled, inspectorPrototype, viewMode, bin.selection, bin.selectedSurfaceTextId, bin.editorMode, spec.surfaceTexts]);

  const handleExport = useCallback(
    async (format: "3mf" | "3mf-multicolor" | "stl", includeProject: boolean) => {
      setExporting(true);
      try {
        const label = binSizeLabel(exportProjectDoc.spec);
        const multicolor = format === "3mf-multicolor";
        const project = prepareProjectExport(
          exportProjectDoc,
          currentProjectName,
          multicolor ? "multicolor" : "",
        );
        const includePocketFloors =
          multicolor &&
          colorPocketFloors &&
          (exportProjectDoc.spec.fill === "none" ||
            exportProjectDoc.cutouts.some((cutout) => pocketDepths(cutout).some(depth => depth.mode !== "through")));
        const includeStackingRim =
          multicolor && colorStackingRim;
        const result = await buildOnce(EXPORT_QUALITY, {
          pocketFloorMaterialThicknessMm: includePocketFloors
            ? pocketFloorThicknessMm
            : undefined,
          stackingRimMaterialThicknessMm: includeStackingRim
            ? stackingRimThicknessMm
            : undefined,
          borderWidthMm: includeStackingRim && exportProjectDoc.spec.lip === "none"
            ? borderWidthMm : undefined,
        });
        const textObjects: ThreeMfObject[] = (result.textMeshes ?? []).map(part => ({
          name: part.label.name ?? `Text: ${part.label.text}`,
          mesh: part.mesh,
          material: { name: "Text", displayColor: (multicolor ? exportProjectDoc.spec.textColor ?? edgeBandColor : binColor) as `#${string}` },
        }));
        if (multicolor) {
          if (!result.materialMeshes && (includePocketFloors || includeStackingRim)) {
            throw new Error(
              "This bin has no printable floor, rim, or border color volume.",
            );
          }
          const objects: ThreeMfObject[] = [
            {
              name: `Gridfinity bin ${label} body`,
              mesh: result.materialMeshes?.body ?? result.bodyMesh ?? result.mesh,
              material: {
                name: "Bin body",
                displayColor: binColor as `#${string}`,
              },
            },
          ];
          if (includePocketFloors && result.materialMeshes?.pocketFloors) {
            const floorName = exportProjectDoc.spec.fill === "none" ? "Bin floor" : "Pocket floors";
            objects.push({
              name: `Gridfinity bin ${label} ${floorName.toLowerCase()}`,
              mesh: result.materialMeshes.pocketFloors,
              material: {
                name: floorName,
                displayColor: pocketFloorColor as `#${string}`,
              },
            });
          }
          if (includeStackingRim && result.materialMeshes?.stackingRim) {
            const rimName = exportProjectDoc.spec.lip === "standard" ? "Stacking rim top" : "Top border";
            objects.push({
              name: `Gridfinity bin ${label} ${rimName.toLowerCase()}`,
              mesh: result.materialMeshes.stackingRim,
              material: {
                name: rimName,
                displayColor: stackingRimColor as `#${string}`,
              },
            });
          }
          // A wide, deep border can color all of a small bin. Keep its chosen
          // color and omit the now-empty body rather than exporting an empty mesh.
          const printableObjects = objects.concat(textObjects).filter(object => object.mesh.indices.length > 0);
          if (printableObjects.length === 0 || (printableObjects.length === 1 && printableObjects[0] === objects[0])) {
            throw new Error(
              "The selected color regions did not produce printable material volumes.",
            );
          }
          const bytes = writeThreeMf(
            printableObjects,
            {
              title: `Pocketry multi-color Gridfinity bin ${label}`,
              assemble: true,
            },
          );
          downloadModelWithProject(
            new Blob([bytes], { type: "model/3mf" }),
            "3mf",
            project,
            includeProject,
          );
        } else if (format === "3mf") {
          const bytes = writeThreeMf(
            [
              {
                name: `Gridfinity bin ${label}`,
                mesh: result.bodyMesh ?? result.mesh,
                material: {
                  name: "Bin body",
                  displayColor: binColor as `#${string}`,
                },
              },
              ...textObjects,
            ],
            { title: `Pocketry Gridfinity bin ${label}`, assemble: textObjects.length > 0 },
          );
          downloadModelWithProject(new Blob([bytes], { type: "model/3mf" }), "3mf", project, includeProject);
        } else {
          const stl = writeBinarySTL(
            { positions: result.mesh.positions, indices: result.mesh.indices },
            `Pocketry Gridfinity bin ${label}`,
          );
          downloadModelWithProject(
            new Blob([stl], { type: "application/octet-stream" }),
            "stl",
            project,
            includeProject,
          );
        }
        toast({
          title: "Saved",
          description: `Exported bin ${label} as ${multicolor ? "a multi-color 3MF" : format.toUpperCase()}${includeProject ? " with an editable project JSON" : ""}.`,
        });
      } catch (cause) {
        if (!(cause instanceof WorkerCancelledError)) {
          toast({
            title: "Export failed",
            description: cause instanceof Error ? cause.message : String(cause),
            variant: "destructive",
          });
        }
      } finally {
        setExporting(false);
      }
    },
    [
      exportProjectDoc,
      currentProjectName,
      buildOnce,
      colorPocketFloors,
      colorStackingRim,
      binColor,
      pocketFloorColor,
      pocketFloorThicknessMm,
      stackingRimColor,
      edgeBandColor,
      stackingRimThicknessMm,
      borderWidthMm,
      toast,
    ],
  );

  const handleExportFitCheck = useCallback(
    async (cutoutId: string, depthMm: number, includeProject: boolean) => {
      const cutout = exportProjectDoc.cutouts.find((candidate) => candidate.id === cutoutId);
      const shape = cutout
        ? library.shapes.find((candidate) => candidate.id === cutout.shapeId)
        : null;
      if (!cutout || !shape) {
        toast({
          title: "Fit template unavailable",
          description: "Select a tool pocket before exporting its fit template.",
          variant: "destructive",
        });
        return;
      }

      setExporting(true);
      try {
        const depthLabel = String(depthMm);
        const project = prepareProjectExport(
          exportProjectDoc,
          currentProjectName,
          `${exportFilePart(pocketName(cutout, shape)) || "tool"}-fit-template-${depthLabel}mm`,
        );
        const result = await buildFitCheck(shape, cutout, depthMm, EXPORT_QUALITY);
        const stl = writeBinarySTL(
          { positions: result.mesh.positions, indices: result.mesh.indices },
          `Pocketry ${pocketName(cutout, shape)} fit template ${depthLabel} mm`,
        );
        downloadModelWithProject(
          new Blob([stl], { type: "application/octet-stream" }),
          "stl",
          project,
          includeProject,
        );
        toast({
          title: "Fit template saved",
          description: `Exported “${pocketName(cutout, shape)}” as a ${depthLabel} mm filled outline${includeProject ? " with an editable project JSON" : ""}.`,
        });
      } catch (cause) {
        if (!(cause instanceof WorkerCancelledError)) {
          toast({
            title: "Fit template export failed",
            description: cause instanceof Error ? cause.message : String(cause),
            variant: "destructive",
          });
        }
      } finally {
        setExporting(false);
      }
    },
    [buildFitCheck, exportProjectDoc, currentProjectName, library.shapes, toast],
  );

  const handleExportSurfaceFitCheck = useCallback(
    async (thicknessMm: number, includeProject: boolean, style: SurfaceFitCheckStyle) => {
      setExporting(true);
      try {
        const label = binSizeLabel(exportProjectDoc.spec);
        const thicknessLabel = String(thicknessMm);
        const project = prepareProjectExport(
          exportProjectDoc,
          currentProjectName,
          style === "outline" ? `tool-outlines-${SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM}mm-wide-${thicknessLabel}mm-thick`
            : `surface-fit-test-${thicknessLabel}mm`,
        );
        const result = await buildSurfaceFitCheck(thicknessMm, EXPORT_QUALITY, style);
        const stl = writeBinarySTL(
          { positions: result.mesh.positions, indices: result.mesh.indices },
          `Pocketry ${label} ${style === "outline" ? "tool outlines" : "surface fit test"} ${thicknessLabel} mm`,
        );
        downloadModelWithProject(
          new Blob([stl], { type: "application/octet-stream" }),
          "stl",
          project,
          includeProject,
        );
        toast({
          title: "Surface fit test saved",
          description: `Exported ${style === "outline" ? `${SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM} mm wide tool outlines` : "the complete pocket-layout surface"} at ${thicknessLabel} mm thick${includeProject ? " with an editable project JSON" : ""}.`,
        });
      } catch (cause) {
        if (!(cause instanceof WorkerCancelledError)) {
          toast({
            title: "Surface fit test export failed",
            description: cause instanceof Error ? cause.message : String(cause),
            variant: "destructive",
          });
        }
      } finally {
        setExporting(false);
      }
    },
    [buildSurfaceFitCheck, exportProjectDoc, currentProjectName, toast],
  );

  return (
    <BinEditingWorkspace
      enabled={inspectorPrototype}
      inspectorRequest={pocketEditorRequest}
      controlsRequest={settingsSectionRequest}
      autoSaveId="tooltrace:bin"
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      panelTitle={isMobile && settingsSectionRequest?.id === "bin-settings-export" ? "Export bin" : "Bin designer"}
      mobileActionsLayout="landscape-side"
      mobileActions={<MobileBinActions open={quickAdjustOpen} onOpenChange={setQuickAdjustOpen}
        onWorkflow={() => { setSettingsSectionRequest(undefined); setPanelOpen(!panelOpen); }}
        onMore={id => { setSettingsSectionRequest({ id }); setPanelOpen(true); }}
        onExport={() => { setSettingsSectionRequest({ id: "bin-settings-export" }); setPanelOpen(true); }} />}
      panel={
        <BinControlsPanel
          exportOnly={isMobile && settingsSectionRequest?.id === "bin-settings-export"}
          issues={issues}
          settingsSectionRequest={settingsSectionRequest}
          onRevealIssue={revealIssue}
          pocketEditorRequest={pocketEditorRequest}
          saveStatus={saveStatus}
          projectLibraryError={projectLibraryError}
          keepBinSize={keepBinSize}
          onKeepBinSizeChange={setKeepBinSize}
          stats={stats}
          geometryError={error}
          onPositionText={positionText}
          statsAreStale={statsAreStale}
          building={building}
          previewIsDraft={previewIsDraft}
          exporting={exporting}
          onExport={(format, includeProject) => void handleExport(format, includeProject)}
          onExportFitCheck={(cutoutId, depthMm, includeProject) =>
            void handleExportFitCheck(cutoutId, depthMm, includeProject)
          }
          onExportSurfaceFitCheck={(thicknessMm, includeProject, style) =>
            void handleExportSurfaceFitCheck(thicknessMm, includeProject, style)
          }
          onExportLayout={handleExportLayout}
          onAutoArrange={handleAutoArrange}
          onExportProject={handleExportProject}
          onImportProject={handleImportProject}
          projectLibraryReady={projectLibraryReady}
          projectBusy={projectBusy}
          activeProjectId={projectLibrary.activeProjectId}
          currentProjectName={currentProjectName}
          projects={projectLibrary.projects}
          onSaveProject={handleSaveProject}
          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onOpenProject={handleOpenProject}
          onDeleteProject={handleDeleteProject}
          onRefreshProjects={handleRefreshProjects}
          onExportLibrary={() => void handleExportLibrary()}
          onImportLibrary={handleImportLibrary}
          onNewProject={handleNewProject}
          section={section}
          onSectionChange={setSection}
          colorPocketFloors={colorPocketFloors}
          onColorPocketFloorsChange={colorPocketFloors => patchMaterials({ colorPocketFloors })}
          binColor={binColor}
          onBinColorChange={binColor => patchMaterials({ binColor })}
          pocketFloorColor={pocketFloorColor}
          onPocketFloorColorChange={pocketFloorColor => patchMaterials({ pocketFloorColor })}
          pocketFloorThicknessMm={pocketFloorThicknessMm}
          onPocketFloorThicknessChange={pocketFloorThicknessMm => patchMaterials({ pocketFloorThicknessMm })}
          colorStackingRim={colorStackingRim}
          onColorStackingRimChange={colorStackingRim => patchMaterials({ colorStackingRim })}
          stackingRimColor={stackingRimColor}
          onStackingRimColorChange={stackingRimColor => patchMaterials({ stackingRimColor })}
          stackingRimThicknessMm={stackingRimThicknessMm}
          onStackingRimThicknessChange={stackingRimThicknessMm => patchMaterials({ stackingRimThicknessMm })}
          borderWidthMm={borderWidthMm}
          onBorderWidthChange={borderWidthMm => patchMaterials({ borderWidthMm })}
        />
      }
      canvas={
        <div className="absolute inset-0 flex flex-col" data-testid="bin-canvas">
          {saveError && <div role="alert" data-testid="bin-save-error" className="z-40 flex shrink-0 flex-wrap items-center gap-2 border-b border-destructive/40 bg-background px-3 py-2 text-sm text-destructive">
            <p className="min-w-0 flex-1">{saveError}</p>
            {bin.hydrated && <Button variant="outline" className="min-h-11 shrink-0" onClick={handleExportProject}>Download backup</Button>}
          </div>}
          <div className="relative min-h-0 flex-1">
          <CanvasWarnings
            issues={issues}
            selectedCutoutId={bin.selectedCutoutId}
            selectedFingerHoleId={bin.selectedFingerHoleId}
            onRevealIssue={revealIssue}
          />
          {viewMode === "3d" ? (
            <BinViewport
              geometry={geometry}
              showPocketOutlines={!section || !hideInspectionPocketOutline}
              pocketEditor={{ spec, transformOrigins: bin.transformOrigins, originShapes: library.shapes, linkControls: <SelectionLinkControls />, pockets: editablePockets, pocketGeometry: profileOutlines, selectedId: bin.selectedCutoutId, fingerHoles, selection: bin.selection,
                onSelectionChange: selection => dispatch({ type: "SET_SELECTION", selection }),
                onCommitObjects: (edits, historyLabel) => dispatch({ type: "UPDATE_OBJECTS", edits, historyLabel }),
                onPreviewObjects: (edits, historyLabel) => dispatch({ type: "UPDATE_OBJECTS", edits, historyLabel, transient: true }),
                onSelect: id => dispatch({ type: "SELECT_CUTOUT", id }),
                onCommit: (id, patch, mode) => dispatch({ type: "UPDATE_CUTOUT", id, patch, historyLabel: mode === "translate" ? "Move pocket in 3D" : "Rotate pocket in 3D" }),
              }}
              pocketFloorGeometry={pocketFloorGeometry}
              stackingRimGeometry={stackingRimGeometry}
              textGeometries={textGeometries}
              selectedSurfaceTextId={experimentalEnabled ? bin.selectedSurfaceTextId : null}
              onSelectSurfaceText={experimentalEnabled ? editSurfaceText : undefined}
              surfaceTextEditor={experimentalEnabled && bin.selectedSurfaceTextId && spec.surfaceTexts.some(label => label.id === bin.selectedSurfaceTextId) ? {
                tool: bin.textTool, snap: bin.textSnap,
                onToolChange: tool => dispatch({ type: "SET_TEXT_TOOL", tool }),
                onSnapChange: snap => dispatch({ type: "SET_TEXT_SNAP", snap }),
                label: spec.surfaceTexts.find(label => label.id === bin.selectedSurfaceTextId)!, z: surfaceTextZ(spec),
                onCommit: (label, mode) => dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: spec.surfaceTexts.map(item => item.id === label.id ? label : item) }, historyLabel: `${mode === "translate" ? "Move" : "Rotate"} surface text in 3D` }),
              } : undefined}
              textColor={spec.textColor ?? edgeBandColor}
              hasPocketFloor={hasPocketFloor}
              hasStackingRim={hasStackingRim}
              binColor={binColor}
              pocketFloorColor={pocketFloorColor}
              floorColorLabel={(builtSpec ?? committedSpec).fill === "none" ? "Bin floor" : "Pocket floor"}
              stackingRimColor={stackingRimColor}
              showPocketFloorColor={colorPocketFloors}
              showStackingRimColor={colorStackingRim}
              onEditColor={editMaterialColor}
              building={building}
              previewIsDraft={previewIsDraft}
              progress={progress}
              error={error}
              onRetryPreview={retryPreview}
              onPositionText={experimentalEnabled && spec.surfaceTexts.length > 0 ? positionText : undefined}
              fitSize={fitSize}
              measurementOutlines={measurementOutlines}
              measurementSplitBoundaries={measurementSplitBoundaries}
              measurementPlaneZMm={builtDimensions.heightToRimMm}
            />
          ) : (
            <LayoutCanvas onEditPocket={editSelectedPocket} onSelectSurfaceText={editSurfaceText} edgeBandColor={edgeBandColor} textPositionRequest={textPositionRequest} />
          )}
          <ViewToggle
            viewMode={viewMode}
            onChange={(mode) => dispatch({ type: "SET_VIEW_MODE", viewMode: mode })}
          />
          {viewMode === "3d" && section && (
            <div className="absolute left-3 top-16 md:top-12 [@media(pointer:coarse)]:top-16 z-30 flex max-w-[calc(100%_-_4.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/95 p-2 shadow-sm backdrop-blur">
              <span className="text-xs text-muted-foreground">Section view</span>
              <div className="flex items-center gap-2">
                <Checkbox id="hide-inspection-pocket-outline" checked={hideInspectionPocketOutline}
                  onCheckedChange={checked => setHideInspectionPocketOutline(checked === true)} />
                <Label htmlFor="hide-inspection-pocket-outline" className="cursor-pointer text-xs">Hide pocket outline</Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSection(null)}
                data-testid="button-show-full-bin"
              >
                <Box className="h-3.5 w-3.5" />
                Show full bin
              </Button>
            </div>
          )}
          <div data-testid="bin-history-toolbar" className="absolute right-3 top-3 z-30 flex overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur">
            <Button
              variant="ghost"
              size="sm"
              className="h-11 min-w-11 rounded-none px-2 md:h-7 md:min-w-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              disabled={!bin.canUndo}
              onClick={() => dispatch({ type: "UNDO" })}
              aria-label={
                bin.canUndo
                  ? `Undo ${historyEntries[bin.history.index].label}`
                  : "Undo"
              }
              data-testid="button-bin-undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <EditHistoryMenu
              entries={historyEntries}
              index={bin.history.index}
              onJump={(index) => dispatch({ type: "JUMP_TO_HISTORY", index })}
              testId="button-bin-history"
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 min-w-11 rounded-none px-2 md:h-7 md:min-w-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                  aria-label="Show edit history"
                  title="Show edit history"
                  data-testid="button-bin-history"
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-11 min-w-11 rounded-none px-2 md:h-7 md:min-w-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              disabled={!bin.canRedo}
              onClick={() => dispatch({ type: "REDO" })}
              aria-label={
                bin.canRedo
                  ? `Redo ${historyEntries[bin.history.index + 1].label}`
                  : "Redo"
              }
              data-testid="button-bin-redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          </div>
        </div>
      }
    />
  );
}

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: BinViewMode;
  onChange: (mode: BinViewMode) => void;
}): JSX.Element {
  return (
    <div className="absolute left-3 top-3 z-30 flex md:left-1/2 md:-translate-x-1/2 overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur">
      {(
        [
          { mode: "3d", label: "3D" },
          { mode: "2d", label: "Layout" },
        ] as const
      ).map(({ mode, label }) => (
        <Button
          key={mode}
          variant="ghost"
          size="sm"
          className={cn(
            "h-11 rounded-none px-3 text-xs md:h-7 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
            viewMode === mode && "bg-accent text-accent-foreground",
          )}
          onClick={() => onChange(mode)}
          data-testid={`view-toggle-${mode}`}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
