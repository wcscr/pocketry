import { createPortal } from "react-dom";
import { useSelectionInspector } from "./selection-inspector-context";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
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
  LibraryBig,
  Link2,
  LoaderCircle,
  Magnet,
  MousePointerClick,
  MoreHorizontal,
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
  Upload,
  X,
} from "lucide-react";
import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDelayedBusy } from "@/hooks/use-delayed-busy";
import { useLocation } from "wouter";
import { LinkedDesignControls } from "./linked-design-controls";
import { AddPocketMenu } from "./add-pocket-menu";
import { BIN_OBJECT_SECTIONS, BIN_WORKFLOW_SECTIONS as BIN_SETTINGS_SECTIONS } from "./bin-workflow";
import { PropertySurface } from "@/components/layout/property-surface";
import { InspectorPanelSections } from "./inspector-panel-sections";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { usePanelState } from "@/components/layout/panel-context";
import { FillHeightControl } from "./fill-height-control";

import {
  DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
  DEFAULT_TOP_EDGE_FILLET_MM,
  defaultPocketFloorThicknessMm,
  defaultFingerAccessDepthMm,
  isElongatedFingerHole,
  effectiveFingerHoleDepthMm,
  effectiveFingerHoleTopFilletMm,
  effectiveFingerHoleBottomFilletMm,
  minimumFingerHoleLengthMm,
  maximumFingerHoleBottomFilletMm,
  maximumFingerHoleCornerRoundMm,
  effectiveFingerHoleCornerRoundMm,
  hasFlatFingerHoleBottom,
  hasFlatFingerHoleEnds,
  fingerAccessOptionsPatch,
  fingerHoleSizeLimits,
  resolvePlacedPocketDepth,
  pocketDepths,
  pocketName,
  type DepthSpec,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import {
  binFootprintMm,
  GRID_PITCH_DIVISOR,
  resizeGridToStandardCellSpan,
  STACKING_LIP_HEIGHT_ACTUAL,
  standardCellSpan,
  type GridPitch,
} from "@shared/gridfinity/standard";
import { MAX_GRID, maxGridCells, type BinSpecInput } from "@shared/gridfinity/types";
import type { ValidationIssue } from "@shared/gridfinity/validate";

import {
  PanelSectionFilterContext,
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
  DialogClose,
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { useToast } from "@/hooks/use-toast";
import { SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM, surfaceFitCheckStyleSchema, type SurfaceFitCheckStyle } from "@shared/gridfinity/fit-check";
import { cn } from "@/lib/utils";
import { PocketSplitControls } from "./pocket-split-controls";
import { changeBinGridPitchPreservingSize } from "@shared/gridfinity/grid-pitch";
import { PocketDepthSummary, PocketMeasurements, PocketSizeInputs, PositionInputs } from "./pocket-measurements";
import { ExportConfirmationDialog, ProjectBackupOption } from "./export-confirmation-dialog";
import { FingerAccessShapeControls } from "./finger-access-shape-controls";
import { INITIAL_BIN_SPEC, useBin } from "@/state/bin-store";
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

function EditableObjectName({ name, kind, onRename, onDone }: {
  name: string;
  kind: "shape" | "finger-hole";
  onRename: (name: string) => void;
  onDone: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(name);
  const commit = () => {
    const trimmedName = draft.trim();
    if (trimmedName.length > 0 && trimmedName !== name) onRename(trimmedName);
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
      className={cn("min-w-0 flex-1 text-xs font-medium", kind === "finger-hole" ? "h-11" : "h-8")}
      aria-label={kind === "shape" ? "Pocket name" : "Finger access name"}
      data-testid={`input-${kind}-name`}
    />
  );
}

export interface BinControlsPanelProps {
  issues: readonly ValidationIssue[];
  /** A fresh request reveals settings after the controls drawer mounts. */
  settingsSectionRequest?: { id: string; focusId?: string };
  exportOnly?: boolean;
  /** Changes when the canvas explicitly requests the selected pocket editor. */
  pocketEditorRequest?: number;
  keepBinSize?: boolean;
  onKeepBinSizeChange?: (fixed: boolean) => void;
  saveStatus?: "saving" | "saved" | "error";
  stats: BuildBinStats | null;
  statsAreStale?: boolean;
  building: boolean;
  previewIsDraft?: boolean;
  exporting: boolean;
  onExport: (format: "3mf" | "3mf-multicolor" | "stl", includeProject: boolean) => void;
  onExportFitCheck: (cutoutId: string, depthMm: number, includeProject: boolean) => void;
  onExportSurfaceFitCheck: (thicknessMm: number, includeProject: boolean, style: SurfaceFitCheckStyle) => void;
  onExportLayout: (format: "dxf" | "svg", includeProject: boolean) => void;
  onAutoArrange: () => void;
  onExportProject: () => void;
  onImportProject: (doc: ProjectDoc) => Promise<boolean>;
  projectLibraryReady: boolean;
  projectBusy: boolean;
  activeProjectId: string | null;
  currentProjectName: string | null;
  projects: ProjectLibraryItem[];
  onSaveProject: (name: string) => Promise<boolean>;
  onRenameProject: (projectId: string, name: string) => Promise<boolean>;
  onDuplicateProject: (projectId: string) => Promise<string | null>;
  onOpenProject: (projectId: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRefreshProjects: () => void;
  onExportLibrary: () => void;
  onImportLibrary: (file: File) => void;
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
  exportOnly = false,
  stats,
  statsAreStale = false,
  building,
  previewIsDraft = false,
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
  onRenameProject,
  onDuplicateProject,
  onOpenProject,
  onDeleteProject,
  onRefreshProjects,
  onExportLibrary,
  onImportLibrary,
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
  const showPreviewBusy = useDelayedBusy(building);
  const inspector = useSelectionInspector();
  const { enabled: experimentalPreference, setSettingsOpen } = useExperimentalFeatures();
  const experimentalEnabled = experimentalPreference || !!inspector;
  const {
    spec,
    cutouts,
    fingerHoles,
    selection,
    selectedCutoutId,
    selectedPocketSection,
    selectedFingerHoleId,
    pendingRemovalId,
    editorMode,
    hydrated,
    history,
    dispatch,
  } = useBin();
  const [, navigate] = useLocation();
  const { shapes } = useShapeLibrary();
  const [renamingFingerId, setRenamingFingerId] = useState<string | null>(null);
  const [renamingPocketId, setRenamingPocketId] = useState<string | null>(null);
  useEffect(() => {
    if (inspector || !selectedCutoutId || renamingPocketId === selectedCutoutId) return;
    // Selection brings the fixed Pockets section into view. Re-selecting the
    // same canvas pocket increments the request so it is reachable from any section.
    revealPanelSection("bin-settings-pockets", BIN_SETTINGS_SECTIONS, "pocket-properties");
  }, [selectedCutoutId, pocketEditorRequest, renamingPocketId]);
  const shapesById = useMemo(
    () => new Map(shapes.map((shape) => [shape.id, shape])),
    [shapes],
  );

  const dims = useMemo(() => binDimensionsMm(spec), [spec]);
  const exportDimensions = `Outer size: ${dims.widthMm.toFixed(1)} × ${dims.lengthMm.toFixed(1)} × ${dims.totalHeightMm.toFixed(1)} mm (width × length × height).`;
  const widthCellSpan = standardCellSpan(spec.gridX, spec.gridPitch);
  const lengthCellSpan = standardCellSpan(spec.gridY, spec.gridPitch);
  const hasFloorMaterialWarning = issues.some((issue) => issue.code === "floor-color-on-underside");
  useEffect(() => {
    if (!settingsSectionRequest) return;
    const { id, focusId } = settingsSectionRequest;
    inspector?.showSection(id);
    if (!inspector) revealPanelSection(id, BIN_SETTINGS_SECTIONS, focusId);
    if (!inspector && !focusId) return;
    // Wait for the section and mobile drawer to mount before moving keyboard focus.
    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (inspector) revealPanelSection(id, BIN_SETTINGS_SECTIONS, focusId);
        if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
      });
    });
    return () => window.cancelAnimationFrame(frame);
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
  const [surfaceFitCheckStyle, setSurfaceFitCheckStyle] = useState<SurfaceFitCheckStyle>("outline");
  const [threeMfDialogOpen, setThreeMfDialogOpen] = useState(false);
  const [projectNameOpen, setProjectNameOpen] = useState(false);
  const threeMfTitleRef = useRef<HTMLHeadingElement>(null);
  const [includeThreeMfProject, setIncludeThreeMfProject] = useState(false);
  const [pendingExport, setPendingExport] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: (includeProject: boolean) => void;
  } | null>(null);
  const hasBlindPocket = cutouts.some(
    (cutout) => pocketDepths(cutout).some(depth => depth.mode !== "through"),
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
  const fingerSizeLimits = selectedFingerHole ? fingerHoleSizeLimits(selectedFingerHole, spec) : null;
  const depthCutout = selectedCutout && selectedCutout.split
    ? { ...selectedCutout, depth: selectedCutout.split.depths[selectedPocketSection] }
    : selectedCutout;
  const updatePocketDepth = (depth: DepthSpec, transient = false) => {
    if (!selectedCutout) return;
    const depths = selectedCutout.split ? [...selectedCutout.split.depths] as [DepthSpec, DepthSpec] : null;
    if (depths) depths[selectedPocketSection] = depth;
    dispatch({ type: "UPDATE_CUTOUT", id: selectedCutout.id,
      patch: selectedCutout.split && depths ? { split: { ...selectedCutout.split, depths } } : { depth },
      transient, historyLabel: selectedCutout.split ? "Change section depth" : "Change pocket depth" });
  };
  const selectedShape = selectedCutout
    ? (shapesById.get(selectedCutout.shapeId) ?? null)
    : null;
  const depthShape = useMemo(() => {
    if (!selectedShape || !selectedCutout?.split) return selectedShape;
    const split = resolvePocketSplit(selectedShape.outlineMm, selectedCutout.split.boundary);
    return split.regions ? { ...selectedShape, outlineMm: split.regions[selectedPocketSection] } : selectedShape;
  }, [selectedShape, selectedCutout?.split, selectedPocketSection]);

  const setPocketScale = (axis: "x" | "y", percent: number) => {
    if (!selectedCutout) return;
    const requested = Math.min(20, Math.max(0.05, percent / 100));
    const changedScale = axis === "x" ? selectedCutout.scaleX : selectedCutout.scaleY;
    // The number field also commits on blur. Drawing and linked scaling can
    // leave sub-picometre rounding differences; these are not another edit.
    if (Math.abs(requested - changedScale) < 1e-12) return;
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

  const pocketList = cutouts.length > 0 && (
            <div className="space-y-1" aria-label="Choose a pocket to edit">
              {cutouts.map((cutout) => {
                const shape = shapesById.get(cutout.shapeId);
                const name = pocketName(cutout, shape);
                const isSelected = selection.some(ref => ref.kind === "pocket" && ref.id === cutout.id);
                return (
                  <div key={cutout.id} data-testid={`cutout-row-${cutout.id}`} className={cn(
                    "flex items-center rounded-md border text-xs",
                    isSelected ? "border-violet-500/50 bg-violet-500/10" : "border-transparent hover:bg-accent",
                  )}>
                    {experimentalEnabled && <label className="ml-1 flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Include ${name} in selection`} checked={isSelected}
                      onChange={() => { inspector?.keepObjectsOpen(); dispatch({ type: "SELECT_CUTOUT", id: cutout.id, additive: true }); }} /></label>}
                    {renamingPocketId === cutout.id && shape ? (
                      <EditableObjectName key={cutout.id} name={name} kind="shape" onRename={(name) => dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { name }, historyLabel: "Rename pocket" })} onDone={() => setRenamingPocketId(null)} />
                    ) : (
                    <button
                      type="button"
                      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"
                      aria-label={`${name} — edit pocket properties`}
                      aria-pressed={isSelected}
                      aria-controls="pocket-properties"
                      data-testid={`button-select-${cutout.id}`}
                      onClick={event => {
                        dispatch({ type: "SELECT_CUTOUT", id: cutout.id, additive: experimentalEnabled && (event.shiftKey || event.metaKey || event.ctrlKey) });
                        if (event.shiftKey || event.metaKey || event.ctrlKey) inspector?.keepObjectsOpen();
                        else inspector?.setTool("properties");
                        if (isSelected && !inspector) revealPanelSection("bin-settings-pockets", BIN_SETTINGS_SECTIONS, "pocket-properties");
                      }}
                    >
                      <span className={cn("min-w-0 flex-1 truncate", isSelected && "font-medium text-violet-700 dark:text-violet-300")}>{name}</span>
                      {experimentalEnabled && cutout.designLink && <Link2 className="h-3 w-3 shrink-0" aria-label="Linked design" />}
                    </button>
                    )}
                    <ObjectActions name={name}>
                    <button type="button" className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Rename ${name}`} disabled={!shape} data-testid={`button-rename-${cutout.id}`} onClick={() => {
                      if (!inspector) dispatch({ type: "SELECT_CUTOUT", id: cutout.id });
                      setRenamingPocketId(cutout.id);
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Duplicate ${name}`} data-testid={`button-duplicate-${cutout.id}`} onClick={() => dispatch({ type: "DUPLICATE_CUTOUT", id: cutout.id, newId: crypto.randomUUID() })}>
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Remove ${name}`} data-testid={`button-remove-${cutout.id}`} onClick={() => dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: cutout.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    </ObjectActions>
                  </div>
                );
              })}
            </div>
          );
  const fingerList = fingerHoles.length > 0 && (
              <div className="space-y-1" aria-label="Choose finger access to edit">
                {fingerHoles.map((hole, index) => {
                  const isSelected = selection.some(ref => ref.kind === "finger" && ref.id === hole.id);
                  const name = hole.name ?? `Finger access ${index + 1}`;
                  return (
                    <div key={hole.id} data-testid={`finger-hole-row-${hole.id}`} className={cn(
                      "flex items-center rounded-md border text-xs",
                      isSelected ? "border-cyan-500/50 bg-cyan-500/10" : "border-transparent hover:bg-accent",
                    )}>
                      {experimentalEnabled && <label className="ml-1 flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Include ${name} in selection`} checked={isSelected}
                        onChange={() => { inspector?.keepObjectsOpen(); dispatch({ type: "SELECT_FINGER_HOLE", id: hole.id, additive: true }); }} /></label>}
                      {renamingFingerId === hole.id ? (
                        <EditableObjectName key={hole.id} name={name} kind="finger-hole"
                          onRename={(name) => dispatch({ type: "UPDATE_FINGER_HOLE", id: hole.id, patch: { name }, historyLabel: "Rename finger access" })}
                          onDone={() => setRenamingFingerId(null)} />
                      ) : (
                        <button type="button"
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${name} — edit finger access properties`} aria-pressed={isSelected} aria-controls="finger-access-properties"
                          data-testid={`button-select-finger-hole-${hole.id}`}
                          onClick={event => { dispatch({ type: "SELECT_FINGER_HOLE", id: hole.id, additive: experimentalEnabled && (event.shiftKey || event.metaKey || event.ctrlKey) }); if (event.shiftKey || event.metaKey || event.ctrlKey) inspector?.keepObjectsOpen(); else inspector?.setTool("properties"); }}>
                          <span className={cn("min-w-0 flex-1 truncate", isSelected && "font-medium text-cyan-700 dark:text-cyan-300")}>{name}</span>
                          {experimentalEnabled && hole.designLink && <Link2 className="h-3 w-3 shrink-0" aria-label="Linked design" />}
                        </button>
                      )}
                      <ObjectActions name={name}>
                      <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Rename ${name}`} data-testid={`button-rename-finger-hole-${hole.id}`}
                        title={`Rename ${name}`}
                        onClick={() => { if (!inspector) dispatch({ type: "SELECT_FINGER_HOLE", id: hole.id }); setRenamingFingerId(hole.id); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={`Remove ${name}`}
                        aria-label={`Remove ${name}`} onClick={() => dispatch({ type: "REMOVE_FINGER_HOLE", id: hole.id })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      </ObjectActions>
                    </div>
                  );
                })}
              </div>
            );
  const pocketTopRounding = selectedCutout && (
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
  );
  const pocketClearance = selectedCutout && selectedShape && (
              <details className="group/clearance border-t pt-1 text-xs" data-testid="pocket-clearance-settings">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1">Extra pocket clearance
                    <HelpHint label="extra pocket clearance">
                      Adjusts each edge after scaling. Negative values shrink the pocket; positive values enlarge it. Zero keeps the original outline size. Narrow features can disappear when shrunk.
                      <span className="mt-1 block">{selectedShape.source === "basic-shape"
                        ? `Drawn in millimetres. Extra allowance: ${selectedCutout.clearanceMm.toFixed(2)} mm per edge.`
                        : selectedShape.traceMarginMm === undefined
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
  );
  const pocketProperties = selectedCutout && selectedShape && (
            <PropertySurface tone="violet" id="pocket-properties" role="region" aria-label="Selected pocket properties">
              <div className="property-heading -mx-3 -mt-3 flex min-w-0 flex-wrap items-center gap-2 rounded-t-lg border-b px-3 py-2" data-testid="pocket-properties-heading">
                <h3 className="text-xs font-semibold">Pocket properties</h3>
                <span className={inspector ? "sr-only" : "min-w-0 flex-1 truncate text-xs"} title={pocketName(selectedCutout, selectedShape)}>{pocketName(selectedCutout, selectedShape)}</span>
                <Button
                  variant={editorMode === "contour" ? "default" : "outline"}
                  size="sm"
                  className="ml-auto h-9 shrink-0 gap-1 px-2 text-xs"
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


              {!inspector && experimentalEnabled && <LinkedDesignControls kind="pocket" activeId={selectedCutout.id} labels={new Map(cutouts.map(c => [c.id, pocketName(c, shapesById.get(c.shapeId))]))} />}
              <section className="space-y-2" aria-label="Pocket depth" key={`${selectedCutout.id}-${selectedPocketSection}-${!!selectedCutout.split}`}>
                <div className="flex items-center gap-1">
                  <h4 className="text-sm font-semibold">Depth</h4>
                  {selectedCutout.split && <span className="ml-auto text-xs text-muted-foreground">Section {selectedPocketSection === 0 ? "A" : "B"}</span>}
                  {spec.flatBottom && depthCutout!.depth.mode === "remaining" && <HelpHint label="remaining floor thickness">Measured from the flat underside. A 2 mm floor lets pockets extend into the former base area.</HelpHint>}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={depthCutout!.depth.mode}
                    onValueChange={(mode) => {
                      const resolved = resolvePlacedPocketDepth(spec, depthCutout!.depth, depthShape!, depthCutout!);
                      const depth =
                        mode === "through"
                          ? ({ mode: "through" } as const)
                          : mode === "mm"
                            ? ({ mode: "mm", value: Math.max(0.1, resolved.axialDepthMm ?? resolved.infillTopZ - defaultPocketFloorThicknessMm(spec)) } as const)
                            : ({ mode: "remaining", floorThicknessMm: spec.flatBottom ? defaultPocketFloorThicknessMm(spec) : Math.max(0, resolved.floorZ ?? defaultPocketFloorThicknessMm(spec)) } as const);
                      updatePocketDepth(depth);
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
                  {depthCutout!.depth.mode === "mm" && (
                    <DraftNumberInput
                      className="h-9 w-20 text-base font-semibold"
                      aria-label="Pocket cut depth in millimetres"
                      value={depthCutout!.depth.value}
                      min={1}
                      step={1}
                      onValueChange={(value) =>
                        updatePocketDepth({ mode: "mm", value })
                      }
                    />
                  )}
                </div>

                {depthCutout!.depth.mode === "remaining" && <MmSlider label="Remaining floor thickness" value={depthCutout!.depth.floorThicknessMm} min={0} max={Math.max(7, spec.heightUnits * 7)} step={0.5}
                  onChange={(floorThicknessMm, transient) => updatePocketDepth({ mode: "remaining", floorThicknessMm }, transient)} />}

                <PocketDepthSummary cutout={depthCutout!} shape={depthShape!} section={section} inspect={onSectionChange} />
              </section>
              <PocketSplitControls cutout={selectedCutout} />
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
                  {pocketTopRounding}
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

              {editorMode === "contour" && (
                <p className="rounded-md bg-violet-500/10 px-2.5 py-2 text-[11px] text-violet-800 dark:text-violet-200">
                  Drag points to reshape. Click near an edge to add a point; right-click a
                  point to remove it.
                </p>
              )}

              {inspector && experimentalEnabled && <AdvancedLinks><LinkedDesignControls kind="pocket" activeId={selectedCutout.id} labels={new Map(cutouts.map(c => [c.id, pocketName(c, shapesById.get(c.shapeId))]))} /></AdvancedLinks>}
              {pocketClearance}
            </PropertySurface>
          );
  const fingerProperties = selectedFingerHole && fingerSizeLimits && (
              <PropertySurface tone="cyan" id="finger-access-properties" role="region" aria-label="Selected finger access properties">
                <div className="property-heading -mx-3 -mt-3 flex min-w-0 flex-wrap items-center gap-2 rounded-t-lg border-b px-3 py-2" data-testid="finger-access-properties-heading">
                  <h3 className="text-xs font-semibold">Finger access properties</h3>
                  <span className={inspector ? "sr-only" : "min-w-0 flex-1 truncate text-xs"}>{selectedFingerHole.name ?? `Finger access ${fingerHoles.indexOf(selectedFingerHole) + 1}`}</span>
                </div>
              {!inspector && experimentalEnabled && <LinkedDesignControls kind="finger" activeId={selectedFingerHole.id} labels={new Map(fingerHoles.map((h, i) => [h.id, h.name ?? `Finger access ${i + 1}`]))} />}


                <FingerAccessShapeControls
                  hole={selectedFingerHole}
                  onChange={(change) => {
                    dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: fingerAccessOptionsPatch(selectedFingerHole, change),
                      historyLabel: "Change finger access shape",
                    });
                  }}
                />
                {(effectiveFingerHoleDepthMm(selectedFingerHole) > fingerSizeLimits.depthMm ||
                  selectedFingerHole.diameterMm > fingerSizeLimits.diameterMm ||
                  (isElongatedFingerHole(selectedFingerHole) && Math.max(selectedFingerHole.lengthMm ?? DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
                    minimumFingerHoleLengthMm(selectedFingerHole)) > fingerSizeLimits.lengthMm)) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300" role="status">Opening exceeds this bin's size limits.</p>
                )}

                <section className="space-y-2" aria-label="Finger access depth">
                  <MmSlider
                    label="Depth"
                    hint="New access starts 1 mm above the highest pocket floor, including split sections. Without a pocket floor, it starts at 12 mm. Depth is limited to 1 mm minimum and the bin height."
                    value={effectiveFingerHoleDepthMm(selectedFingerHole)}
                    min={1}
                    max={fingerSizeLimits.depthMm}
                    step={0.5}
                    onChange={(depthMm, transient) =>
                      dispatch({
                        type: "UPDATE_FINGER_HOLE",
                        id: selectedFingerHole.id,
                        patch: { depthMm, kind: selectedFingerHole.kind === "scoop" ? "deep-scoop" : selectedFingerHole.kind },
                        historyLabel: "Change finger access depth",
                        transient,
                      })
                    }
                  />

                </section>
                <details open={!!inspector || undefined} className="group/size border-t pt-1 text-xs" data-testid="finger-size-settings">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 font-medium [&::-webkit-details-marker]:hidden">
                    Size
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/size:rotate-180" />
                  </summary>
                  <div className="space-y-3 pb-2 pt-2" key={selectedFingerHole.id}>
                <MmSlider
                  label={isElongatedFingerHole(selectedFingerHole) ? "Width" : "Diameter"}
                  value={selectedFingerHole.diameterMm}
                  min={6}
                  max={fingerSizeLimits.diameterMm}
                  step={1}
                  onChange={(diameterMm, transient) =>
                    dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: {
                        diameterMm,
                        depthMm: effectiveFingerHoleDepthMm(selectedFingerHole),
                        kind: selectedFingerHole.kind === "scoop" ? "deep-scoop" : selectedFingerHole.kind,
                      },
                      historyLabel: "Resize finger access",
                      transient,
                    })
                  }
                  hint="Opening size before top-edge rounding. Curved bottoms become narrower below the opening."
                />

                {isElongatedFingerHole(selectedFingerHole) && (
                  <div className="space-y-2">
                    <MmSlider
                      label="Length"
                      value={Math.max(
                        selectedFingerHole.lengthMm ??
                          DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
                        minimumFingerHoleLengthMm(selectedFingerHole),
                      )}
                      min={Math.min(minimumFingerHoleLengthMm(selectedFingerHole), fingerSizeLimits.lengthMm)}
                      max={fingerSizeLimits.lengthMm}
                      step={1}
                      onChange={(lengthMm, transient) =>
                        dispatch({
                          type: "UPDATE_FINGER_HOLE",
                          id: selectedFingerHole.id,
                          patch: { lengthMm },
                          historyLabel: "Resize elongated finger access",
                          transient,
                        })
                      }
                    />
                    {(selectedFingerHole.lengthMm ?? DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM) < minimumFingerHoleLengthMm(selectedFingerHole) && (
                      <p className="text-xs text-muted-foreground" role="status">
                        Requested {selectedFingerHole.lengthMm ?? DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM} mm; increased to fit rounded ends.
                      </p>
                    )}
                  </div>
                )}


                  </div>
                </details>
                <details className="group/edge border-t pt-1 text-xs" data-testid="finger-edge-settings">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 font-medium [&::-webkit-details-marker]:hidden">
                    Edges &amp; corners
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/edge:rotate-180" />
                  </summary>
                  <div className="space-y-3 pb-2 pt-2" key={selectedFingerHole.id}>
                {hasFlatFingerHoleEnds(selectedFingerHole) && (
                  <>
                  <MmSlider
                    label="Corner round"
                    value={effectiveFingerHoleCornerRoundMm(selectedFingerHole)}
                    min={0}
                    max={maximumFingerHoleCornerRoundMm(selectedFingerHole)}
                    step={0.1}
                    onChange={(cornerRoundMm, transient) => dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: { cornerRoundMm },
                      historyLabel: "Change finger access corner round",
                      transient,
                    })}
                    hint="Rounds the four corners in the top view, inside the slot's width and length."
                  />
                  {(selectedFingerHole.cornerRoundMm ?? 0) > effectiveFingerHoleCornerRoundMm(selectedFingerHole) && (
                    <p className="text-xs text-muted-foreground" role="status">
                      Requested {selectedFingerHole.cornerRoundMm} mm; limited by width or length.
                    </p>
                  )}
                  </>
                )}
                <MmSlider
                  label="Top edge round"
                  value={effectiveFingerHoleTopFilletMm(selectedFingerHole)}
                  min={0}
                  max={Math.min(5, effectiveFingerHoleDepthMm(selectedFingerHole) / 2)}
                  step={0.1}
                  onChange={(topFilletMm, transient) =>
                    dispatch({
                      type: "UPDATE_FINGER_HOLE",
                      id: selectedFingerHole.id,
                      patch: { topFilletMm },
                      historyLabel: "Change finger access top edge round",
                      transient,
                    })
                  }
                  hint="Rounds the opening into the bin's top surface."
                />
                {selectedFingerHole.topFilletMm > effectiveFingerHoleTopFilletMm(selectedFingerHole) && (
                  <p className="text-xs text-muted-foreground" role="status">
                    Requested {selectedFingerHole.topFilletMm} mm; limited by depth.
                  </p>
                )}

                {hasFlatFingerHoleBottom(selectedFingerHole) && (
                  <>
                  <MmSlider
                    label="Bottom edge round"
                    value={effectiveFingerHoleBottomFilletMm(selectedFingerHole)}
                    min={0}
                    max={maximumFingerHoleBottomFilletMm(selectedFingerHole)}
                    step={0.1}
                    onChange={(bottomFilletMm, transient) =>
                      dispatch({
                        type: "UPDATE_FINGER_HOLE",
                        id: selectedFingerHole.id,
                        patch: { bottomFilletMm },
                        historyLabel: "Change finger access bottom fillet",
                        transient,
                      })
                    }
                    hint="Rounds the straight wall into its flat floor."
                  />
                  {selectedFingerHole.bottomFilletMm > effectiveFingerHoleBottomFilletMm(selectedFingerHole) && (
                    <p className="text-xs text-muted-foreground" role="status">
                      Requested {selectedFingerHole.bottomFilletMm} mm; limited by depth or opening size.
                    </p>
                  )}
                  </>
                )}

                  </div>
                </details>
                <details className="group/position border-t pt-1 text-xs" data-testid="finger-position-settings">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 font-medium [&::-webkit-details-marker]:hidden">
                    Position &amp; rotation
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/position:rotate-180" />
                  </summary>
                  <div className="space-y-3 pb-2 pt-2" key={selectedFingerHole.id}>
                {isElongatedFingerHole(selectedFingerHole) && (
                    <div className="flex items-center gap-1.5">
                      <Label className="w-16 shrink-0 text-xs">Rotation</Label>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        aria-label="Rotate elongated finger access 90 degrees counterclockwise"
                        title="Rotate counterclockwise"
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
                            historyLabel: "Rotate elongated finger access",
                          })
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        aria-label="Rotate elongated finger access 90 degrees clockwise"
                        title="Rotate clockwise"
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
                            historyLabel: "Rotate elongated finger access",
                          })
                        }
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                      <DraftNumberInput
                        className="h-8 min-w-0"
                        aria-label="Elongated finger access rotation"
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
                            historyLabel: "Rotate elongated finger access",
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground">°</span>
                    </div>
                )}
                <PositionInputs position={selectedFingerHole.center} onChange={(center, transient) => dispatch({ type: "UPDATE_FINGER_HOLE", id: selectedFingerHole.id, patch: { center }, transient, historyLabel: "Position finger access" })} />
                  </div>
                </details>
                {inspector && experimentalEnabled && <AdvancedLinks><LinkedDesignControls kind="finger" activeId={selectedFingerHole.id} labels={new Map(fingerHoles.map((h, i) => [h.id, h.name ?? `Finger access ${i + 1}`]))} /></AdvancedLinks>}
            </PropertySurface>
            );

  const projectStatus = (
      <div className={!inspector && exportOnly ? "hidden" : cn("min-w-0 px-3 py-2", !inspector && "shrink-0 border-b", inspector && "flex-1")} data-testid="project-status">
        <p className="cursor-text truncate text-sm font-medium" data-testid="project-status-title"
          title={`${currentProjectName ?? "Untitled project"} — double-click to rename`}
          onDoubleClick={() => {
            if (!hydrated || !projectLibraryReady || projectBusy) return;
            if (inspector) inspector.showSection("bin-settings-project");
            else revealPanelSection("bin-settings-project", BIN_SETTINGS_SECTIONS);
            setProjectNameOpen(true);
          }}>{currentProjectName ?? "Untitled project"}</p>
        <p className="text-[11px] text-muted-foreground" role="status">{!hydrated ? "Opening project…" : projectBusy ? "Working…" : saveStatus === "saving" ? activeProjectId ? "Saving to browser library…" : "Draft — saving locally…" : saveStatus === "error" ? "Could not save. Export this project to keep your work." : activeProjectId ? "Saved to browser library" : "Draft — autosaved locally"}</p>
      </div>
  );

  return (
    <PanelSectionFilterContext.Provider value={!inspector && exportOnly ? "bin-settings-export" : null}>
    <div className="flex h-full flex-col">
      {!experimentalEnabled && (cutouts.some(c => c.designLink || hasPocketTilt(c)) || fingerHoles.some(h => h.designLink)) && <div className="shrink-0 border-b bg-amber-50/60 px-3 py-2 text-xs dark:bg-amber-950/20" data-testid="experimental-design-notice">
        <p>This project uses experimental pocket tools. Its geometry and links are preserved; edits to linked designs still update their copies.</p>
        <Button size="sm" variant="link" className="h-9 px-0 text-xs" onClick={() => setSettingsOpen(true)}>Show experimental settings</Button>
      </div>}
      {inspector ? <div className="shrink-0 border-b px-3 pb-2 pt-4">
        <h2 className="mb-3 text-xs font-semibold">{inspector.workflow ? "Design workflow" : "Objects"}</h2>
        {!inspector.workflow && <Button variant={selection.length ? "ghost" : "secondary"} className="h-10 w-full justify-start gap-2" aria-label="Bin — edit size and construction" aria-pressed={!selection.length}
          onClick={() => inspector.showSection("bin-settings-size")}><Box className="h-4 w-4" />Bin<span className="ml-auto text-xs font-normal text-muted-foreground">{formatUnitCount(widthCellSpan)} × {formatUnitCount(lengthCellSpan)}</span></Button>}
        <div className="mt-1 flex items-center justify-between text-xs">
          <Button size="sm" variant="ghost" className="px-2 text-xs" disabled={!cutouts.length && !fingerHoles.length} onClick={() => dispatch({ type: "SET_SELECTION", selection: [...cutouts.map(c => ({ kind: "pocket" as const, id: c.id })), ...fingerHoles.map(h => ({ kind: "finger" as const, id: h.id }))] })}>Select all</Button>
          <Button size="sm" variant="ghost" className="px-2 text-xs" disabled={!selection.length} aria-label="Clear object selection" onClick={() => { dispatch({ type: "SET_SELECTION", selection: [] }); inspector.showSection("bin-settings-size"); }}>Clear</Button>
        </div>
      </div> : projectStatus}
      {/* On short screens the section headers remain reachable by scrolling;
          reserve the limited height for editable fields instead of shortcuts. */}
      <div className={(inspector ? !inspector.workflow : exportOnly) ? "hidden" : "shrink-0 [@media(max-height:500px)]:hidden"}>
        <PanelSettingsIndex
          ariaLabel="Find bin settings"
          testIdPrefix="bin"
          items={BIN_SETTINGS_SECTIONS}
          activeSectionId={inspector?.workflow ? inspector.activeSection : undefined}
          onNavigate={inspector?.workflow ? id => {
            if (BIN_OBJECT_SECTIONS.has(id)) revealPanelSection(id, BIN_SETTINGS_SECTIONS);
            inspector.showSection(id);
          } : undefined}
        />
      </div>
      <InspectorPanelSections>
        <PanelSection
          id="bin-settings-project"
          title="Project"
          icon={FolderOpen}
          tone="slate"
          summary={projectBusy ? "Working…" : activeProjectId ? "Library" : "Draft"}
          defaultOpen={!!inspector}
          className="scroll-mt-16"
        >
          <ProjectControls
            saveOpen={projectNameOpen}
            setSaveOpen={setProjectNameOpen}
            hydrated={hydrated}
            libraryReady={projectLibraryReady}
            busy={projectBusy}
            saveStatus={saveStatus}
            activeProjectId={activeProjectId}
            hasDraftWork={!!currentProjectName || keepBinSize || shapes.length > 0 || cutouts.length > 0
              || fingerHoles.length > 0 || history.stack.length > 1
              || JSON.stringify(spec) !== JSON.stringify(INITIAL_BIN_SPEC)}
            currentProjectName={currentProjectName}
            projects={projects}
            onSaveProject={onSaveProject}
            onRenameProject={onRenameProject}
            onDuplicateProject={onDuplicateProject}
            onOpenProject={onOpenProject}
            onDeleteProject={onDeleteProject}
            onRefreshProjects={onRefreshProjects}
            onExportLibrary={onExportLibrary}
            onImportLibrary={onImportLibrary}
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
            <SettingLabel label="Grid pitch" hint="Pitch changes preserve the outer size and custom shape. A coarser pitch is available only when existing cells combine into whole cells." className="shrink-0" />
            <Select
              value={spec.gridPitch}
              onValueChange={(value) => {
                const gridPitch = value as GridPitch;
                const resized = changeBinGridPitchPreservingSize(spec, gridPitch);
                if (!resized || resized.gridX > maxGridCells(gridPitch) || resized.gridY > maxGridCells(gridPitch)) return;
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
                  const resized = changeBinGridPitchPreservingSize(spec, pitch);
                  const available = resized && resized.gridX <= maxGridCells(pitch) && resized.gridY <= maxGridCells(pitch);
                  return <SelectItem key={pitch} value={pitch} disabled={!available}>{pitch === "full" ? "Full · 42 mm" : pitch === "half" ? "Half · 21 mm" : "Quarter · 10.5 mm"}{!available ? " (would change shape)" : ""}</SelectItem>;
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
          {showPreviewBusy && (
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
          {spec.fill === "solid" && (
            <FillHeightControl
              value={spec.fillHeightPercent}
              onChange={(fillHeightPercent, transient) => patchSpec({ fillHeightPercent }, transient)}
            />
          )}
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
          defaultOpen={!!inspector || cutouts.length > 0}
          className="scroll-mt-16"
        >
          <div className="mb-2"><AddPocketMenu /></div>
          {pocketList}
          {!inspector && !selectedCutout && (
            <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground" id="pocket-properties" data-testid="pocket-selection-help">
              {cutouts.length === 0
                ? "Choose Add simple pocket to draw a basic shape, or trace a tool and press “Add to bin”."
                : "Select a pocket on the canvas or in the list above. Its properties appear here."}
            </p>
          )}
          {!inspector && pocketProperties}

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
          hint="Allow room beside the tool at the depth where you will grip it. Wider slots can accommodate more fingers or gloves. Check the fit with the actual tool and hand before printing the full bin."
          icon={CircleDot}
          tone="cyan"
          summary={<span>{fingerHoles.length}<span className="sr-only"> feature{fingerHoles.length === 1 ? "" : "s"}</span></span>}
          defaultOpen={!!inspector || fingerHoles.length > 0}
          className="scroll-mt-16"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">Openings</span>
              <Button
                variant="outline"
                size="sm"
                className="h-11 shrink-0 px-2 text-xs"
                data-testid="button-add-finger-hole"
                onClick={() =>
                  dispatch({
                    type: "ADD_FINGER_HOLE",
                    hole: {
                      id: crypto.randomUUID(),
                      center: { x: 0, y: 0 },
                      diameterMm: 18,
                      kind: "oblong-deep-scoop",
                      slotEnds: "rounded",
                      lengthMm: DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
                      depthMm: defaultFingerAccessDepthMm(spec, cutouts),
                      topFilletMm: DEFAULT_TOP_EDGE_FILLET_MM,
                      bottomFilletMm: 0,
                    },
                  })
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>

            {fingerList}

            {!inspector && fingerProperties}
          </div>
        </PanelSection>

        <PanelSection
          id="bin-settings-materials"
          title="Materials & Colors"
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
        <PanelSection id="bin-settings-fit" title="Check fit" icon={ClipboardCheck} tone="emerald" defaultOpen={!!inspector || section !== null} summary={section ? "Cut open" : "Inspect & test"}>
          <details className="group/section rounded-lg border px-3" data-testid="cross-section-settings">
            <summary className="flex cursor-pointer items-center justify-between gap-2 py-2 text-xs font-semibold">
              <span className="flex items-center gap-2"><Eye className="h-4 w-4 shrink-0" /><span>Inspect inside<span className="block text-[10px] font-normal text-muted-foreground">Cross-section view · {section ? "Cut open" : "Whole bin"}</span></span></span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/section:rotate-180" />
            </summary>
            <div className="space-y-3 border-t pb-3 pt-2">
              <FeatureSwitch
                label="Cut the preview open"
                description="Slice the 3D view to inspect pockets. These controls only change the preview; exports always contain the complete bin."
                checked={section !== null}
                onChange={(on) => {
                  onSectionChange(on ? { axis: "x", offsetMm: 0 } : null);
                  if (on) dispatch({ type: "SET_VIEW_MODE", viewMode: "3d" });
                }}
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
                      <SelectTrigger className="h-8 flex-1" aria-label="Cross-section axis">
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
            </div>
          </details>
          <div
            className="space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3"
            data-testid="export-preview-layout"
          >
            <div>
              <SettingLabel label="Fit templates" hint="Print a thin template and try the actual tools before printing the full bin." />
            </div>

            {(cutouts.length > 0 || fingerHoles.length > 0) && (
              <div
                className="space-y-2 border-t pt-2.5"
                data-testid="surface-fit-test-export"
              >
                <div>
                  <SettingLabel label="Surface fit test" hint="Export the full pocket-layout surface or 5 mm wide bands around the tool openings only. Tool outlines omit the bin perimeter and separate finger access features. Widely spaced tools print as separate pieces. Thickness sets the printed height. Omits the base, wall height, label tab, and stacking lip; it does not test cut depth or baseplate fit." />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-20 shrink-0 text-xs">Shape</Label>
                  <Select value={surfaceFitCheckStyle} onValueChange={value => setSurfaceFitCheckStyle(surfaceFitCheckStyleSchema.parse(value))}>
                    <SelectTrigger className="h-8" aria-label="Surface fit test shape" data-testid="select-surface-fit-test-style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full surface</SelectItem>
                      <SelectItem value="outline" disabled={cutouts.length === 0}>Tool outlines · {SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM} mm</SelectItem>
                    </SelectContent>
                  </Select>
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
                  disabled={exporting || hasErrors || (surfaceFitCheckStyle === "outline" && cutouts.length === 0)}
                  onClick={() =>
                    setPendingExport({
                      title: "Save surface fit test STL?",
                      description: surfaceFitCheckStyle === "outline"
                        ? `Download ${SURFACE_FIT_CHECK_OUTLINE_WIDTH_MM} mm wide tool outlines, ${surfaceFitCheckThicknessMm} mm thick.`
                        : `Download the complete pocket layout as a ${surfaceFitCheckThicknessMm} mm thin plate.`,
                      confirmLabel: "Download STL",
                      onConfirm: (includeProject) => onExportSurfaceFitCheck(surfaceFitCheckThicknessMm, includeProject, surfaceFitCheckStyle),
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
                  <SettingLabel label="Tool fit template" hint="A filled tool outline without the bin or finger access features. Includes its Trace margin, signed pocket clearance, and outline corner rounding." />
                  <p className="truncate text-xs font-medium" title={pocketName(selectedCutout, selectedShape)}>{pocketName(selectedCutout, selectedShape)}</p>
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
                    description: `Download the filled outline of “${pocketName(selectedCutout, selectedShape)}” at ${fitCheckDepthMm} mm thick.`,
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
                  Add a tool cutout to enable fit templates.
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
          </div>
        </PanelSection>

        <PanelSection
          id="bin-settings-export"
          title="Export"
          icon={Download}
          tone="emerald"
          summary={
            hasErrors
              ? "Needs attention"
              : issues.length > 0
                ? `${issues.length} ${issues.length === 1 ? "warning" : "warnings"}`
              : showPreviewBusy
                ? stats
                  ? "Updating"
                  : "Building"
                : !building && statsAreStale
                  ? "Preview unavailable"
                : cutouts.length === 0 && fingerHoles.length === 0
                  ? "No cutouts"
                : stats
                  ? "Ready"
                  : "No preview"
          }
          defaultOpen={!!inspector || hasErrors}
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
                {statsAreStale ? <p>{building ? "Previous model · updating…" : "Previous model · preview unavailable"}</p> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {previewIsDraft
                  ? building ? "Simplified preview. Model volume will appear when details are ready." : "Simplified preview. Detailed model statistics are unavailable."
                  : building ? "Building preview…" : "No preview yet."}
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
              <SettingLabel label="Export bin design" hint="Export the complete bin at print quality. Use 3MF to preserve optional material colors. Select the editable-project checkbox in the export dialog to also save a project JSON with your tools and settings." />
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
                  description: exportDimensions + " " + (hasSelectedMulticolor
                    ? "STL stores geometry only. Use multi-color 3MF to preserve the selected pocket-floor and rim-top materials."
                    : "Download the complete bin at print quality."),
                  confirmLabel: hasSelectedMulticolor ? "Export STL without colors" : "Download STL",
                  onConfirm: (includeProject) => onExport("stl", includeProject),
                })}
                data-testid="button-export-stl"
              >
                Save STL
              </Button>
            </div>
          </div>

          {cutouts.length > 0 && (
            <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
              <SettingLabel label="Export shadow-board layout (top view)" hint="Bin footprint and pocket silhouettes in millimetres, for CNC or laser shadow boards." />
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
                  Save DXF
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
                  Save SVG
                </Button>
              </div>
            </div>
          )}
        </PanelSection>
      </InspectorPanelSections>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "CANCEL_REMOVE_CUTOUT" });
        }}
      >
        <AlertDialogContent className="grid-cols-1">
          <AlertDialogHeader className="min-w-0 [overflow-wrap:anywhere]">
            <AlertDialogTitle>
              Resize the bin after removing “{pendingRemoval ? pocketName(pendingRemoval, pendingRemovalShape) : "this part"}”?
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
        <DialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] grid-cols-1 overflow-y-auto sm:max-w-md" onOpenAutoFocus={(event) => {
          // Start at the dimensions, even when the export choices need scrolling.
          event.preventDefault();
          threeMfTitleRef.current?.focus({ preventScroll: true });
        }}>
          <DialogHeader className="min-w-0 pr-6 text-left">
            <DialogTitle ref={threeMfTitleRef} tabIndex={-1}>Include multiple colors in the 3MF?</DialogTitle>
            <DialogDescription>
              {exportDimensions}{" "}
              Choose a single printable body or preserve the material colors
              selected in Materials &amp; Colors.
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
                    : "Enable a floor or rim-top color in Materials & Colors first."}
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
      {inspector?.projectHeader && createPortal(<div className="flex flex-wrap items-center gap-1 pr-2" data-testid="editor-project-header">
        {projectStatus}
        <div className="flex shrink-0 items-center gap-1 max-[500px]:w-full max-[500px]:justify-end max-[500px]:border-t max-[500px]:py-1">
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => inspector.showSection("bin-settings-project")}><FolderOpen className="h-4 w-4" />Project</Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => inspector.showSection("bin-settings-fit")}><ClipboardCheck className="h-4 w-4" />Check fit</Button>
          <Button size="sm" className="gap-1.5" onClick={() => inspector.showSection("bin-settings-export")}><Download className="h-4 w-4" />Export</Button>
        </div>
      </div>, inspector.projectHeader)}
      {inspector?.properties && selection.length === 1 && createPortal(<>{pocketProperties}{fingerProperties}</>, inspector.properties)}
    </PanelSectionFilterContext.Provider>
  );
}

