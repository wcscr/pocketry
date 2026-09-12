import { Box, History, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CanvasWarnings } from "@/components/gridfinity/canvas-warnings";
import { validateBinSpec, validateLayout, validatePocketFloorMaterials, type ValidationIssue } from "@shared/gridfinity/validate";
import { BinControlsPanel } from "@/components/gridfinity/bin-controls-panel";
import { BinViewport } from "@/components/gridfinity/bin-viewport";
import { LayoutCanvas } from "@/components/gridfinity/layout-canvas";
import { EditHistoryMenu } from "@/components/history/edit-history-menu";
import { usePanelState } from "@/components/layout/panel-context";
import { WorkspaceLayout } from "@/components/layout/workspace-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  parseProjectDoc,
  PROJECT_SCHEMA_VERSION,
  type ProjectDoc,
} from "@shared/gridfinity/project";
import { placementFootprint } from "@shared/gridfinity/cutout";

import {
  autoArrangeLayout,
  autoPlaceFresh,
  autoPlaceIncremental,
} from "@/lib/gridfinity/autoplace";
import {
  binDimensionsMm,
  EXPORT_QUALITY,
  MULTICOLOR_FLOOR_THICKNESS_MM,
  MULTICOLOR_RIM_THICKNESS_MM,
  PREVIEW_QUALITY,
} from "@/lib/gridfinity/bin";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
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
  BIN_BODY_COLOR,
  POCKET_FLOOR_COLOR,
  STACKING_RIM_COLOR,
} from "@/lib/gridfinity/pocket-floor-mesh";
import {
  createDebouncedProjectSaver,
  deleteProjectFromLibrary,
  duplicateProjectInLibrary,
  exportProjectLibrary,
  importProjectLibrary,
  loadProjectDoc,
  loadProjectLibrary,
  openProjectFromLibrary,
  renameProjectInLibrary,
  saveProjectToLibrary,
  startNewProject,
  type ProjectLibrarySnapshot,
} from "@/lib/project/persist";
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
  const { panelOpen, setPanelOpen } = usePanelState();
  const [pocketEditorRequest, setPocketEditorRequest] = useState(0);
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<{ id: string }>();
  const editSelectedPocket = () => {
    setSettingsSectionRequest(undefined);
    setPanelOpen(true);
    setPocketEditorRequest((request) => request + 1);
  };
  const { toast } = useToast();
  const bin = useBin();
  const { spec, cutouts, fingerHoles, viewMode, dispatch } = bin;
  const library = useShapeLibrary();
  // Sliders and canvas drags update the visible controls transiently, but the
  // history entry remains the last committed design until pointer-up. Feeding
  // that committed document to the worker prevents an expensive, obsolete
  // CSG build for every intermediate mouse position.
  const committedDoc = getCommittedBinDoc(bin);
  const committedSpec = committedDoc.spec;
  const committedCutouts = committedDoc.cutouts;
  const committedFingerHoles = committedDoc.fingerHoles;

  const [exporting, setExporting] = useState(false);
  const [section, setSection] = useState<BuildBinSection | null>(null);
  const [colorPocketFloors, setColorPocketFloors] = useState(true);
  const [binColor, setBinColor] = useState<string>(BIN_BODY_COLOR);
  const [pocketFloorColor, setPocketFloorColor] =
    useState<string>(POCKET_FLOOR_COLOR);
  const [pocketFloorThicknessMm, setPocketFloorThicknessMm] = useState(
    MULTICOLOR_FLOOR_THICKNESS_MM,
  );
  const [colorStackingRim, setColorStackingRim] = useState(true);
  const [stackingRimColor, setStackingRimColor] =
    useState<string>(STACKING_RIM_COLOR);
  const [stackingRimThicknessMm, setStackingRimThicknessMm] = useState(
    MULTICOLOR_RIM_THICKNESS_MM,
  );
  const [projectLibrary, setProjectLibrary] = useState(EMPTY_PROJECT_LIBRARY);
  const [projectLibraryReady, setProjectLibraryReady] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [draftName, setDraftName] = useState<string | null>(null);
  const [keepBinSize, setKeepBinSize] = useState(false);

  // One validation result drives both the canvas feedback and export gates,
  // including when the controls are collapsed or the mobile drawer is closed.
  const issues = useMemo(() => {
    const shapesById = new Map(library.shapes.map((shape) => [shape.id, shape]));
    return [
      ...validateBinSpec(spec).issues,
      ...validateLayout(spec, cutouts, shapesById, fingerHoles),
      ...validatePocketFloorMaterials(spec, cutouts, shapesById, colorPocketFloors ? pocketFloorThicknessMm : 0),
    ];
  }, [spec, cutouts, fingerHoles, library.shapes, colorPocketFloors, pocketFloorThicknessMm]);
  const revealIssue = (issue: ValidationIssue) => {
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
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
    void Promise.all([loadProjectDoc(), loadProjectLibrary()]).then(([doc, saved]) => {
      if (cancelled) return;
      setProjectLibrary(saved);
      setProjectLibraryReady(true);
      if (doc) {
        setDraftName(doc.name ?? null);
        setKeepBinSize(doc.keepBinSize ?? false);
        library.mergeShapes(doc.shapes);
        dispatch({
          type: "HYDRATE",
          spec: doc.spec,
          cutouts: doc.cutouts,
          fingerHoles: doc.fingerHoles,
        });
      } else {
        dispatch({ type: "MARK_HYDRATED" });
      }
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
  const saveProject = useMemo(() => createDebouncedProjectSaver(500, (success) => setSaveStatus(success ? "saved" : "error")), []);
  const currentProjectDoc = useMemo<ProjectDoc>(
    () => ({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      ...(currentProjectName ? { name: currentProjectName } : {}),
      keepBinSize,
      shapes: library.shapes,
      spec,
      cutouts,
      fingerHoles,
    }),
    [library.shapes, spec, cutouts, fingerHoles, currentProjectName, keepBinSize],
  );
  useEffect(() => {
    if (!bin.hydrated) return;
    setSaveStatus("saving");
    saveProject(currentProjectDoc);
  }, [bin.hydrated, currentProjectDoc, saveProject]);


  const exportProjectDoc = useMemo<ProjectDoc>(
    () => ({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      ...(currentProjectName ? { name: currentProjectName } : {}),
      keepBinSize,
      shapes: library.shapes,
      spec: committedSpec,
      cutouts: committedCutouts,
      fingerHoles: committedFingerHoles,
    }),
    [library.shapes, committedSpec, committedCutouts, committedFingerHoles, currentProjectName, keepBinSize],
  );

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
      cutouts: result.cutouts,
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

  const previewLayout = useMemo(() => {
    const referenced = new Set(
      committedCutouts.map((cutout) => cutout.shapeId),
    );
    return {
      shapes: library.shapes.filter((shape) => referenced.has(shape.id)),
      cutouts: committedCutouts,
      fingerHoles: committedFingerHoles,
    };
  }, [library.shapes, committedCutouts, committedFingerHoles]);

  const measurementOutlines = useMemo(() => {
    const shapesById = new Map(
      previewLayout.shapes.map((shape) => [shape.id, shape]),
    );
    return previewLayout.cutouts.flatMap((cutout) => {
      const shape = shapesById.get(cutout.shapeId);
      return shape ? [placementFootprint(shape, cutout).outline] : [];
    });
  }, [previewLayout]);

  const {
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
  } = useBinGeometry(
    committedSpec,
    PREVIEW_QUALITY,
    previewLayout,
    section,
    { pocketFloorThicknessMm, stackingRimThicknessMm },
  );

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
        const shape = layout.shapes.find(
          (s) => s.id === cutouts.find((c) => c.id === report.id)?.shapeId,
        );
        toast({
          title: "Pocket vanished",
          description: `“${shape?.name ?? "A pocket"}” collapsed under its clearance/corner settings — increase clearance toward zero or reduce outline corner rounding.`,
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
    (format: "dxf" | "svg", includeProject: boolean) => {
      const { spec, cutouts, fingerHoles, shapes } = exportProjectDoc;
      const shapesById = new Map(shapes.map((shape) => [shape.id, shape]));
      const project = prepareProjectExport(exportProjectDoc, currentProjectName, "layout");
      const model = format === "dxf"
        ? new Blob([generateLayoutDXF(spec, cutouts, shapesById, fingerHoles)], { type: "application/dxf" })
        : new Blob([generateLayoutSVG(spec, cutouts, shapesById, fingerHoles)], { type: "image/svg+xml" });
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
      const backup = await exportProjectLibrary(currentProjectDoc);
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
  }, [currentProjectDoc, toast]);

  const handleImportLibrary = useCallback(async (file: File) => {
    setProjectBusy(true);
    try {
      let input: unknown;
      try {
        input = JSON.parse(await file.text());
      } catch {
        throw new Error("The file could not be read as JSON. No designs were imported.");
      }
      const result = await importProjectLibrary(input);
      setProjectLibrary(result.library);
      toast({
        title: "Library imported",
        description: `${result.imported} designs added, ${result.upgraded} upgraded, ${result.renamed} renamed.`,
      });
    } catch (cause) {
      toast({ title: "Could not import library", description: cause instanceof Error ? cause.message : "No designs were imported.", variant: "destructive" });
    } finally {
      setProjectBusy(false);
    }
  }, [toast]);

  const handleImportProject = useCallback(
    async (file: File) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        parsed = null;
      }
      const doc = parseProjectDoc(parsed);
      if (!doc) {
        toast({
          title: "Not a Pocketry project",
          description: `${file.name} is not a readable .pocketry.json or legacy .tooltrace.json file.`,
          variant: "destructive",
        });
        return;
      }
      doc.name ??= file.name.replace(/\.(?:pocketry|tooltrace)\.json$/i, "").replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 80) || "Imported project";
      setProjectBusy(true);
      saveProject.cancel();
      try {
        const saved = await startNewProject(doc);
        setDraftName(doc.name ?? null);
        setKeepBinSize(doc.keepBinSize ?? false);
        library.replaceShapes(doc.shapes);
        dispatch({
          type: "HYDRATE",
          spec: doc.spec,
          cutouts: doc.cutouts,
          fingerHoles: doc.fingerHoles,
        });
        setSection(null);
        setProjectLibrary(saved);
        toast({
          title: "Backup imported",
          description: `${doc.shapes.length} shape${doc.shapes.length === 1 ? "" : "s"}, ${doc.cutouts.length} pocket${doc.cutouts.length === 1 ? "" : "s"}. Opened as “${doc.name}”.`,
        });
      } catch (cause) {
        toast({
          title: "Could not import backup",
          description: cause instanceof Error ? cause.message : String(cause),
          variant: "destructive",
        });
      } finally {
        setProjectBusy(false);
      }
    },
    [library, dispatch, saveProject, toast],
  );

  const handleNewProject = useCallback(async () => {
    const doc: ProjectDoc = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shapes: [],
      spec: INITIAL_BIN_SPEC,
      cutouts: [],
      fingerHoles: [],
    };
    setProjectBusy(true);
    saveProject.cancel();
    try {
      const saved = await startNewProject(doc);
      setDraftName(null);
      setKeepBinSize(false);
      library.replaceShapes([]);
      dispatch({
        type: "HYDRATE",
        spec: doc.spec,
        cutouts: doc.cutouts,
        fingerHoles: doc.fingerHoles,
      });
      setSection(null);
      setProjectLibrary(saved);
      toast({
        title: "New project ready",
        description: "Saved library projects are unchanged.",
      });
    } catch (cause) {
      toast({
        title: "Could not start project",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
    } finally {
      setProjectBusy(false);
    }
  }, [library, dispatch, saveProject, toast]);

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
    saveProject.cancel();
    try {
      const opened = await openProjectFromLibrary(projectId);
      setDraftName(opened.project.name);
      setKeepBinSize(opened.doc.keepBinSize ?? false);
      library.replaceShapes(opened.doc.shapes);
      dispatch({
        type: "HYDRATE",
        spec: opened.doc.spec,
        cutouts: opened.doc.cutouts,
        fingerHoles: opened.doc.fingerHoles,
      });
      setSection(null);
      setProjectLibrary(opened.library);
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
  }, [library, dispatch, saveProject, toast]);

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
    void loadProjectLibrary().then(setProjectLibrary);
  }, []);

  // Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes — guarded against
  // text inputs so the shortcuts don't eat form editing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
        return;
      }
      const key = event.key.toLowerCase();
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
  }, [dispatch]);

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
          exportProjectDoc.cutouts.some((cutout) => cutout.depth.mode !== "through");
        const includeStackingRim =
          multicolor && colorStackingRim && exportProjectDoc.spec.lip === "standard";
        const result = await buildOnce(EXPORT_QUALITY, {
          pocketFloorMaterialThicknessMm: includePocketFloors
            ? pocketFloorThicknessMm
            : undefined,
          stackingRimMaterialThicknessMm: includeStackingRim
            ? stackingRimThicknessMm
            : undefined,
        });
        if (multicolor) {
          if (!result.materialMeshes) {
            throw new Error(
              "This bin has no printable floor or stacking-rim color volume.",
            );
          }
          const objects: ThreeMfObject[] = [
            {
              name: `Gridfinity bin ${label} body`,
              mesh: result.materialMeshes.body,
              material: {
                name: "Bin body",
                displayColor: binColor as `#${string}`,
              },
            },
          ];
          if (includePocketFloors && result.materialMeshes.pocketFloors) {
            objects.push({
              name: `Gridfinity bin ${label} pocket floors`,
              mesh: result.materialMeshes.pocketFloors,
              material: {
                name: "Pocket floors",
                displayColor: pocketFloorColor as `#${string}`,
              },
            });
          }
          if (includeStackingRim && result.materialMeshes.stackingRim) {
            objects.push({
              name: `Gridfinity bin ${label} stacking rim top`,
              mesh: result.materialMeshes.stackingRim,
              material: {
                name: "Stacking rim top",
                displayColor: stackingRimColor as `#${string}`,
              },
            });
          }
          if (objects.length < 2) {
            throw new Error(
              "The selected color regions did not produce printable material volumes.",
            );
          }
          const bytes = writeThreeMf(
            objects,
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
                mesh: result.mesh,
                material: {
                  name: "Bin body",
                  displayColor: binColor as `#${string}`,
                },
              },
            ],
            { title: `Pocketry Gridfinity bin ${label}` },
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
      stackingRimThicknessMm,
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
          `${exportFilePart(shape.name) || "tool"}-fit-template-${depthLabel}mm`,
        );
        const result = await buildFitCheck(shape, cutout, depthMm, EXPORT_QUALITY);
        const stl = writeBinarySTL(
          { positions: result.mesh.positions, indices: result.mesh.indices },
          `Pocketry ${shape.name} fit template ${depthLabel} mm`,
        );
        downloadModelWithProject(
          new Blob([stl], { type: "application/octet-stream" }),
          "stl",
          project,
          includeProject,
        );
        toast({
          title: "Fit template saved",
          description: `Exported “${shape.name}” as a ${depthLabel} mm filled outline${includeProject ? " with an editable project JSON" : ""}.`,
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
    async (thicknessMm: number, includeProject: boolean) => {
      setExporting(true);
      try {
        const label = binSizeLabel(exportProjectDoc.spec);
        const thicknessLabel = String(thicknessMm);
        const project = prepareProjectExport(
          exportProjectDoc,
          currentProjectName,
          `surface-fit-test-${thicknessLabel}mm`,
        );
        const result = await buildSurfaceFitCheck(thicknessMm, EXPORT_QUALITY);
        const stl = writeBinarySTL(
          { positions: result.mesh.positions, indices: result.mesh.indices },
          `Pocketry ${label} surface fit test ${thicknessLabel} mm`,
        );
        downloadModelWithProject(
          new Blob([stl], { type: "application/octet-stream" }),
          "stl",
          project,
          includeProject,
        );
        toast({
          title: "Surface fit test saved",
          description: `Exported the complete pocket-layout surface at ${thicknessLabel} mm thick${includeProject ? " with an editable project JSON" : ""}.`,
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
    <WorkspaceLayout
      autoSaveId="tooltrace:bin"
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      panelTitle="Bin designer"
      panel={
        <BinControlsPanel
          issues={issues}
          settingsSectionRequest={settingsSectionRequest}
          pocketEditorRequest={pocketEditorRequest}
          saveStatus={saveStatus}
          keepBinSize={keepBinSize}
          onKeepBinSizeChange={setKeepBinSize}
          stats={stats}
          building={building}
          exporting={exporting}
          onExport={(format, includeProject) => void handleExport(format, includeProject)}
          onExportFitCheck={(cutoutId, depthMm, includeProject) =>
            void handleExportFitCheck(cutoutId, depthMm, includeProject)
          }
          onExportSurfaceFitCheck={(thicknessMm, includeProject) =>
            void handleExportSurfaceFitCheck(thicknessMm, includeProject)
          }
          onExportLayout={handleExportLayout}
          onAutoArrange={handleAutoArrange}
          onExportProject={handleExportProject}
          onImportProject={(file) => void handleImportProject(file)}
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
          onImportLibrary={(file) => void handleImportLibrary(file)}
          onNewProject={() => void handleNewProject()}
          section={section}
          onSectionChange={setSection}
          colorPocketFloors={colorPocketFloors}
          onColorPocketFloorsChange={setColorPocketFloors}
          binColor={binColor}
          onBinColorChange={setBinColor}
          pocketFloorColor={pocketFloorColor}
          onPocketFloorColorChange={setPocketFloorColor}
          pocketFloorThicknessMm={pocketFloorThicknessMm}
          onPocketFloorThicknessChange={setPocketFloorThicknessMm}
          colorStackingRim={colorStackingRim}
          onColorStackingRimChange={setColorStackingRim}
          stackingRimColor={stackingRimColor}
          onStackingRimColorChange={setStackingRimColor}
          stackingRimThicknessMm={stackingRimThicknessMm}
          onStackingRimThicknessChange={setStackingRimThicknessMm}
        />
      }
      canvas={
        <div className="absolute inset-0" data-testid="bin-canvas">
          <CanvasWarnings
            issues={issues}
            selectedCutoutId={bin.selectedCutoutId}
            selectedFingerHoleId={bin.selectedFingerHoleId}
            onRevealIssue={revealIssue}
          />
          {viewMode === "3d" ? (
            <BinViewport
              geometry={geometry}
              pocketFloorGeometry={pocketFloorGeometry}
              stackingRimGeometry={stackingRimGeometry}
              hasPocketFloor={hasPocketFloor}
              hasStackingRim={hasStackingRim}
              binColor={binColor}
              pocketFloorColor={pocketFloorColor}
              stackingRimColor={stackingRimColor}
              showPocketFloorColor={colorPocketFloors}
              showStackingRimColor={colorStackingRim}
              building={building}
              progress={progress}
              error={error}
              fitSize={fitSize}
              measurementOutlines={measurementOutlines}
              measurementPlaneZMm={builtDimensions.heightToRimMm}
            />
          ) : (
            <LayoutCanvas onEditPocket={editSelectedPocket} />
          )}
          <ViewToggle
            viewMode={viewMode}
            onChange={(mode) => dispatch({ type: "SET_VIEW_MODE", viewMode: mode })}
          />
          {viewMode === "3d" && section && (
            <div className="absolute left-3 top-12 z-30 flex max-w-[calc(100%_-_4.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/95 p-2 shadow-sm backdrop-blur">
              <span className="text-xs text-muted-foreground">Section view</span>
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
          <div className="absolute right-3 top-3 z-30 flex overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-none px-2"
              disabled={!bin.canUndo}
              onClick={() => dispatch({ type: "UNDO" })}
              aria-label={
                bin.canUndo
                  ? `Undo ${bin.history.stack[bin.history.index].label}`
                  : "Undo"
              }
              data-testid="button-bin-undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <EditHistoryMenu
              entries={bin.history.stack}
              index={bin.history.index}
              onJump={(index) => dispatch({ type: "JUMP_TO_HISTORY", index })}
              testId="button-bin-history"
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-none px-2"
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
              className="h-7 rounded-none px-2"
              disabled={!bin.canRedo}
              onClick={() => dispatch({ type: "REDO" })}
              aria-label={
                bin.canRedo
                  ? `Redo ${bin.history.stack[bin.history.index + 1].label}`
                  : "Redo"
              }
              data-testid="button-bin-redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
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
    <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur">
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
            "h-7 rounded-none px-3 text-xs",
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
