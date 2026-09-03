import { History, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  loadProjectDoc,
  loadProjectLibrary,
  openProjectFromLibrary,
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

  // Autosave everything the doc covers, debounced; suppressed until
  // hydration so the empty default never overwrites a real project.
  const saveProject = useMemo(() => createDebouncedProjectSaver(500), []);
  const currentProjectDoc = useMemo<ProjectDoc>(
    () => ({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      shapes: library.shapes,
      spec,
      cutouts,
      fingerHoles,
    }),
    [library.shapes, spec, cutouts, fingerHoles],
  );
  useEffect(() => {
    if (!bin.hydrated) return;
    saveProject(currentProjectDoc);
  }, [bin.hydrated, currentProjectDoc, saveProject]);

  const currentProjectName = useMemo(
    () =>
      projectLibrary.projects.find(
        (project) => project.id === projectLibrary.activeProjectId,
      )?.name ?? null,
    [projectLibrary],
  );

  // Consume shapes freshly arrived from the trace workspace: auto-place them
  // (incrementally when the bin already has arranged pockets) and make sure
  // the bin is solid — pockets need material.
  useEffect(() => {
    if (!bin.hydrated) return;
    const pendingIds = library.consumePending();
    if (pendingIds.length === 0) return;
    const newShapes = library.shapes.filter((shape) => pendingIds.includes(shape.id));
    if (newShapes.length === 0) return;

    const shapesById = new Map(library.shapes.map((shape) => [shape.id, shape]));
    const result =
      cutouts.length === 0
        ? autoPlaceFresh(newShapes, spec.lip, spec.gridPitch)
        : autoPlaceIncremental(newShapes, {
            lip: spec.lip,
            gridPitch: spec.gridPitch,
            gridX: spec.gridX,
            gridY: spec.gridY,
            existing: cutouts,
            shapesById,
          });

    const gridX = Math.max(result.gridX, cutouts.length > 0 ? spec.gridX : 0);
    const gridY = Math.max(result.gridY, cutouts.length > 0 ? spec.gridY : 0);
    dispatch({
      type: "ADD_PLACED",
      cutouts: result.cutouts,
      gridX,
      gridY,
      // Automatic placement chooses the smallest rectangular Gridfinity bin.
      // Irregular footprints require the explicit footprint editor.
      footprint: { kind: "rectangle" },
    });
    if (spec.fill !== "solid") {
      dispatch({ type: "PATCH_SPEC", patch: { fill: "solid" } });
    }
    if (result.overflow) {
      toast({
        title: "Tool does not fit",
        description:
          "Even the largest bin cannot hold this layout — check the trace's scale.",
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
          description: `“${shape?.name ?? "A pocket"}” collapsed under its clearance/corner settings — reduce corner rounding.`,
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
    );
    if (!result) return;
    dispatch({
      type: "REPLACE_LAYOUT",
      cutouts: result.cutouts,
      gridX: result.gridX,
      gridY: result.gridY,
      // Rearranging tools must not silently convert the bin into an irregular
      // footprint. That remains an explicit Layout editing operation.
      footprint: { kind: "rectangle" },
      historyLabel: "Auto-arrange tool pockets",
    });
    if (result.overflow) {
      toast({
        title: "Does not fit",
        description: "Even the largest bin cannot hold this arrangement.",
        variant: "destructive",
      });
    }
  }, [cutouts, fingerHoles, library.shapes, spec.lip, spec.gridPitch, dispatch, toast]);

  const handleExportLayout = useCallback(
    (format: "dxf" | "svg") => {
      const shapesById = new Map(library.shapes.map((shape) => [shape.id, shape]));
      const label = `${spec.gridX}x${spec.gridY}${
        spec.gridPitch === "full" ? "" : `-${spec.gridPitch}`
      }${spec.footprint.kind === "custom" ? `-custom-${spec.footprint.cells.length}cell` : ""}`;
      if (format === "dxf") {
        downloadBlob(
          new Blob([generateLayoutDXF(spec, cutouts, shapesById, fingerHoles)], {
            type: "application/dxf",
          }),
          `bin-layout-${label}.dxf`,
        );
      } else {
        downloadBlob(
          new Blob([generateLayoutSVG(spec, cutouts, shapesById, fingerHoles)], {
            type: "image/svg+xml",
          }),
          `bin-layout-${label}.svg`,
        );
      }
    },
    [spec, cutouts, fingerHoles, library.shapes],
  );

  const handleExportProject = useCallback(() => {
    const baseName = (currentProjectName ?? "project")
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "project";
    downloadBlob(
      new Blob([JSON.stringify(currentProjectDoc, null, 2)], {
        type: "application/json",
      }),
      `${baseName}.pocketry.json`,
    );
    toast({
      title: "Backup exported",
      description: "Created a portable Pocketry JSON backup.",
    });
  }, [currentProjectDoc, currentProjectName, toast]);

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
      setProjectBusy(true);
      saveProject.cancel();
      try {
        const saved = await startNewProject(doc);
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
          description: `${doc.shapes.length} shape${doc.shapes.length === 1 ? "" : "s"}, ${doc.cutouts.length} pocket${doc.cutouts.length === 1 ? "" : "s"}. Save it to the library to give it a name.`,
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

  const handleOpenProject = useCallback(async (projectId: string): Promise<boolean> => {
    setProjectBusy(true);
    saveProject.cancel();
    try {
      const opened = await openProjectFromLibrary(projectId);
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
      setProjectBusy(true);
      try {
        const saved = await deleteProjectFromLibrary(projectId);
        setProjectLibrary(saved);
        toast({
          title: "Project deleted",
          description: "The named library copy was removed.",
        });
        return true;
      } catch (cause) {
        toast({
          title: "Could not delete project",
          description: cause instanceof Error ? cause.message : String(cause),
          variant: "destructive",
        });
        return false;
      } finally {
        setProjectBusy(false);
      }
    },
    [toast],
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
    async (format: "3mf" | "3mf-multicolor" | "stl") => {
      setExporting(true);
      try {
        const label = `${spec.gridX}x${spec.gridY}x${spec.heightUnits}${
          spec.gridPitch === "full" ? "" : `-${spec.gridPitch}`
        }${spec.footprint.kind === "custom" ? `-custom-${spec.footprint.cells.length}cell` : ""}`;
        const multicolor = format === "3mf-multicolor";
        const includePocketFloors =
          multicolor &&
          colorPocketFloors &&
          cutouts.some((cutout) => cutout.depth.mode !== "through");
        const includeStackingRim =
          multicolor && colorStackingRim && spec.lip === "standard";
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
          downloadBlob(
            new Blob([bytes], { type: "model/3mf" }),
            `bin-${label}-multicolor.3mf`,
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
          downloadBlob(new Blob([bytes], { type: "model/3mf" }), `bin-${label}.3mf`);
        } else {
          const stl = writeBinarySTL(
            { positions: result.mesh.positions, indices: result.mesh.indices },
            `Pocketry Gridfinity bin ${label}`,
          );
          downloadBlob(
            new Blob([stl], { type: "application/octet-stream" }),
            `bin-${label}.stl`,
          );
        }
        toast({
          title: "Saved",
          description: multicolor
            ? `Exported bin ${label} as a multi-color 3MF at print quality.`
            : `Exported bin ${label} as ${format.toUpperCase()} at print quality.`,
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
      spec,
      cutouts,
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
    async (cutoutId: string, depthMm: number) => {
      const cutout = cutouts.find((candidate) => candidate.id === cutoutId);
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
        const result = await buildFitCheck(shape, cutout, depthMm, EXPORT_QUALITY);
        const baseName =
          shape.name
            .trim()
            .replace(/[^a-z0-9._-]+/gi, "-")
            .replace(/^-+|-+$/g, "") || "tool";
        const depthLabel = Number.isInteger(depthMm)
          ? String(depthMm)
          : depthMm.toFixed(1);
        const stl = writeBinarySTL(
          { positions: result.mesh.positions, indices: result.mesh.indices },
          `Pocketry ${shape.name} fit template ${depthLabel} mm`,
        );
        downloadBlob(
          new Blob([stl], { type: "application/octet-stream" }),
          `${baseName}-fit-template-${depthLabel}mm.stl`,
        );
        toast({
          title: "Fit template saved",
          description: `Exported “${shape.name}” as a ${depthLabel} mm filled outline.`,
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
    [buildFitCheck, cutouts, library.shapes, toast],
  );

  const handleExportSurfaceFitCheck = useCallback(
    async (thicknessMm: number) => {
      setExporting(true);
      try {
        const result = await buildSurfaceFitCheck(thicknessMm, EXPORT_QUALITY);
        const label = `${spec.gridX}x${spec.gridY}${
          spec.gridPitch === "full" ? "" : `-${spec.gridPitch}`
        }${
          spec.footprint.kind === "custom"
            ? `-custom-${spec.footprint.cells.length}cell`
            : ""
        }`;
        const thicknessLabel = Number.isInteger(thicknessMm)
          ? String(thicknessMm)
          : thicknessMm.toFixed(1);
        const stl = writeBinarySTL(
          { positions: result.mesh.positions, indices: result.mesh.indices },
          `Pocketry ${label} surface fit test ${thicknessLabel} mm`,
        );
        downloadBlob(
          new Blob([stl], { type: "application/octet-stream" }),
          `bin-${label}-surface-fit-test-${thicknessLabel}mm.stl`,
        );
        toast({
          title: "Surface fit test saved",
          description: `Exported the complete pocket-layout surface at ${thicknessLabel} mm thick, without the base, walls, label tab, or stacking lip.`,
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
    [buildSurfaceFitCheck, spec, toast],
  );

  return (
    <WorkspaceLayout
      autoSaveId="tooltrace:bin"
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      panelTitle="Bin designer"
      panel={
        <BinControlsPanel
          stats={stats}
          building={building}
          exporting={exporting}
          onExport={(format) => void handleExport(format)}
          onExportFitCheck={(cutoutId, depthMm) =>
            void handleExportFitCheck(cutoutId, depthMm)
          }
          onExportSurfaceFitCheck={(thicknessMm) =>
            void handleExportSurfaceFitCheck(thicknessMm)
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
          onOpenProject={handleOpenProject}
          onDeleteProject={handleDeleteProject}
          onRefreshProjects={handleRefreshProjects}
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
        <div className="absolute inset-0">
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
            <LayoutCanvas />
          )}
          <ViewToggle
            viewMode={viewMode}
            onChange={(mode) => dispatch({ type: "SET_VIEW_MODE", viewMode: mode })}
          />
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