interface ProjectControlsProps {
  saveOpen: boolean;
  setSaveOpen: (open: boolean) => void;
  saveStatus?: "saving" | "saved" | "error";
  hydrated: boolean;
  libraryReady: boolean;
  busy: boolean;
  activeProjectId: string | null;
  hasDraftWork: boolean;
  currentProjectName: string | null;
  projects: ProjectLibraryItem[];
  onSaveProject: (name: string) => Promise<boolean>;
  onRenameProject: (projectId: string, name: string) => Promise<boolean>;
  onDuplicateProject: (projectId: string) => Promise<string | null>;
  onOpenProject: (projectId: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRefreshProjects: () => void;
  onExportLibrary: () => void;
  onImportLibrary: (file: File) => void;
  onNewProject: () => void;
  onExportProject: () => void;
  onImportProject: (doc: ProjectDoc) => Promise<boolean>;
}

type ProjectOpenTarget =
  | { kind: "library"; project: ProjectLibraryItem }
  | { kind: "file"; doc: ProjectDoc };

const projectActionClass = "h-auto min-h-11 min-w-0 gap-1.5 whitespace-normal px-2 py-2 text-xs";

function ProjectControls({
  saveOpen,
  setSaveOpen,
  hydrated,
  libraryReady,
  busy,
  activeProjectId,
  hasDraftWork,
  currentProjectName,
  projects,
  onSaveProject,
  onRenameProject,
  onDuplicateProject,
  onOpenProject,
  onDeleteProject,
  onRefreshProjects,
  onExportLibrary,
  onImportLibrary,
  onNewProject,
  onExportProject,
  onImportProject,
  saveStatus = "saved",
}: ProjectControlsProps): JSX.Element {
  const ready = hydrated && libraryReady;
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingOpenProject, setPendingOpenProject] = useState<ProjectOpenTarget | null>(null);
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { libraryRequested, setLibraryRequested } = usePanelState();
  useEffect(() => {
    if (!libraryRequested || !ready || busy) return;
    setLibraryOpen(true);
    setSelectedProjectId(activeProjectId);
    setLibraryRequested(false);
    onRefreshProjects();
  }, [libraryRequested, ready, busy, activeProjectId, setLibraryRequested, onRefreshProjects]);
  const [projectName, setProjectName] = useState("");
  useEffect(() => {
    if (saveOpen) setProjectName(currentProjectName ?? "");
  }, [saveOpen, currentProjectName]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importProjectButtonRef = useRef<HTMLButtonElement | null>(null);
  const libraryImportInputRef = useRef<HTMLInputElement | null>(null);
  const libraryDialogRef = useRef<HTMLDivElement | null>(null);
  const openProjectSourceRef = useRef<HTMLElement | null>(null);
  const projectFileReadRevision = useRef(0);
  useEffect(() => () => { projectFileReadRevision.current += 1; }, []);
  useEffect(() => { projectFileReadRevision.current += 1; }, [activeProjectId]);

  const openProject = async (target: ProjectOpenTarget, discardDraft = false, source?: HTMLElement | null) => {
    if (busy || (target.kind === "library" && target.project.id === activeProjectId)) return;
    // A later library-open choice supersedes any file still being validated.
    if (target.kind === "library") projectFileReadRevision.current += 1;
    if (!activeProjectId && hasDraftWork && !discardDraft) {
      openProjectSourceRef.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setPendingOpenProject(target);
      return;
    }
    const opened = target.kind === "library"
      ? await onOpenProject(target.project.id)
      : await onImportProject(target.doc);
    if (opened) {
      setPendingOpenProject(null);
      setLibraryOpen(false);
    }
  };
  // File reads may finish after the draft, active project, or persistence
  // callbacks have changed. Decide using this render's state, not the state
  // captured when the picker first selected the file.
  const latestOpenProject = useRef(openProject);
  latestOpenProject.current = openProject;

  const readProjectFile = async (file: File) => {
    if (busy) return;
    const revision = ++projectFileReadRevision.current;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      parsed = null;
    }
    if (revision !== projectFileReadRevision.current) return;
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
    // Validate before asking to replace anything; the retained document is also
    // the exact snapshot retried if opening it fails.
    await latestOpenProject.current({ kind: "file", doc }, false, importProjectButtonRef.current);
  };

