import {
  Box,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  LoaderCircle,
  Magnet,
  MousePointerClick,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Scaling,
  Save,
  Scissors,
  Spline,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";

import {
  DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
  DEFAULT_TOP_EDGE_FILLET_MM,
  MAX_OBLONG_DEEP_SCOOP_LENGTH_MM,
  MIN_OBLONG_DEEP_SCOOP_SPAN_MM,
  defaultPocketFloorThicknessMm,
  resolvePocketDepth,
  type FingerHole,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import {
  binFootprintMm,
  GRID_PITCH_DIVISOR,
  resizeGridToStandardCellSpan,
  changeGridPitchPreservingSize,
  STACKING_LIP_HEIGHT_ACTUAL,
  standardCellSpan,
  type GridPitch,
} from "@shared/gridfinity/standard";
import { MAX_GRID, maxGridCells, type BinSpecInput } from "@shared/gridfinity/types";
import type { ValidationIssue } from "@shared/gridfinity/validate";

import {
  PanelBody,
  PanelSection,
  PanelSettingsIndex,
  revealPanelSection,
} from "@/components/layout/panel-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpHint } from "@/components/ui/help-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { fitRectangularBinToPlacements } from "@/lib/gridfinity/autoplace";
import {
  binDimensionsMm,
  MULTICOLOR_FLOOR_MAX_THICKNESS_MM,
  MULTICOLOR_MIN_THICKNESS_MM,
  MULTICOLOR_RIM_MAX_THICKNESS_MM,
} from "@/lib/gridfinity/bin";
import {
  SURFACE_FIT_CHECK_DEFAULT_THICKNESS_MM,
  SURFACE_FIT_CHECK_MAX_THICKNESS_MM,
  SURFACE_FIT_CHECK_MIN_THICKNESS_MM,
  type BuildBinSection,
  type BuildBinStats,
} from "@/lib/gridfinity/worker-api";
import type { ProjectLibraryItem } from "@/lib/project/persist";
import { cn } from "@/lib/utils";
import { PocketDepthSummary, PocketMeasurements, PocketSizeInputs, PositionInputs } from "./pocket-measurements";
import { ExportConfirmationDialog, ProjectBackupOption } from "./export-confirmation-dialog";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";

/** Slider ceiling for height; the schema allows more, the UI keeps it sane. */
const MAX_HEIGHT_UNITS_UI = 12;
/** Slider ceiling: at most eight full cells, within the schema hard cap. */
const maxGridUi = (pitch: GridPitch): number =>
  Math.min(maxGridCells(pitch), 8 * GRID_PITCH_DIVISOR[pitch]);

const formatUnitCount = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");

function MaterialColorSwatch({
  id,
  label,
  value,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (color: string) => void;
}): JSX.Element {
  return (
    <input
      id={id}
      type="color"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-7 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-0.5",
        disabled && "cursor-not-allowed opacity-40",
      )}
      aria-label={`${label} color`}
      title={`Choose ${label.toLowerCase()} color`}
      data-testid={id}
    />
  );
}

function EditableShapeName({ shape, onRename, onDone }: {
  shape: TracedShape;
  onRename: (name: string) => void;
  onDone: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(shape.name);
  const commit = () => {
    const name = draft.trim();
    if (name.length > 0 && name !== shape.name) onRename(name);
    onDone();
  };
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
      className="h-8 min-w-0 flex-1 text-xs font-medium"
      aria-label="Pocket name"
      data-testid="input-shape-name"
    />
  );
}

const BIN_SETTINGS_SECTIONS = [
  { id: "bin-settings-project", label: "Project", tone: "slate" },
  { id: "bin-settings-size", label: "Size", tone: "blue" },
  { id: "bin-settings-construction", label: "Construction", tone: "rose" },
  { id: "bin-settings-pockets", label: "Pockets", tone: "violet" },
  { id: "bin-settings-finger-holes", label: "Finger access", tone: "cyan" },
  { id: "bin-settings-materials", label: "Materials", tone: "amber" },
  { id: "bin-settings-view", label: "Cross-section View", tone: "amber" },
  { id: "bin-settings-fit", label: "Check fit", tone: "emerald" },
  { id: "bin-settings-export", label: "Export", tone: "emerald" },
] as const;