  const renderNameDialog = (project?: ProjectLibraryItem): JSX.Element => {
    const renaming = !!project || !!activeProjectId;
    const setOpen = (open: boolean) => {
      if (project) setRenameProjectId(open ? project.id : null);
      else setSaveOpen(open);
      if (open) setProjectName(project?.name ?? currentProjectName ?? "");
    };
    return (
      <Dialog open={project ? renameProjectId === project.id : saveOpen} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={renaming ? "ghost" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label={project ? `Rename ${project.name}` : renaming ? "Rename project" : "Save to library"}
            title={renaming ? "Rename project" : "Save to library"}
            disabled={!ready || busy}
            data-testid={project ? `button-rename-project-${project.id}` : "button-save-library"}
          >
            {renaming ? <Pencil className="h-3.5 w-3.5 shrink-0" /> : <Save className="h-3.5 w-3.5 shrink-0" />}
          </Button>
        </DialogTrigger>
        <DialogContent className="grid-cols-1">
          <form className="contents" onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const saved = project ? await onRenameProject(project.id, projectName) : await onSaveProject(projectName);
            if (saved) setOpen(false);
          }}>
            <DialogHeader className="min-w-0 [overflow-wrap:anywhere]">
              <DialogTitle>{renaming ? "Rename project" : "Save project to library"}</DialogTitle>
              <DialogDescription>
                {project ? `Change the name of “${project.name}”.` : "Named projects stay in this browser’s Pocketry library and update automatically as you work."}
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 space-y-2">
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || projectName.trim().length === 0} data-testid="button-confirm-save-library">
                {busy ? "Saving…" : renaming ? "Save name" : "Save project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  };

  const renderLibraryDialog = (): JSX.Element => (
    <Dialog
      open={libraryOpen}
      onOpenChange={(open) => {
        setLibraryOpen(open);
        if (open) setSelectedProjectId(activeProjectId);
        if (open) onRefreshProjects();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!ready || busy}
          data-testid="button-manage-library"
          className={cn(projectActionClass, "w-full")}
        >
          <LibraryBig className="h-3.5 w-3.5 shrink-0" />
          Manage Browser Library
        </Button>
      </DialogTrigger>
      <DialogContent
        ref={libraryDialogRef}
        className="flex max-h-[85dvh] flex-col overflow-hidden p-4 sm:p-6 [&>button]:hidden [@media(max-height:500px)]:max-h-[calc(100dvh_-_2rem)] [@media(max-height:500px)]:overflow-y-auto [@media(max-height:500px)]:scroll-pt-[var(--library-header-height)]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const header = libraryDialogRef.current?.querySelector<HTMLElement>('[data-testid="library-manager-header"]');
          // Reserve the sticky header when revealing a row on short screens.
          libraryDialogRef.current?.style.setProperty("--library-header-height", `${(header?.offsetHeight ?? 0) + 24}px`);
          // Keep opening an empty library from focusing and expanding its help hint.
          const rows = [...(libraryDialogRef.current?.querySelectorAll<HTMLElement>(
            '[data-testid="managed-project-list"] [data-project-id]',
          ) ?? [])];
          // Compare the data value rather than interpolating a saved ID into CSS.
          const target = rows.find((row) => row.dataset.projectId === activeProjectId) ?? rows[0]
            ?? libraryDialogRef.current?.querySelector<HTMLElement>('[data-testid="button-export-library"]');
          target?.focus({ preventScroll: true });
          target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        }}
      >
        <DialogHeader data-testid="library-manager-header" className="relative shrink-0 pr-10 bg-background before:pointer-events-none before:absolute before:-inset-x-4 before:-top-4 before:h-4 before:bg-background [@media(max-height:500px)]:sticky [@media(max-height:500px)]:top-0 [@media(max-height:500px)]:z-10">
          <DialogTitle>Manage browser library</DialogTitle>
          <DialogDescription>
            {projects.length} saved project{projects.length === 1 ? "" : "s"} in this browser.
            Open a project here, or import and export the entire library below.
          </DialogDescription>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="absolute -right-2 -top-2 !mt-0 h-11 w-11" aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <ScrollArea
          type="auto"
          className="min-h-0 [&_[data-radix-scroll-area-viewport]]:max-h-[min(20rem,calc(85dvh_-_15rem))] [@media(max-height:500px)]:shrink-0 [@media(max-height:500px)]:[&_[data-radix-scroll-area-viewport]]:max-h-none [&_[data-orientation=vertical]]:bg-muted/50 [&_[data-orientation=vertical]>div]:bg-muted-foreground/50"
          data-testid="manage-library-scroll"
        >
        <div className="space-y-2 pr-4" data-testid="managed-project-list">
          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
              No named projects yet. Save the current draft to add one.
            </div>
          ) : (
            projects.map((project) => {
              const active = project.id === activeProjectId;
              const openLibraryProject = () => openProject({ kind: "library", project });
              return (
                <div
                  key={project.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border p-3",
                    "flex-wrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    (project.id === selectedProjectId) && "border-primary/50 bg-primary/5",
                  )}
                  data-testid={`library-project-${project.id}`}
                  data-project-id={project.id}
                  data-selected={project.id === selectedProjectId}
                  role="group"
                  aria-label={project.name}
                  tabIndex={0}
                  onFocus={(event) => {
                    if (event.currentTarget.contains(event.target)) setSelectedProjectId(project.id);
                  }}
                  onClick={(event) => {
                    if (!(event.target instanceof Element)) return;
                    if (!event.currentTarget.contains(event.target)) return;
                    setSelectedProjectId(project.id);
                    if (!event.target.closest("button")) event.currentTarget.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || event.key !== "Enter") return;
                    event.preventDefault();
                    void openLibraryProject();
                  }}
                  onDoubleClick={(event) => {
                    if (!(event.target instanceof Element)) return;
                    if (!event.currentTarget.contains(event.target) || event.target.closest("button")) return;
                    void openLibraryProject();
                  }}
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex min-w-0 items-center gap-1" data-testid={`library-project-name-${project.id}`}>
                      <p className="min-w-0 truncate text-sm font-medium" title={project.name}>
                        {project.name}
                      </p>
                      {renderNameDialog(project)}
                    </div>
                    {active && <p className="text-xs text-muted-foreground">Current project</p>}
                    <p className="text-[11px] text-muted-foreground">
                      Updated {formatProjectTime(project.updatedAt)}
                    </p>
                  </div>
                  <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    className="min-h-11 gap-1.5 px-2 text-xs"
                    disabled={busy || active}
                    onClick={() => void openLibraryProject()}
                    aria-label={active ? `${project.name} is currently open` : `Open ${project.name}`}
                    data-testid={`button-open-project-${project.id}`}
                  >
                    {!active && <FolderOpen className="h-4 w-4" />}
                    {active ? "Current" : "Open"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 gap-1.5 px-2 text-xs"
                    disabled={busy}
                    aria-label={`Duplicate ${project.name}`}
                    title="Duplicate project"
                    data-testid={`button-duplicate-project-${project.id}`}
                    onClick={(event) => {
                      event.currentTarget.closest<HTMLElement>('[role="group"]')?.focus();
                      void onDuplicateProject(project.id);
                    }}
                  >
                    <Copy className="h-4 w-4" />Copy
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 shrink-0 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={busy || active}
                        aria-label={`Remove ${project.name} from library`}
                        data-testid={`button-remove-project-${project.id}`}
                      >
                        <Trash2 className="h-4 w-4 shrink-0" />Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="grid-cols-1">
                      <AlertDialogHeader className="min-w-0 [overflow-wrap:anywhere]">
                        <AlertDialogTitle>Remove “{project.name}” from library?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the saved copy from this browser. Your current project
                          will not change. Exported backup files are not affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep project</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={busy || active}
                          onClick={() => void onDeleteProject(project.id)}
                          data-testid="button-confirm-remove-project"
                        >
                          Remove from library
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  </div>
                </div>
              );
            })
          )}
        </div>
        </ScrollArea>
        <div className="shrink-0 space-y-1.5 border-t pt-3" data-testid="library-file-backup">
          <div className="flex items-center justify-between gap-2">
            <SettingLabel label="Entire library" hint="Exports every named project saved in this browser as one JSON file. Unnamed drafts are not included. Import adds projects without replacing your current design or existing library; duplicate names receive an imported suffix." />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" className={projectActionClass} disabled={!ready || busy}
              onClick={onExportLibrary} data-testid="button-export-library">
              <Download className="h-3.5 w-3.5 shrink-0" />Export library
            </Button>
            <Button size="sm" variant="outline" className={projectActionClass} disabled={!ready || busy}
              onClick={() => libraryImportInputRef.current?.click()} data-testid="button-import-library">
              <Upload className="h-3.5 w-3.5 shrink-0" />Import library
            </Button>
          </div>
        </div>
        <input ref={libraryImportInputRef} type="file" accept=".json,application/json"
          className="hidden" aria-label="Import library JSON" data-testid="input-import-library"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImportLibrary(file);
          }} />
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <section aria-label="Browser library" className="space-y-2">
      <div
        className="space-y-2"
        data-testid="project-autosave-status"
      >
        <div
          className="flex min-h-8 items-center gap-1.5"
          data-testid="current-project-name-row"
          role="group"
          aria-labelledby="current-project-label"
        >
        <div className="flex min-w-0 items-baseline gap-1.5">
        <p id="current-project-label" className="shrink-0 text-xs text-muted-foreground">Current Project:</p>
        <p className="min-w-0 cursor-text truncate text-sm font-medium" data-testid="current-project-title"
          title={`${currentProjectName ?? "Untitled project"} — double-click to rename`}
          onDoubleClick={() => {
            if (!ready || busy) return;
            setSaveOpen(true);
          }}>
          {!ready ? "Checking for saved projects…" : (currentProjectName ?? "Untitled project")}
        </p>
        </div>
        {renderNameDialog()}
        </div>
        {saveStatus === "error" && <p className="text-[11px] text-destructive" role="status">Autosave is unavailable. Export this project to keep your work.</p>}
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Project actions">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={projectActionClass}
              disabled={!ready || busy}
              data-testid="button-new-project"
            >
              <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
              New project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Start a new project?</AlertDialogTitle>
              <AlertDialogDescription>
                Saves the latest changes to your named project, then starts with
                empty shapes, pockets, and bin settings. An unnamed draft will be
                replaced.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep current project</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { projectFileReadRevision.current += 1; onNewProject(); }}
                data-testid="button-confirm-new-project"
              >
                Start new project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          variant="outline"
          size="sm"
          className={projectActionClass}
          disabled={!ready || busy}
          onClick={() => importInputRef.current?.click()}
          ref={importProjectButtonRef}
          title="Open an editable Pocketry project file"
          data-testid="button-import-project"
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />Open project
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={projectActionClass}
          disabled={!ready || busy}
          onClick={onExportProject}
          title="Download this design as an editable .pocketry.json file"
          data-testid="button-export-project"
        >
          <Download className="h-3.5 w-3.5 shrink-0" />Export project
        </Button>
      </div>
      {renderLibraryDialog()}
      </section>

      <AlertDialog open={pendingOpenProject !== null} onOpenChange={(open) => {
        if (!open && !busy) setPendingOpenProject(null);
      }}>
        <AlertDialogContent className="grid-cols-1" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openProjectSourceRef.current?.isConnected) openProjectSourceRef.current.focus({ preventScroll: true });
        }}>
          <AlertDialogHeader className="min-w-0 [overflow-wrap:anywhere]">
            <AlertDialogTitle>Replace the current draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft has work that is not saved in your library. Opening “{pendingOpenProject?.kind === "library" ? pendingOpenProject.project.name : pendingOpenProject?.doc.name}”
              {" "}will replace it. Keep working to save or export the draft first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy}>Keep working</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                // Keep the choice available if opening the project fails.
                event.preventDefault();
                if (pendingOpenProject) void openProject(pendingOpenProject, true);
              }}
              data-testid="button-discard-draft-open"
            >
              {busy ? "Opening…" : "Discard draft and open"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.pocketry.json,.tooltrace.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readProjectFile(file);
          event.target.value = "";
        }}
      />
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
          data-mm-slider-track
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

/** The tree stays readable; less frequent row actions remain keyboard reachable. */
function ObjectActions({ name, children }: { name: string; children: ReactNode }): JSX.Element {
  const inspector = useSelectionInspector();
  const pendingAction = useRef<(() => void) | null>(null);
  if (!inspector) return <>{children}</>;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Actions for ${name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={event => {
      // Open the inline name editor only after the menu releases its focus trap.
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action) { event.preventDefault(); action(); }
    }}>
      {Children.map(children, child => isValidElement<{ children: ReactNode; "aria-label": string; disabled?: boolean; onClick: () => void }>(child) &&
        <DropdownMenuItem disabled={child.props.disabled} aria-label={child.props["aria-label"]}
          className="min-h-9 gap-2 text-xs [@media(pointer:coarse)]:min-h-11" onSelect={() => { pendingAction.current = child.props.onClick; }}>
          {child.props.children}<span>{child.props["aria-label"]}</span>
        </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function AdvancedLinks({ children }: { children: ReactNode }): JSX.Element {
  const inspector = useSelectionInspector();
  return inspector ? <details className="group/links border-t pt-1 text-xs"><summary className="flex cursor-pointer items-center justify-between gap-2 py-2 font-medium">Linked copies<ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/links:rotate-180" /></summary>{children}</details> : <>{children}</>;
}