export interface BinControlsPanelProps {
  issues: readonly ValidationIssue[];
  /** A fresh request reveals settings after the controls drawer mounts. */
  settingsSectionRequest?: { id: string };
  /** Changes when the canvas explicitly requests the selected pocket editor. */
  pocketEditorRequest?: number;
  keepBinSize?: boolean;
  onKeepBinSizeChange?: (fixed: boolean) => void;
  saveStatus?: "saving" | "saved" | "error";
  stats: BuildBinStats | null;
  building: boolean;
  exporting: boolean;
  onExport: (format: "3mf" | "3mf-multicolor" | "stl", includeProject: boolean) => void;
  onExportFitCheck: (cutoutId: string, depthMm: number, includeProject: boolean) => void;
  onExportSurfaceFitCheck: (thicknessMm: number, includeProject: boolean) => void;
  onExportLayout: (format: "dxf" | "svg", includeProject: boolean) => void;
  onAutoArrange: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
  projectLibraryReady: boolean;
  projectBusy: boolean;
  activeProjectId: string | null;
  currentProjectName: string | null;
  projects: ProjectLibraryItem[];
  onSaveProject: (name: string) => Promise<boolean>;
  onOpenProject: (projectId: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRefreshProjects: () => void;
  onNewProject: () => void;
  section: BuildBinSection | null;
  onSectionChange: (section: BuildBinSection | null) => void;
  colorPocketFloors: boolean;
  onColorPocketFloorsChange: (enabled: boolean) => void;
  binColor: string;
  onBinColorChange: (color: string) => void;
  pocketFloorColor: string;
  onPocketFloorColorChange: (color: string) => void;
  pocketFloorThicknessMm: number;
  onPocketFloorThicknessChange: (thicknessMm: number) => void;
  colorStackingRim: boolean;
  onColorStackingRimChange: (enabled: boolean) => void;
  stackingRimColor: string;
  onStackingRimColorChange: (color: string) => void;
  stackingRimThicknessMm: number;
  onStackingRimThicknessChange: (thicknessMm: number) => void;
}

/**
 * The bin designer's controls column. Consumes the bin store and the shape
 * library directly (the trace panel's pattern); the worker-facing pieces
 * (stats, export) arrive as props from the page, which owns the geometry
 * hook.
 */
export function BinControlsPanel({
  issues,
  settingsSectionRequest,
  stats,
  building,
  exporting,
  onExport,
  onExportFitCheck,
  onExportSurfaceFitCheck,
  onExportLayout,
  onAutoArrange,
  onExportProject,
  onImportProject,
  projectLibraryReady,
  projectBusy,
  activeProjectId,
  currentProjectName,
  projects,
  onSaveProject,
  onOpenProject,
  onDeleteProject,
  onRefreshProjects,
  onNewProject,
  section,
  onSectionChange,
  colorPocketFloors,
  onColorPocketFloorsChange,
  binColor,
  onBinColorChange,
  pocketFloorColor,
  onPocketFloorColorChange,
  pocketFloorThicknessMm,
  onPocketFloorThicknessChange,
  colorStackingRim,
  onColorStackingRimChange,
  stackingRimColor,
  onStackingRimColorChange,
  stackingRimThicknessMm,
  onStackingRimThicknessChange,
  pocketEditorRequest = 0,
  keepBinSize = false,
  onKeepBinSizeChange,
  saveStatus = "saved",
}: BinControlsPanelProps): JSX.Element {
  const {
    spec,
    cutouts,
    fingerHoles,
    selectedCutoutId,
    selectedFingerHoleId,
    pendingRemovalId,
    editorMode,
    hydrated,
    dispatch,
  } = useBin();
  const [, navigate] = useLocation();
  const { shapes, storeShape } = useShapeLibrary();
  const [renamingPocketId, setRenamingPocketId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedCutoutId || renamingPocketId === selectedCutoutId) return;
    // Selection brings the fixed Pockets section into view. Re-selecting the
    // same canvas pocket increments the request so it is reachable from any section.
    revealPanelSection("bin-settings-pockets", BIN_SETTINGS_SECTIONS, "pocket-properties");
  }, [selectedCutoutId, pocketEditorRequest, renamingPocketId]);
  const shapesById = useMemo(
    () => new Map(shapes.map((shape) => [shape.id, shape])),
    [shapes],
  );

  const dims = useMemo(() => binDimensionsMm(spec), [spec]);
  const widthCellSpan = standardCellSpan(spec.gridX, spec.gridPitch);
  const lengthCellSpan = standardCellSpan(spec.gridY, spec.gridPitch);
  const hasFloorMaterialWarning = issues.some((issue) => issue.code === "floor-color-on-underside");
  useEffect(() => {
    if (settingsSectionRequest) revealPanelSection(settingsSectionRequest.id, BIN_SETTINGS_SECTIONS);
  }, [settingsSectionRequest]);
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const enabledFeatureCount = [
    spec.lip === "standard",
    spec.fill === "solid",
    spec.flatBottom,
    !spec.flatBottom && spec.magnetHoles,
    !spec.flatBottom && spec.screwHoles,
    spec.labelTab !== null,
  ].filter(Boolean).length;
  const [fitCheckDepthMm, setFitCheckDepthMm] = useState(2);
  const [surfaceFitCheckThicknessMm, setSurfaceFitCheckThicknessMm] = useState(
    SURFACE_FIT_CHECK_DEFAULT_THICKNESS_MM,
  );
  const [threeMfDialogOpen, setThreeMfDialogOpen] = useState(false);
  const [includeThreeMfProject, setIncludeThreeMfProject] = useState(false);
  const [pendingExport, setPendingExport] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: (includeProject: boolean) => void;
  } | null>(null);
  const hasBlindPocket = cutouts.some(
    (cutout) => cutout.depth.mode !== "through",
  );
  const hasSelectedFloorColor = colorPocketFloors && hasBlindPocket;
  const hasSelectedRimColor = colorStackingRim && spec.lip === "standard";
  const hasSelectedMulticolor =
    hasSelectedFloorColor || hasSelectedRimColor;
  const activeColorCount =
    1 + Number(hasSelectedFloorColor) + Number(hasSelectedRimColor);

  const patchSpec = (
    patch: Partial<BinSpecInput>,
    transient = false,
    historyLabel?: string,
  ) => dispatch({ type: "PATCH_SPEC", patch, transient, historyLabel });

  const setRectangularCellSpan = (
    axis: "x" | "y",
    span: number,
    transient: boolean,
  ) => {
    const resized = resizeGridToStandardCellSpan(spec, axis, span);
    if (resized.gridX > maxGridCells(resized.gridPitch) || resized.gridY > maxGridCells(resized.gridPitch)) return;
    const promotedToFractionalPitch =
      resized.gridPitch !== spec.gridPitch && resized.gridPitch !== "full";
    patchSpec(
      {
        ...resized,
        ...(promotedToFractionalPitch
          ? {
              magnetHoles: false,
              magnetCrushRibs: false,
              screwHoles: false,
            }
          : {}),
      },
      transient,
      axis === "x" ? "Change bin width" : "Change bin length",
    );
  };

  const selectedCutout = cutouts.find((cutout) => cutout.id === selectedCutoutId) ?? null;
  const selectedFingerHole =
    fingerHoles.find((hole) => hole.id === selectedFingerHoleId) ?? null;
  const selectedShape = selectedCutout
    ? (shapesById.get(selectedCutout.shapeId) ?? null)
    : null;

  const setPocketScale = (axis: "x" | "y", percent: number) => {
    if (!selectedCutout) return;
    const requested = Math.min(20, Math.max(0.05, percent / 100));
    const changedScale = axis === "x" ? selectedCutout.scaleX : selectedCutout.scaleY;
    // The number field also commits on blur; do not record that value twice.
    if (requested === changedScale) return;
    if (!selectedCutout.aspectRatioLocked) {
      dispatch({
        type: "UPDATE_CUTOUT",
        id: selectedCutout.id,
        patch: axis === "x" ? { scaleX: requested } : { scaleY: requested },
        historyLabel: "Scale tool pocket",
      });
      return;
    }
    let factor = requested / changedScale;
    factor = Math.min(
      20 / selectedCutout.scaleX,
      20 / selectedCutout.scaleY,
      Math.max(
        0.05 / selectedCutout.scaleX,
        0.05 / selectedCutout.scaleY,
        factor,
      ),
    );
    dispatch({
      type: "UPDATE_CUTOUT",
      id: selectedCutout.id,
      patch: {
        scaleX: selectedCutout.scaleX * factor,
        scaleY: selectedCutout.scaleY * factor,
      },
      historyLabel: "Scale tool pocket",
    });
  };
  const pendingRemoval =
    cutouts.find((cutout) => cutout.id === pendingRemovalId) ?? null;
  const pendingRemovalShape = pendingRemoval
    ? (shapesById.get(pendingRemoval.shapeId) ?? null)
    : null;

  const fitLayout = (
    nextCutouts: typeof cutouts,
    historyLabel = "Fit bin to contents",
  ) => {
    const fitted = fitRectangularBinToPlacements(
      nextCutouts,
      shapesById,
      spec,
      fingerHoles,
    );
    dispatch({
      type: "REPLACE_LAYOUT",
      ...fitted,
      historyLabel,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-3 py-2" data-testid="project-status">
        <p className="truncate text-sm font-medium" title={currentProjectName ?? "Untitled project"}>{currentProjectName ?? "Untitled project"}</p>
        <p className="text-[11px] text-muted-foreground" role="status">{!hydrated ? "Opening project…" : projectBusy || saveStatus === "saving" ? "Saving in this browser…" : saveStatus === "error" ? "Could not save. Download an editable project to keep your work." : "Saved in this browser"}</p>
      </div>
      {/* On short screens the section headers remain reachable by scrolling;
          reserve the limited height for editable fields instead of shortcuts. */}
      <div className="shrink-0 [@media(max-height:500px)]:hidden">
        <PanelSettingsIndex
          ariaLabel="Find bin settings"
          testIdPrefix="bin"
          items={BIN_SETTINGS_SECTIONS}
        />
      </div>
      <PanelBody className="flex-1">
        <PanelSection
          id="bin-settings-project"
          title="Project"
          icon={FolderOpen}
          tone="slate"
          summary={projectBusy ? "Saving…" : activeProjectId ? "Library" : "Draft"}
          defaultOpen={false}
          className="scroll-mt-16"
        >
          <ProjectControls
            hydrated={hydrated}
            libraryReady={projectLibraryReady}
            busy={projectBusy}
            saveStatus={saveStatus}
            activeProjectId={activeProjectId}
            currentProjectName={currentProjectName}
            projects={projects}
            onSaveProject={onSaveProject}
            onOpenProject={onOpenProject}
            onDeleteProject={onDeleteProject}
            onRefreshProjects={onRefreshProjects}
            onNewProject={onNewProject}
            onExportProject={onExportProject}
            onImportProject={onImportProject}
          />
        </PanelSection>

        <PanelSection
          id="bin-settings-size"
          title="Bin size"
          icon={Scaling}
          tone="blue"
          summary={`${formatUnitCount(widthCellSpan)} × ${formatUnitCount(lengthCellSpan)} × ${formatUnitCount(spec.heightUnits)}u`}
          className="scroll-mt-16"
        >
          <div className="flex items-center gap-2">
            <SettingLabel label="Grid pitch" hint="Pitch changes preserve the outer size. A coarser pitch needs whole cells; custom footprints keep their current pitch." className="shrink-0" />
            <Select
              value={spec.gridPitch}
              onValueChange={(value) => {
                const gridPitch = value as GridPitch;
                const resized = changeGridPitchPreservingSize(spec, gridPitch);
                if (!resized || resized.gridX > maxGridCells(gridPitch) || resized.gridY > maxGridCells(gridPitch) || spec.footprint.kind !== "rectangle") return;
                patchSpec({
                  ...resized,
                  ...(gridPitch === "full"
                    ? {}
                    : {
                        magnetHoles: false,
                        magnetCrushRibs: false,
                        screwHoles: false,
                      }),
                });
              }}
            >
              <SelectTrigger className="h-8 flex-1" data-testid="select-grid-pitch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["full", "half", "quarter"] as const).map((pitch) => {
                  const resized = changeGridPitchPreservingSize(spec, pitch);
                  const available = resized && resized.gridX <= maxGridCells(pitch) && resized.gridY <= maxGridCells(pitch) && spec.footprint.kind === "rectangle";
                  return <SelectItem key={pitch} value={pitch} disabled={!available}>{pitch === "full" ? "Full · 42 mm" : pitch === "half" ? "Half · 21 mm" : "Quarter · 10.5 mm"}{!available ? " (size incompatible)" : ""}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <FeatureSwitch label="Keep bin size fixed" description="Adding tools keeps these dimensions. Tools that do not fit stay visible for adjustment." checked={keepBinSize} onChange={(fixed) => onKeepBinSizeChange?.(fixed)} />
          {spec.footprint.kind === "rectangle" ? (
            <>
              <CellSlider
                label="Width"
                cells={spec.gridX}
                pitch={spec.gridPitch}
                onChange={(span, transient) =>
                  setRectangularCellSpan("x", span, transient)
                }
              />
              <CellSlider
                label="Length"
                cells={spec.gridY}
                pitch={spec.gridPitch}
                onChange={(span, transient) =>
                  setRectangularCellSpan("y", span, transient)
                }
              />
            </>
          ) : (
            <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              Custom footprint. Add or remove cells in the Layout view,
              or reset to a rectangle to use the size sliders.
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Height</Label>
            <div className="flex items-center gap-2">
              <Slider
                className="min-w-12 flex-1"
                value={[spec.heightUnits]}
                onValueChange={([heightUnits]) =>
                  patchSpec({ heightUnits }, true)
                }
                onValueCommit={([heightUnits]) => patchSpec({ heightUnits })}
                min={1}
                max={MAX_HEIGHT_UNITS_UI}
                step={0.5}
                aria-label="Height in 0.5u increments"
              />
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                <DraftNumberInput className="h-8 w-20" aria-label="Bin height in units" value={spec.heightUnits} min={1} max={MAX_HEIGHT_UNITS_UI} step={0.5} normalize={(value) => Math.round(value * 2) / 2} onValueChange={(heightUnits) => patchSpec({ heightUnits }, true)} onValueCommit={(heightUnits) => patchSpec({ heightUnits })} /> units
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Outer size {dims.widthMm.toFixed(1)} × {dims.lengthMm.toFixed(1)} ×{" "}
            {dims.totalHeightMm.toFixed(1)} mm
            {spec.lip === "standard"
              ? ` (rim + ${STACKING_LIP_HEIGHT_ACTUAL.toFixed(1)} mm lip)`
              : ""}
          </p>
          {building && (
            <div
              className="flex items-center gap-1.5 rounded-md border border-blue-500/25 bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-800 dark:text-blue-100"
              role="status"
              aria-live="polite"
              data-testid="bin-size-preview-status"
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Updating 3D preview…
            </div>
          )}
          {(cutouts.length > 0 || fingerHoles.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              data-testid="button-fit-bin"
              onClick={() => fitLayout(cutouts)}
            >
              Fit bin to contents
            </Button>
          )}
          <Button
            variant={editorMode === "footprint" ? "default" : "outline"}
            size="sm"
            className="w-full"
            data-testid="button-edit-footprint"
            onClick={() => {
              const editing = editorMode === "footprint";
              dispatch({ type: "SET_EDITOR_MODE", editorMode: editing ? "placement" : "footprint" });
              if (!editing) dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
            }}
          >
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
            {editorMode === "footprint" ? "Finish footprint editing" : "Edit footprint"}
          </Button>
          {spec.footprint.kind === "custom" && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              data-testid="button-reset-footprint"
              onClick={() => patchSpec({ footprint: { kind: "rectangle" } })}
            >
              Reset to rectangle
            </Button>
          )}
        </PanelSection>

        <PanelSection
          id="bin-settings-construction"
          title="Construction"
          icon={Magnet}
          tone="rose"
          summary={spec.flatBottom ? "Flat bottom" : `${enabledFeatureCount} on`}
          defaultOpen={false}
          className="scroll-mt-16"
        >
          <FeatureSwitch
            label="Stacking lip"
            description={spec.flatBottom ? "Receives a Gridfinity bin on top" : "Lets another bin stack on top"}
            checked={spec.lip === "standard"}
            onChange={(on) => patchSpec({ lip: on ? "standard" : "none" })}
          />
          <FeatureSwitch
            label="Solid fill"
            description="Material for pockets — required for cutouts"
            checked={spec.fill === "solid"}
            onChange={(on) => patchSpec({ fill: on ? "solid" : "none" })}
          />
          {!spec.flatBottom && (
            <>
              <FeatureSwitch
                label="Magnet holes"
                description={
                  spec.gridPitch === "full"
                    ? "⌀6.5 × 2.4 mm, four per cell"
                    : "Available on the full 42 mm pitch"
                }
                checked={spec.magnetHoles}
                disabled={spec.gridPitch !== "full"}
                onChange={(magnetHoles) => patchSpec({ magnetHoles })}
              />
              {spec.magnetHoles && (
                <FeatureSwitch
                  label="Crush ribs"
                  description="Press-fit magnets, no glue"
                  checked={spec.magnetCrushRibs}
                  onChange={(magnetCrushRibs) => patchSpec({ magnetCrushRibs })}
                />
              )}
              <FeatureSwitch
                label="Screw holes"
                description={
                  spec.gridPitch === "full"
                    ? "⌀3 mm M3, through the base"
                    : "Available on the full 42 mm pitch"
                }
                checked={spec.screwHoles}
                disabled={spec.gridPitch !== "full"}
                onChange={(screwHoles) => patchSpec({ screwHoles })}
              />
            </>
          )}

          <FeatureSwitch
            label="Flat bottom"
            description="Smooth underside; no Gridfinity base."
            checked={spec.flatBottom}
            onChange={(flatBottom) => patchSpec({ flatBottom })}
          />

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <SettingLabel label="Label tab" hint="A sloped shelf under the rim for labelling the bin." className="shrink-0" />
              <Select
                value={spec.labelTab?.width ?? "none"}
                onValueChange={(width) =>
                  patchSpec({
                    labelTab:
                      width === "none"
                        ? null
                        : {
                            wall: spec.labelTab?.wall ?? "north",
                            width: width as "full" | "center" | "left" | "right",
                          },
                  })
                }
              >
                <SelectTrigger className="h-8 flex-1" data-testid="select-label-tab">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="full">Full width</SelectItem>
                  <SelectItem value="center">Center · 42 mm</SelectItem>
                  <SelectItem value="left">Left · 42 mm</SelectItem>
                  <SelectItem value="right">Right · 42 mm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {spec.labelTab && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="w-16 shrink-0 text-xs">On wall</Label>
                  <Select
                    value={spec.labelTab.wall}
                    onValueChange={(wall) =>
                      patchSpec({
                        labelTab: {
                          ...spec.labelTab!,
                          wall: wall as "north" | "south" | "east" | "west",
                          edge: null,
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-8 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="north">Back</SelectItem>
                      <SelectItem value="south">Front</SelectItem>
                      <SelectItem value="east">Right</SelectItem>
                      <SelectItem value="west">Left</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant={editorMode === "label-edge" ? "default" : "outline"}
                  size="sm"
                  className="w-full"
                  data-testid="button-choose-label-edge"
                  onClick={() => {
                    const editing = editorMode === "label-edge";
                    dispatch({ type: "SET_EDITOR_MODE", editorMode: editing ? "placement" : "label-edge" });
                    if (!editing) dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
                  }}
                >
                  <MousePointerClick className="mr-1.5 h-3.5 w-3.5" />
                  {editorMode === "label-edge" ? "Cancel edge selection" : "Choose any edge"}
                </Button>
              </div>
            )}
          </div>
        </PanelSection>

        {/* Keyed on emptiness: defaultOpen is uncontrolled, and the section
            should reveal itself the moment the first pocket arrives. */}
        <PanelSection
          key={cutouts.length > 0 ? "pockets" : "pockets-empty"}
          id="bin-settings-pockets"
          title="Pockets"
          icon={Scissors}
          tone="violet"
          summary={`${cutouts.length} pocket${cutouts.length === 1 ? "" : "s"}`}
          defaultOpen={cutouts.length > 0}
          className="scroll-mt-16"
        >
          {cutouts.length > 0 && (
            <div className="space-y-1" aria-label="Choose a pocket to edit">
              {cutouts.map((cutout) => {
                const shape = shapesById.get(cutout.shapeId);
                const isSelected = cutout.id === selectedCutoutId;
                return (
                  <div key={cutout.id} data-testid={`cutout-row-${cutout.id}`} className={cn(
                    "flex items-center rounded-md border text-xs",
                    isSelected ? "border-violet-500/50 bg-violet-500/10" : "border-transparent hover:bg-accent",
                  )}>
                    {renamingPocketId === cutout.id && shape ? (
                      <EditableShapeName key={cutout.id} shape={shape} onRename={(name) => storeShape({ ...shape, name })} onDone={() => setRenamingPocketId(null)} />
                    ) : (
                    <button
                      type="button"
                      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${shape?.name ?? "Missing shape"} — edit pocket properties`}
                      aria-pressed={isSelected}
                      aria-controls="pocket-properties"
                      data-testid={`button-select-${cutout.id}`}
                      onClick={() => {
                        dispatch({ type: "SELECT_CUTOUT", id: cutout.id });
                        if (isSelected) revealPanelSection("bin-settings-pockets", BIN_SETTINGS_SECTIONS, "pocket-properties");
                      }}
                    >
                      <span className={cn("min-w-0 flex-1 truncate", isSelected && "font-medium text-violet-700 dark:text-violet-300")}>{shape?.name ?? "Missing shape"}</span>
                    </button>
                    )}
                    <button type="button" className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Rename ${shape?.name ?? "pocket"}`} disabled={!shape} data-testid={`button-rename-${cutout.id}`} onClick={() => {
                      dispatch({ type: "SELECT_CUTOUT", id: cutout.id });
                      setRenamingPocketId(cutout.id);
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Duplicate ${shape?.name ?? "pocket"}`} data-testid={`button-duplicate-${cutout.id}`} onClick={() => dispatch({ type: "DUPLICATE_CUTOUT", id: cutout.id, newId: crypto.randomUUID() })}>
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${shape?.name ?? "pocket"}`} data-testid={`button-remove-${cutout.id}`} onClick={() => dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: cutout.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {!selectedCutout && (
            <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground" id="pocket-properties" data-testid="pocket-selection-help">
              {cutouts.length === 0
                ? "Trace a tool and press “Add to bin” to create a pocket."
                : "Select a pocket on the canvas or in the list above. Its properties appear here."}
            </p>
          )}
          {selectedCutout && selectedShape && (
            <div className="space-y-3 rounded-md border border-violet-500/30 bg-violet-500/[0.025] p-2.5" id="pocket-properties" role="region" aria-label="Selected pocket properties">
              <div className="flex min-w-0 items-center gap-2 border-b border-violet-500/20 pb-2" data-testid="pocket-properties-heading">
                <h3 className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Pocket properties</h3>
                <span className="min-w-0 truncate text-xs font-medium" title={selectedShape.name}>{selectedShape.name}</span>
                <Button
                  variant={editorMode === "contour" ? "default" : "outline"}
                  size="sm"
                  className="ml-auto h-7 shrink-0 gap-1 px-1.5 text-[10px]"
                  aria-label={editorMode === "contour" ? "Finish contour editing" : "Edit contour"}
                  aria-pressed={editorMode === "contour"}
                  data-testid="button-edit-contour"
                  onClick={() => {
                    const editing = editorMode === "contour";
                    dispatch({
                      type: "SET_EDITOR_MODE",
                      editorMode: editing ? "placement" : "contour",
                    });
                    if (!editing) {
                      dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
                    }
                  }}
                >
                  <Spline className="h-3 w-3" />
                  {editorMode === "contour" ? "Done" : "Edit contour"}
                </Button>
              </div>
              <section className="space-y-2" aria-label="Pocket depth" key={selectedCutout.id}>
                <div className="flex items-center gap-1">
                  <h4 className="text-sm font-semibold">Depth</h4>
                  {spec.flatBottom && selectedCutout.depth.mode === "remaining" && <HelpHint label="remaining floor thickness">Measured from the flat underside. A 2 mm floor lets pockets extend into the former base area.</HelpHint>}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedCutout.depth.mode}
                    onValueChange={(mode) => {
                      const resolved = resolvePocketDepth(spec, selectedCutout.depth);
                      const depth =
                        mode === "through"
                          ? ({ mode: "through" } as const)
                          : mode === "mm"
                            ? ({ mode: "mm", value: Math.max(0.1, resolved.depthMm ?? resolved.infillTopZ - defaultPocketFloorThicknessMm(spec)) } as const)
                            : ({ mode: "remaining", floorThicknessMm: spec.flatBottom ? defaultPocketFloorThicknessMm(spec) : Math.max(0, resolved.floorZ ?? defaultPocketFloorThicknessMm(spec)) } as const);
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { depth },
                        historyLabel: "Change pocket depth",
                      });
                    }}
                  >
                    <SelectTrigger className="h-9 flex-1" aria-label="Pocket depth mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remaining">Keep floor thickness</SelectItem>
                      <SelectItem value="mm">Fixed depth</SelectItem>
                      <SelectItem value="through">Through</SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedCutout.depth.mode === "mm" && (
                    <DraftNumberInput
                      className="h-9 w-20 text-base font-semibold"
                      aria-label="Pocket cut depth in millimetres"
                      value={selectedCutout.depth.value}
                      min={1}
                      step={1}
                      onValueChange={(value) =>
                        dispatch({
                          type: "UPDATE_CUTOUT",
                          id: selectedCutout.id,
                          patch: { depth: { mode: "mm", value } },
                          historyLabel: "Change pocket depth",
                        })
                      }
                    />
                  )}
                </div>

                {selectedCutout.depth.mode === "remaining" && <MmSlider label="Remaining floor thickness" value={selectedCutout.depth.floorThicknessMm} min={0} max={Math.max(7, spec.heightUnits * 7)} step={0.5}
                  onChange={(floorThicknessMm, transient) => dispatch({ type: "UPDATE_CUTOUT", id: selectedCutout.id, patch: { depth: { mode: "remaining", floorThicknessMm } }, transient, historyLabel: "Change remaining floor" })} />}

                <PocketDepthSummary cutout={selectedCutout} shape={selectedShape} section={section} inspect={onSectionChange} />
              </section>
              <details className="group/size border-t pt-1 text-xs" aria-label="Pocket size and scale" data-testid="pocket-size-settings">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 font-medium [&::-webkit-details-marker]:hidden">
                  Size &amp; scale
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/size:rotate-180" />
                </summary>
                <div className="pb-2" key={selectedCutout.id}><PocketSizeInputs cutout={selectedCutout} shape={selectedShape} setScale={setPocketScale} /></div>
              </details>

              <details className="group/more border-t pt-1 text-xs" data-testid="pocket-edge-settings">
                <summary className="flex cursor-pointer list-none items-center justify-between py-1.5 font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1">Edges &amp; corners <HelpHint label="edges and corners">Soften sharp corners and edges. Values are rounding radii in millimetres; 0 keeps an edge sharp.</HelpHint></span>
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/more:rotate-180" />
                </summary>
                <div className="space-y-3 pt-2" key={selectedCutout.id}>
                  <MmSlider
                    label="Top edge rounding"
                    value={selectedCutout.topFilletMm}
                    min={0}
                    max={5}
                    step={0.2}
                    onChange={(topFilletMm, transient) =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { topFilletMm },
                        historyLabel: "Change top edge round",
                        transient,
                      })
                    }
                    hintAsTooltip
                    hint="Rounds the pocket wall into the top surface of the bin."
                  />
                  <MmSlider
                    label="Bottom edge fillet"
                    value={selectedCutout.bottomFilletMm}
                    min={0}
                    max={4}
                    step={0.2}
                    onChange={(bottomFilletMm, transient) =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { bottomFilletMm },
                        historyLabel: "Change bottom fillet",
                        transient,
                      })
                    }
                    hintAsTooltip
                    hint="Rounds the wall into the floor; the transition ends one radius above the floor."
                  />
                  <MmSlider
                    label="Outline corner rounding"
                    value={selectedCutout.cornerRoundMm}
                    min={0}
                    max={3}
                    step={0.5}
                    onChange={(cornerRoundMm, transient) =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { cornerRoundMm },
                        historyLabel: "Change outline corner round",
                        transient,
                      })
                    }
                    hintAsTooltip
                    hint="Rounds sharp corners in the pocket outline from top to bottom."
                  />

                </div>
              </details>
              <PocketMeasurements cutout={selectedCutout} shape={selectedShape}>
                <div className="flex items-center gap-2">
                  <Label className="w-16 shrink-0 text-xs">Rotation</Label>
                  <DraftNumberInput
                    className="h-8"
                    aria-label="Pocket rotation in degrees"
                    value={Math.round(selectedCutout.rotationDeg * 10) / 10}
                    step={15}
                    normalize={(value) => ((value % 360) + 360) % 360}
                    onValueChange={(rotationDeg) =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { rotationDeg },
                        historyLabel: "Rotate tool pocket",
                      })
                    }
                  />
                  <FeatureSwitch
                    label="Mirror"
                    description=""
                    checked={selectedCutout.mirrored}
                    onChange={(mirrored) =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { mirrored },
                        historyLabel: "Mirror tool pocket",
                      })
                    }
                  />
                </div>

              </PocketMeasurements>
              <details className="group/clearance border-t pt-1 text-xs" data-testid="pocket-clearance-settings">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1">Extra pocket clearance
                    <HelpHint label="extra pocket clearance">
                      Adjusts each edge after the Trace margin and scaling. Negative values shrink the pocket to reduce excess padding; positive values enlarge it. Zero keeps the traced size. Narrow features can disappear when shrunk.
                      <span className="mt-1 block">{selectedShape.traceMarginMm === undefined
                        ? `Original trace margin unknown (older project). Extra allowance: ${selectedCutout.clearanceMm.toFixed(2)} mm per edge.`
                        : `Trace margin: ${selectedShape.traceMarginMm.toFixed(2)} mm per edge before scaling. Nominal total allowance X/Y: ${(selectedShape.traceMarginMm * selectedCutout.scaleX + selectedCutout.clearanceMm).toFixed(2)} / ${(selectedShape.traceMarginMm * selectedCutout.scaleY + selectedCutout.clearanceMm).toFixed(2)} mm per edge.`}</span>
                    </HelpHint>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/clearance:rotate-180" />
                </summary>
                <div className="space-y-2 pb-2" key={selectedCutout.id}>
                  <MmSlider
                    label="Extra pocket clearance"
                    value={selectedCutout.clearanceMm}
                    centered
                    inline
                    min={-2}
                    max={2}
                    step={0.1}
                    onChange={(clearanceMm, transient) =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: { clearanceMm },
                        historyLabel: "Change pocket clearance",
                        transient,
                      })
                    }
                  />
                </div>
              </details>

              {editorMode === "contour" && (
                <p className="rounded-md bg-violet-500/10 px-2.5 py-2 text-[11px] text-violet-800 dark:text-violet-200">
                  Drag points to reshape. Click an edge to add a point; right-click a
                  point to remove it.
                </p>
              )}

            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={onAutoArrange} disabled={cutouts.length === 0} data-testid="button-auto-arrange">
              <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />Auto-arrange
            </Button>
          </div>

        </PanelSection>

        <PanelSection
          key={fingerHoles.length > 0 ? "finger-holes" : "finger-holes-empty"}
          id="bin-settings-finger-holes"
          title="Finger access"
          icon={CircleDot}
          tone="cyan"
          summary={`${fingerHoles.length} hole${fingerHoles.length === 1 ? "" : "s"}`}
          defaultOpen={fingerHoles.length > 0}
          className="scroll-mt-16"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <SettingLabel label="Finger holes" hint="Finger holes are independent layout objects. Select, move, resize, or remove one without changing a tool pocket. Drag a hole to move it and its white size handle to resize it; oblong holes also have two end handles for length and angle." />
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                data-testid="button-add-finger-hole"
                onClick={() =>
                  dispatch({
                    type: "ADD_FINGER_HOLE",
                    hole: {
                      id: crypto.randomUUID(),
                      center: { x: 0, y: 0 },
                      diameterMm: 18,
                      kind: "straight",
                      depthMm: 12,
                      topFilletMm: DEFAULT_TOP_EDGE_FILLET_MM,
                      bottomFilletMm: 0,
                    },
                  })
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                Add hole
              </Button>
            </div>

            {fingerHoles.length > 0 && (
              <div className="space-y-1">
                {fingerHoles.map((hole, index) => {
                  const isSelected = hole.id === selectedFingerHoleId;
                  return (
                    <div
                      key={hole.id}
                      className={cn(
                        "flex items-center gap-1 rounded border px-1 py-1 text-xs",
                        isSelected
                          ? "border-violet-500/40 bg-violet-500/10"
                          : "border-transparent hover:border-violet-500/20 hover:bg-accent/50",
                      )}
                      data-testid={`finger-hole-row-${hole.id}`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded px-1 py-0.5 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          dispatch({ type: "SELECT_FINGER_HOLE", id: hole.id })
                        }
                        data-testid={`button-select-finger-hole-${hole.id}`}
                      >
                        Hole {index + 1} · {hole.kind === "scoop"
                          ? "Round scoop"
                          : hole.kind === "deep-scoop"
                            ? "Deep scoop"
                            : hole.kind === "oblong-deep-scoop"
                              ? "Oblong deep scoop"
                              : "Straight"}
                      </button>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {isSelected ? "Selected" : "Select to edit"}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove finger hole ${index + 1}`}
                        onClick={() =>
                          dispatch({ type: "REMOVE_FINGER_HOLE", id: hole.id })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedFingerHole && (
              <div className="space-y-2 border-t pt-3">
                <PositionInputs position={selectedFingerHole.center} onChange={(center, transient) => dispatch({ type: "UPDATE_FINGER_HOLE", id: selectedFingerHole.id, patch: { center }, transient, historyLabel: "Position finger access" })} />
                <Select
                  value={selectedFingerHole.kind}
                  onValueChange={(kind) => {
                    const diameterMm = selectedFingerHole.diameterMm;
                    dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: {
                        kind: kind as FingerHole["kind"],
                        depthMm:
                          kind === "scoop"
                            ? Math.min(selectedFingerHole.depthMm, diameterMm / 2)
                            : kind === "deep-scoop" || kind === "oblong-deep-scoop"
                              ? Math.max(selectedFingerHole.depthMm, diameterMm / 2)
                              : selectedFingerHole.depthMm,
                        lengthMm:
                          kind === "oblong-deep-scoop"
                            ? Math.max(
                                selectedFingerHole.lengthMm ??
                                  DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
                                diameterMm + MIN_OBLONG_DEEP_SCOOP_SPAN_MM,
                              )
                            : selectedFingerHole.lengthMm,
                        rotationDeg:
                          kind === "oblong-deep-scoop"
                            ? (selectedFingerHole.rotationDeg ?? 0)
                            : selectedFingerHole.rotationDeg,
                      },
                      historyLabel: "Change finger hole type",
                    });
                  }}
                >
                  <SelectTrigger
                    className="h-8"
                    aria-label="Selected finger hole type"
                    data-testid="selected-finger-hole-kind"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight">Straight</SelectItem>
                    <SelectItem value="scoop">Round scoop</SelectItem>
                    <SelectItem value="deep-scoop">Deep scoop</SelectItem>
                    <SelectItem value="oblong-deep-scoop">
                      Oblong deep scoop
                    </SelectItem>
                  </SelectContent>
                </Select>

                <MmSlider
                  label="Diameter"
                  value={selectedFingerHole.diameterMm}
                  min={6}
                  max={40}
                  step={1}
                  onChange={(diameterMm, transient) =>
                    dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: {
                        diameterMm,
                        depthMm:
                          selectedFingerHole.kind === "scoop"
                            ? Math.min(selectedFingerHole.depthMm, diameterMm / 2)
                            : selectedFingerHole.kind === "deep-scoop" ||
                                selectedFingerHole.kind === "oblong-deep-scoop"
                              ? Math.max(selectedFingerHole.depthMm, diameterMm / 2)
                              : selectedFingerHole.depthMm,
                        lengthMm:
                          selectedFingerHole.kind === "oblong-deep-scoop"
                            ? Math.max(
                                selectedFingerHole.lengthMm ??
                                  DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
                                diameterMm + MIN_OBLONG_DEEP_SCOOP_SPAN_MM,
                              )
                            : selectedFingerHole.lengthMm,
                      },
                      historyLabel: "Resize finger hole",
                      transient,
                    })
                  }
                  hint="You can also drag the white size handle in Layout."
                />

                {selectedFingerHole.kind === "straight" && (
                  <MmSlider
                    label="Depth"
                    value={selectedFingerHole.depthMm}
                    min={1}
                    max={120}
                    step={0.5}
                    onChange={(depthMm, transient) =>
                      dispatch({
                        type: "UPDATE_FINGER_HOLE",
                        id: selectedFingerHole.id,
                        patch: { depthMm },
                        historyLabel: "Change finger hole depth",
                        transient,
                      })
                    }
                  />
                )}

                {selectedFingerHole.kind === "scoop" && (
                  <MmSlider
                    label="Depth"
                    value={Math.min(
                      selectedFingerHole.depthMm,
                      selectedFingerHole.diameterMm / 2,
                    )}
                    min={1}
                    max={Math.min(30, selectedFingerHole.diameterMm / 2)}
                    step={0.5}
                    onChange={(depthMm, transient) =>
                      dispatch({
                        type: "UPDATE_FINGER_HOLE",
                        id: selectedFingerHole.id,
                        patch: { depthMm },
                        historyLabel: "Change finger scoop depth",
                        transient,
                      })
                    }
                  />
                )}

                {(selectedFingerHole.kind === "deep-scoop" ||
                  selectedFingerHole.kind === "oblong-deep-scoop") && (
                  <div className="space-y-1">
                    <MmSlider
                      label="Total depth"
                      value={Math.max(
                        selectedFingerHole.depthMm,
                        selectedFingerHole.diameterMm / 2,
                      )}
                      min={selectedFingerHole.diameterMm / 2}
                      max={120}
                      step={0.5}
                      onChange={(depthMm, transient) =>
                        dispatch({
                          type: "UPDATE_FINGER_HOLE",
                          id: selectedFingerHole.id,
                          patch: { depthMm },
                          historyLabel: "Change deep scoop depth",
                          transient,
                        })
                      }
                    />
                    <p className="pl-16 text-[11px] text-muted-foreground">
                      Vertical walls: {Math.max(
                        0,
                        selectedFingerHole.depthMm -
                          selectedFingerHole.diameterMm / 2,
                      ).toFixed(1)} mm · rounded bottom radius: {(
                        selectedFingerHole.diameterMm / 2
                      ).toFixed(1)} mm
                    </p>
                  </div>
                )}

                {selectedFingerHole.kind === "oblong-deep-scoop" && (
                  <div className="space-y-2">
                    <MmSlider
                      label="Length"
                      value={Math.max(
                        selectedFingerHole.lengthMm ??
                          DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
                        selectedFingerHole.diameterMm +
                          MIN_OBLONG_DEEP_SCOOP_SPAN_MM,
                      )}
                      min={
                        selectedFingerHole.diameterMm +
                        MIN_OBLONG_DEEP_SCOOP_SPAN_MM
                      }
                      max={MAX_OBLONG_DEEP_SCOOP_LENGTH_MM}
                      step={1}
                      onChange={(lengthMm, transient) =>
                        dispatch({
                          type: "UPDATE_FINGER_HOLE",
                          id: selectedFingerHole.id,
                          patch: { lengthMm },
                          historyLabel: "Resize oblong finger hole",
                          transient,
                        })
                      }
                    />
                    <div className="flex items-center gap-1.5">
                      <Label className="w-16 shrink-0 text-xs">Rotation</Label>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Rotate oblong finger hole 90 degrees counterclockwise"
                        onClick={() =>
                          dispatch({
                            type: "UPDATE_FINGER_HOLE",
                            id: selectedFingerHole.id,
                            patch: {
                              rotationDeg:
                                (((selectedFingerHole.rotationDeg ?? 0) + 90) %
                                  360 +
                                  360) %
                                360,
                            },
                            historyLabel: "Rotate oblong finger hole",
                          })
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Rotate oblong finger hole 90 degrees clockwise"
                        onClick={() =>
                          dispatch({
                            type: "UPDATE_FINGER_HOLE",
                            id: selectedFingerHole.id,
                            patch: {
                              rotationDeg:
                                (((selectedFingerHole.rotationDeg ?? 0) - 90) %
                                  360 +
                                  360) %
                                360,
                            },
                            historyLabel: "Rotate oblong finger hole",
                          })
                        }
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                      <DraftNumberInput
                        className="h-8 min-w-0"
                        aria-label="Oblong finger hole rotation"
                        value={
                          Math.round((selectedFingerHole.rotationDeg ?? 0) * 10) /
                          10
                        }
                        step={15}
                        normalize={(value) => ((value % 360) + 360) % 360}
                        onValueChange={(rotationDeg) =>
                          dispatch({
                            type: "UPDATE_FINGER_HOLE",
                            id: selectedFingerHole.id,
                            patch: { rotationDeg },
                            historyLabel: "Rotate oblong finger hole",
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground">°</span>
                    </div>
                  </div>
                )}

                <MmSlider
                  label="Top edge round"
                  value={selectedFingerHole.topFilletMm}
                  min={0}
                  max={5}
                  step={0.2}
                  onChange={(topFilletMm, transient) =>
                    dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: { topFilletMm },
                      historyLabel: "Change finger hole top edge round",
                      transient,
                    })
                  }
                  hint="Rounds the opening into the bin's top surface."
                />

                {selectedFingerHole.kind === "straight" && (
                  <MmSlider
                    label="Bottom edge fillet"
                    value={selectedFingerHole.bottomFilletMm}
                    min={0}
                    max={Math.min(4, selectedFingerHole.diameterMm / 2)}
                    step={0.2}
                    onChange={(bottomFilletMm, transient) =>
                      dispatch({
                        type: "UPDATE_FINGER_HOLE",
                        id: selectedFingerHole.id,
                        patch: { bottomFilletMm },
                        historyLabel: "Change finger hole bottom fillet",
                        transient,
                      })
                    }
                    hint="Rounds the straight wall into its flat floor."
                  />
                )}
              </div>
            )}
          </div>
        </PanelSection>

        <PanelSection
          id="bin-settings-materials"
          title="Materials"
          icon={Palette}
          tone="amber"
          summary={`${activeColorCount} colors`}
          defaultOpen={false}
          className="scroll-mt-16"
        >
          <div
            className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-2.5 py-2"
            data-testid="view-color-row-bin"
          >
            <div className="min-w-0">
              <SettingLabel label="Bin body" htmlFor="input-bin-color" hint="Main preview and 3MF material." />
            </div>
            <MaterialColorSwatch
              id="input-bin-color"
              label="Bin body"
              value={binColor}
              onChange={onBinColorChange}
            />
          </div>
          <div
            className="space-y-2 rounded-md border bg-background/60 px-2.5 py-2"
            data-testid="view-color-row-floor"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SettingLabel label="Pocket floors" hint="Separate material below blind-pocket surfaces." />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <MaterialColorSwatch
                  id="input-pocket-floor-color"
                  label="Pocket floors"
                  value={pocketFloorColor}
                  disabled={!colorPocketFloors}
                  onChange={onPocketFloorColorChange}
                />
                <Switch
                  checked={colorPocketFloors}
                  onCheckedChange={onColorPocketFloorsChange}
                  aria-label="Color pocket floors"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <SettingLabel label="Color thickness" htmlFor="input-pocket-floor-thickness" hint="Accent thickness replaces existing material downward from the original surface; it never adds height to the bin." />
              <div className="flex items-center gap-1.5">
                <DraftNumberInput
                  id="input-pocket-floor-thickness"
                  className="h-7 w-20 text-right text-xs"
                  value={pocketFloorThicknessMm}
                  min={MULTICOLOR_MIN_THICKNESS_MM}
                  max={MULTICOLOR_FLOOR_MAX_THICKNESS_MM}
                  step={0.2}
                  disabled={!colorPocketFloors}
                  normalize={(value) =>
                    Number(
                      Math.min(
                        MULTICOLOR_FLOOR_MAX_THICKNESS_MM,
                        Math.max(MULTICOLOR_MIN_THICKNESS_MM, value),
                      ).toFixed(1),
                    )
                  }
                  onValueChange={onPocketFloorThicknessChange}
                  aria-label="Pocket floor color thickness in millimetres"
                  data-testid="input-pocket-floor-thickness"
                />
                <span className="text-[11px] text-muted-foreground">mm down</span>
              </div>
            </div>

          </div>
          <div
            className="space-y-2 rounded-md border bg-background/60 px-2.5 py-2"
            data-testid="view-color-row-rim"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SettingLabel label="Stacking rim top" hint="Separate material below the original rim surface." />
                {spec.lip !== "standard" && <p className="text-[11px] text-muted-foreground">Turn on the stacking lip to enable this material.</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <MaterialColorSwatch
                  id="input-stacking-rim-color"
                  label="Stacking rim top"
                  value={stackingRimColor}
                  disabled={!colorStackingRim || spec.lip !== "standard"}
                  onChange={onStackingRimColorChange}
                />
                <Switch
                  checked={colorStackingRim && spec.lip === "standard"}
                  disabled={spec.lip !== "standard"}
                  onCheckedChange={onColorStackingRimChange}
                  aria-label="Color stacking rim top"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <SettingLabel label="Color thickness" htmlFor="input-stacking-rim-thickness" hint="Accent thickness replaces existing material downward from the original surface; it never adds height to the bin." />
              <div className="flex items-center gap-1.5">
                <DraftNumberInput
                  id="input-stacking-rim-thickness"
                  className="h-7 w-20 text-right text-xs"
                  value={stackingRimThicknessMm}
                  min={MULTICOLOR_MIN_THICKNESS_MM}
                  max={MULTICOLOR_RIM_MAX_THICKNESS_MM}
                  step={0.05}
                  disabled={!colorStackingRim || spec.lip !== "standard"}
                  normalize={(value) =>
                    Number(
                      Math.min(
                        MULTICOLOR_RIM_MAX_THICKNESS_MM,
                        Math.max(MULTICOLOR_MIN_THICKNESS_MM, value),
                      ).toFixed(2),
                    )
                  }
                  onValueChange={onStackingRimThicknessChange}
                  aria-label="Stacking rim color thickness in millimetres"
                  data-testid="input-stacking-rim-thickness"
                />
                <span className="text-[11px] text-muted-foreground">mm down</span>
              </div>
            </div>
          </div>
        </PanelSection>
        <PanelSection id="bin-settings-view" title="Cross-section View" icon={Eye} tone="amber" defaultOpen={section !== null} summary={section ? "Cut open" : "Whole bin"}>
          <FeatureSwitch
            label="Cut the preview open"
            description="Slice the 3D view to inspect pockets. These controls only change the preview; exports always contain the complete bin."
            checked={section !== null}
            onChange={(on) =>
              onSectionChange(on ? { axis: "x", offsetMm: 0 } : null)
            }
          />
          {section && (
            <>
              <div className="flex items-center gap-2">
                <Label className="w-16 shrink-0 text-xs">Axis</Label>
                <Select
                  value={section.axis}
                  onValueChange={(axis) =>
                    onSectionChange({ ...section, axis: axis as "x" | "y" })
                  }
                >
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="x">Across width (X)</SelectItem>
                    <SelectItem value="y">Across length (Y)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <MmSlider
                label="Position"
                value={section.offsetMm}
                min={
                  -binFootprintMm(
                    section.axis === "x" ? spec.gridX : spec.gridY,
                    spec.gridPitch,
                  ) / 2
                }
                max={
                  binFootprintMm(
                    section.axis === "x" ? spec.gridX : spec.gridY,
                    spec.gridPitch,
                  ) / 2
                }
                step={0.5}
                onChange={(offsetMm) => onSectionChange({ ...section, offsetMm })}
              />
            </>
          )}
        </PanelSection>

        <PanelSection id="bin-settings-fit" title="Check fit" icon={ClipboardCheck} tone="emerald" defaultOpen={false} summary="Thin templates">
          <div
            className="space-y-3 rounded-md border border-violet-500/25 bg-violet-500/5 p-2.5"
            data-testid="export-preview-layout"
          >
            <div>
              <SettingLabel label="Fit templates and layout" hint="Print a thin template and try the actual tools before printing the full bin. These lightweight outputs check fit or plan a shadow board; they are not the final bin model." />
            </div>

            {(cutouts.length > 0 || fingerHoles.length > 0) && (
              <div
                className="space-y-2 border-t pt-2.5"
                data-testid="surface-fit-test-export"
              >
                <div>
                  <SettingLabel label="Complete surface fit test" hint="The bin's full pocket-layout surface as one thin plate, without its base, wall height, label tab, or stacking lip. Checks every pocket opening and independent finger hole together. It does not test cut depth or baseplate fit." />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-20 shrink-0 text-xs">Thickness</Label>
                  <DraftNumberInput
                    className="h-8"
                    value={surfaceFitCheckThicknessMm}
                    min={SURFACE_FIT_CHECK_MIN_THICKNESS_MM}
                    max={SURFACE_FIT_CHECK_MAX_THICKNESS_MM}
                    step={0.2}
                    normalize={(value) =>
                      Math.min(
                        SURFACE_FIT_CHECK_MAX_THICKNESS_MM,
                        Math.max(SURFACE_FIT_CHECK_MIN_THICKNESS_MM, value),
                      )
                    }
                    onValueChange={setSurfaceFitCheckThicknessMm}
                    aria-label="Surface fit test thickness in millimetres"
                    data-testid="input-surface-fit-test-thickness"
                  />
                  <span className="text-xs text-muted-foreground">mm</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={exporting || hasErrors}
                  onClick={() =>
                    setPendingExport({
                      title: "Save surface fit test STL?",
                      description: `Download the complete pocket layout as a ${surfaceFitCheckThicknessMm} mm thin plate.`,
                      confirmLabel: "Download STL",
                      onConfirm: (includeProject) => onExportSurfaceFitCheck(surfaceFitCheckThicknessMm, includeProject),
                    })
                  }
                  data-testid="button-export-surface-fit-test"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {exporting ? "Building…" : "Save surface fit test STL"}
                </Button>
              </div>
            )}

            {selectedCutout && selectedShape ? (
              <div className="space-y-2 border-t pt-2.5">
                <div>
                  <SettingLabel label="Tool fit template" hint="A filled tool outline without the bin or finger holes. Includes its Trace margin, signed pocket clearance, and outline corner rounding." />
                  <p className="truncate text-xs font-medium" title={selectedShape.name}>{selectedShape.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-20 shrink-0 text-xs">Thickness</Label>
                  <DraftNumberInput
                    className="h-8"
                    value={fitCheckDepthMm}
                    min={0.5}
                    max={30}
                    step={0.5}
                    normalize={(value) => Math.min(30, Math.max(0.5, value))}
                    onValueChange={setFitCheckDepthMm}
                    aria-label="Fit template thickness in millimetres"
                    data-testid="input-fit-check-depth"
                  />
                  <span className="text-xs text-muted-foreground">mm</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={exporting}
                  onClick={() => setPendingExport({
                    title: "Save fit template STL?",
                    description: `Download the filled outline of “${selectedShape.name}” at ${fitCheckDepthMm} mm thick.`,
                    confirmLabel: "Download STL",
                    onConfirm: (includeProject) => onExportFitCheck(selectedCutout.id, fitCheckDepthMm, includeProject),
                  })}
                  data-testid="button-export-fit-check"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {exporting ? "Building…" : "Save fit template STL"}
                </Button>
              </div>
            ) : cutouts.length > 0 ? (
              <p className="border-t pt-2.5 text-[11px] text-muted-foreground">
                Select a tool cutout to export a fit template.
              </p>
            ) : (
              <div
                className="space-y-2 border-t pt-2.5"
                data-testid="export-preview-empty"
              >
                <p className="text-[11px] text-muted-foreground">
                  Add a tool cutout to enable fit templates and shadow-board
                  DXF/SVG files.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate("/")}
                  data-testid="button-go-to-trace"
                >
                  Go to Trace
                </Button>
              </div>
            )}

            {cutouts.length > 0 && (
              <div className="space-y-1.5 border-t pt-2.5">
                <SettingLabel label="Shadow-board layout (top view)" hint="Bin footprint and pocket silhouettes in millimetres, for CNC or laser shadow boards." />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setPendingExport({
                      title: "Save layout DXF?",
                      description: "Download the bin footprint and pocket outlines in millimetres.",
                      confirmLabel: "Download DXF",
                      onConfirm: (includeProject) => onExportLayout("dxf", includeProject),
                    })}
                    data-testid="button-layout-dxf"
                  >
                    Layout DXF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setPendingExport({
                      title: "Save layout SVG?",
                      description: "Download the bin footprint and pocket outlines in millimetres.",
                      confirmLabel: "Download SVG",
                      onConfirm: (includeProject) => onExportLayout("svg", includeProject),
                    })}
                    data-testid="button-layout-svg"
                  >
                    Layout SVG
                  </Button>
                </div>
              </div>
            )}
          </div>
        </PanelSection>

        <PanelSection
          id="bin-settings-export"
          title="Export printable bin"
          icon={Download}
          tone="emerald"
          summary={
            hasErrors
              ? "Needs attention"
              : issues.length > 0
                ? `${issues.length} ${issues.length === 1 ? "warning" : "warnings"}`
              : building
                ? stats
                  ? "Updating"
                  : "Building"
                : cutouts.length === 0 && fingerHoles.length === 0
                  ? "No cutouts"
                : stats
                  ? "Ready"
                  : "No preview"
          }
          defaultOpen={hasErrors}
          className="scroll-mt-16"
        >
          <div className="space-y-1">
            <SettingLabel label="Model validation" hint="Estimate filament weight in your slicer using your infill and wall settings." />
            {stats ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="tabular-nums">
                  {stats.triangles.toLocaleString()} triangles ·{" "}
                  {(stats.volumeMm3 / 1000).toFixed(1)} cm³ model volume
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {building ? "Building preview…" : "No preview yet."}
              </p>
            )}
          </div>
          {cutouts.length === 0 && fingerHoles.length === 0 ? (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100"
              role="status"
              data-testid="export-no-cutouts-warning"
            >
              <p className="font-medium">This bin has no tool cutouts.</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                The final model is a solid bin and may use a large amount of
                material. Add a tool from Trace for a fitted bin, or export only
                if the solid model is intentional.
              </p>
            </div>
          ) : null}

          <div
            className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5"
            data-testid="export-final-model"
          >
            <div>
              <SettingLabel label="Export printable bin" hint="Export the complete bin at print quality. Use 3MF to preserve optional material colors. Select the editable-project checkbox in the export dialog to also save a project JSON with your tools and settings." />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="sm"
                disabled={exporting || hasErrors}
                onClick={() => { setIncludeThreeMfProject(false); setThreeMfDialogOpen(true); }}
                data-testid="button-export-3mf"
              >
                <Box className="mr-1.5 h-4 w-4" />
                {exporting ? "Exporting…" : "Save 3MF"}
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                size="sm"
                disabled={exporting || hasErrors}
                onClick={() => setPendingExport({
                  title: hasSelectedMulticolor ? "STL will not include your colors" : "Save bin STL?",
                  description: hasSelectedMulticolor
                    ? "STL stores geometry only. Use multi-color 3MF to preserve the selected pocket-floor and rim-top materials."
                    : "Download the complete bin at print quality.",
                  confirmLabel: hasSelectedMulticolor ? "Export STL without colors" : "Download STL",
                  onConfirm: (includeProject) => onExport("stl", includeProject),
                })}
                data-testid="button-export-stl"
              >
                Save STL
              </Button>
            </div>
          </div>

        </PanelSection>
      </PanelBody>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "CANCEL_REMOVE_CUTOUT" });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Resize the bin after removing “{pendingRemovalShape?.name ?? "this part"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Pocketry can recenter the remaining layout objects and shrink the
              bin to the smallest Gridfinity size that contains them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-pocket">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              data-testid="button-remove-pocket-only"
              onClick={() => {
                if (pendingRemoval) {
                  dispatch({ type: "REMOVE_CUTOUT", id: pendingRemoval.id });
                }
              }}
            >
              Remove only
            </AlertDialogAction>
            <AlertDialogAction
              data-testid="button-remove-pocket-and-fit"
              onClick={() => {
                if (!pendingRemoval) return;
                fitLayout(
                  cutouts.filter((cutout) => cutout.id !== pendingRemoval.id),
                  "Remove tool pocket and resize bin",
                );
              }}
            >
              Remove &amp; resize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={threeMfDialogOpen} onOpenChange={setThreeMfDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] grid-cols-1 overflow-y-auto sm:max-w-md">
          <DialogHeader className="min-w-0 pr-6 text-left">
            <DialogTitle>Include multiple colors in the 3MF?</DialogTitle>
            <DialogDescription>
              Choose a single printable body or preserve the material colors
              selected in Materials.
            </DialogDescription>
          </DialogHeader>
          {hasFloorMaterialWarning && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100" role="status" data-testid="export-floor-color-warning">
              <p className="font-medium">Floor color may show on the underside.</p>
              <p className="mt-1">Review the warnings on the canvas before exporting multiple colors. A shallower pocket or thinner color layer can keep the color inside the bin.</p>
            </div>
          )}
          <ProjectBackupOption checked={includeThreeMfProject} onChange={setIncludeThreeMfProject} />
          <div className="grid min-w-0 grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="h-auto w-full min-w-0 items-start justify-start whitespace-normal px-3 py-2.5 text-left"
              disabled={exporting || hasErrors}
              onClick={() => {
                setThreeMfDialogOpen(false);
                onExport("3mf", includeThreeMfProject);
              }}
              data-testid="button-export-single-color-3mf"
            >
              <Box className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Single-color 3MF</span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  One body using the selected bin color.
                </span>
              </span>
            </Button>
            <Button
              className="h-auto w-full min-w-0 items-start justify-start whitespace-normal px-3 py-2.5 text-left"
              disabled={exporting || hasErrors || !hasSelectedMulticolor}
              onClick={() => {
                setThreeMfDialogOpen(false);
                onExport("3mf-multicolor", includeThreeMfProject);
              }}
              data-testid="button-export-multicolor-3mf"
            >
              <Palette className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Multi-color 3MF</span>
                <span className="block text-[11px] font-normal opacity-80">
                  {hasSelectedMulticolor
                    ? `Separate ${[
                        hasSelectedFloorColor
                          ? `pocket floors (${pocketFloorThicknessMm} mm down)`
                          : null,
                        hasSelectedRimColor
                          ? `rim top (${stackingRimThicknessMm} mm down)`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" and ")} for slicer assignment.`
                    : "Enable a floor or rim-top color in Materials first."}
                </span>
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setThreeMfDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingExport && (
        <ExportConfirmationDialog
          {...pendingExport}
          onCancel={() => setPendingExport(null)}
          onConfirm={(includeProject) => {
            setPendingExport(null);
            pendingExport.onConfirm(includeProject);
          }}
        />
      )}

    </div>
  );
}

interface ProjectControlsProps {
  saveStatus?: "saving" | "saved" | "error";
  hydrated: boolean;
  libraryReady: boolean;
  busy: boolean;
  activeProjectId: string | null;
  currentProjectName: string | null;
  projects: ProjectLibraryItem[];
  onSaveProject: (name: string) => Promise<boolean>;
  onOpenProject: (projectId: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRefreshProjects: () => void;
  onNewProject: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
}

function ProjectControls({
  hydrated,
  libraryReady,
  busy,
  activeProjectId,
  currentProjectName,
  projects,
  onSaveProject,
  onOpenProject,
  onDeleteProject,
  onRefreshProjects,
  onNewProject,
  onExportProject,
  onImportProject,
  saveStatus = "saved",
}: ProjectControlsProps): JSX.Element {
  const ready = hydrated && libraryReady;
  const [saveOpen, setSaveOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (await onSaveProject(projectName)) setSaveOpen(false);
  };

  return (
    <>
      <div
        className="rounded-md border bg-muted/40 px-3 py-2"
        data-testid="project-autosave-status"
      >
        <div className="flex items-center gap-1">
          <p className="min-w-0 truncate text-xs font-medium">
            {!ready ? "Checking for saved projects…" : (currentProjectName ?? "Untitled project")}
          </p>
          {ready && <HelpHint label="project autosave">{activeProjectId
            ? "Saved automatically in this browser’s Project Library."
            : "This draft resumes automatically; save it to the library to name it."}</HelpHint>}
        </div>
        {saveStatus === "error" && <p className="mt-0.5 text-[11px] text-destructive" role="status">Autosave is unavailable. Download an editable project to keep your work.</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Dialog
          open={saveOpen}
          onOpenChange={(open) => {
            setSaveOpen(open);
            if (open) setProjectName(currentProjectName ?? "");
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || busy}
              data-testid="button-save-library"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {activeProjectId ? "Rename" : "Save to library"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form className="contents" onSubmit={(event) => void handleSave(event)}>
              <DialogHeader>
                <DialogTitle>
                  {activeProjectId ? "Rename project" : "Save project to library"}
                </DialogTitle>
                <DialogDescription>
                  Named projects stay in this browser’s Pocketry library and update
                  automatically as you work.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="project-library-name">Project name</Label>
                <Input
                  id="project-library-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  maxLength={80}
                  autoFocus
                  placeholder="Socket wrench tray"
                  data-testid="input-project-name"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSaveOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || projectName.trim().length === 0}
                  data-testid="button-confirm-save-library"
                >
                  {busy ? "Saving…" : "Save project"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={libraryOpen}
          onOpenChange={(open) => {
            setLibraryOpen(open);
            if (open) onRefreshProjects();
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || busy}
              data-testid="button-open-library"
            >
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Open library
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Project Library</DialogTitle>
              <DialogDescription>
                Choose a named project saved in this browser. Opening it replaces the
                current working draft.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-80 space-y-2 overflow-y-auto" data-testid="project-list">
              {projects.length === 0 ? (
                <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
                  No named projects yet. Save the current draft to add one.
                </div>
              ) : (
                projects.map((project) => {
                  const active = project.id === activeProjectId;
                  return (
                    <div
                      key={project.id}
                      className={cn(
                        "flex items-center gap-3 rounded-md border p-3",
                        active && "border-primary/50 bg-primary/5",
                      )}
                      data-testid={`library-project-${project.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {project.name}
                          {active ? " · Current" : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Updated {formatProjectTime(project.updatedAt)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={active ? "secondary" : "outline"}
                        disabled={busy || active}
                        onClick={async () => {
                          if (await onOpenProject(project.id)) setLibraryOpen(false);
                        }}
                        data-testid={`button-open-project-${project.id}`}
                      >
                        {active ? "Current" : "Open"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={busy}
                            aria-label={`Delete ${project.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the named copy from this browser’s Project
                              Library. If it is open, the current design remains as an
                              unnamed draft.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep project</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => void onDeleteProject(project.id)}
                            >
                              Delete project
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="col-span-2"
              disabled={!ready || busy}
              data-testid="button-new-project"
            >
              <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
              New project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Start a new project?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears the current shapes, pockets, and bin settings. Named
                projects remain in the Project Library; an unnamed draft will be
                replaced.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep current project</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onNewProject}
                data-testid="button-confirm-new-project"
              >
                Start new project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="space-y-1.5 border-t pt-3">
        <SettingLabel label="Portable backup" hint="Editable .pocketry.json files preserve tools and settings. STL and 3MF are for printing." />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-2 text-xs"
            disabled={!ready || busy}
            onClick={onExportProject}
            data-testid="button-export-project"
          >
            Download editable project
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-2 text-xs"
            disabled={!ready || busy}
            onClick={() => importInputRef.current?.click()}
            data-testid="button-import-project"
          >
            Open Pocketry project
          </Button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.pocketry.json,.tooltrace.json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportProject(file);
            event.target.value = "";
          }}
        />
      </div>
    </>
  );
}

function formatProjectTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function CellSlider({
  label,
  cells,
  pitch,
  onChange,
}: {
  label: string;
  cells: number;
  pitch: GridPitch;
  onChange: (cells: number, transient: boolean) => void;
}): JSX.Element {
  const divisor = GRID_PITCH_DIVISOR[pitch];
  const standardCells = standardCellSpan(cells, pitch);
  const step = pitch === "quarter" ? 0.25 : 0.5;
  return (
    <div className="space-y-1.5">
      <SettingLabel label={label} hint={`Standard cells are 42 mm. Outer size includes the 0.5 mm fitting gap. Snaps to ${step * 42} mm grid increments.`} />
      <div className="flex items-center gap-2">
        <Slider
          className="min-w-12 flex-1"
          value={[standardCells]}
          onValueChange={([value]) => onChange(value, true)}
          onValueCommit={([value]) => onChange(value, false)}
          min={step}
          max={Math.max(standardCells, maxGridUi(pitch) / divisor)}
          step={step}
          aria-label={`${label} in standard Gridfinity cells`}
        />
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          <DraftNumberInput className="h-8 w-20" aria-label={`${label} in standard cells`} value={standardCells} min={step} max={MAX_GRID} step={step} normalize={(value) => Math.round(value / step) * step} onValueChange={(value) => onChange(value, true)} onValueCommit={(value) => onChange(value, false)} /> units
        </span>
      </div>
    </div>
  );
}

function MmSlider({
  label,
  value,
  min,
  max,
  step,
  hint,
  hintAsTooltip = true,
  centered = false,
  inline = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: ReactNode;
  hintAsTooltip?: boolean;
  centered?: boolean;
  /** The enclosing section supplies the visible label; show slider and number together. */
  inline?: boolean;
  onChange: (value: number, transient: boolean) => void;
}): JSX.Element {
  const decimalPlaces = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return (
    <div className={cn("space-y-1.5", inline && "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 space-y-0")}>
      <div className={cn("flex items-baseline justify-between gap-2", inline && "col-start-2 row-start-1")}>
        {!inline && <div className="flex items-center gap-1">
          <Label className="text-xs">{label}</Label>
          {hint && hintAsTooltip && <HelpHint label={label.toLowerCase()}>{hint}</HelpHint>}
        </div>}
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          <DraftNumberInput className="inline-block h-8 w-16" aria-label={`${label} in millimetres`} value={value} displayPrecision={2} min={min} max={max} step={step} onValueChange={(next) => onChange(next, true)} onValueCommit={(next) => onChange(next, false)} /> mm
        </span>
      </div>
      <div className={cn("space-y-1.5", inline && "col-start-1 row-start-1 pt-3")}>
        <Slider
          centerOrigin={centered}
          value={[value]}
          onValueChange={([next]) =>
            onChange(Number(next.toFixed(decimalPlaces)), true)
          }
          onValueCommit={([next]) =>
            onChange(Number(next.toFixed(decimalPlaces)), false)
          }
          min={min}
          max={max}
          step={step}
          aria-label={label}
        />
        {centered && <div className="relative flex justify-between text-[10px] tabular-nums text-muted-foreground" aria-hidden="true"><span>{min} · Shrink</span><span className="absolute left-1/2 -translate-x-1/2">0</span><span>Enlarge · +{max}</span></div>}
      </div>
      {hint && !hintAsTooltip && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Field guidance stays beside its label without taking another panel row. */
function SettingLabel({ label, hint, htmlFor, className }: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
}): JSX.Element {
  return <div className={cn("flex min-w-0 items-center gap-1", className)}>
    <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
    {hint && <HelpHint label={label.toLowerCase()}>{hint}</HelpHint>}
  </div>;
}

function FeatureSwitch({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <SettingLabel label={label} hint={disabled ? undefined : description} />
        {disabled && description && <p className="text-[11px] text-muted-foreground">{description}</p>}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}
