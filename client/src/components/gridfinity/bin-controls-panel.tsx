import {
  Box,
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
  Ruler,
  Save,
  Scissors,
  Spline,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation } from "wouter";

import type { FingerHole, TracedShape } from "@shared/gridfinity/cutout";
import {
  binFootprintMm,
  GRID_PITCH_DIVISOR,
  gridPitchMm,
  STACKING_LIP_HEIGHT_ACTUAL,
  type GridPitch,
} from "@shared/gridfinity/standard";
import { MAX_GRID, type BinSpecInput } from "@shared/gridfinity/types";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";

import {
  PanelBody,
  PanelSection,
  PanelSettingsIndex,
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
import { fitFootprintToPlacements } from "@/lib/gridfinity/autoplace";
import { occupiedCellCount } from "@shared/gridfinity/footprint";
import {
  binDimensionsMm,
  MULTICOLOR_FLOOR_MAX_THICKNESS_MM,
  MULTICOLOR_MIN_THICKNESS_MM,
  MULTICOLOR_RIM_MAX_THICKNESS_MM,
} from "@/lib/gridfinity/bin";
import type { BuildBinSection, BuildBinStats } from "@/lib/gridfinity/worker-api";
import type { ProjectLibraryItem } from "@/lib/project/persist";
import { cn } from "@/lib/utils";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";

/** Slider ceiling for height; the schema allows more, the UI keeps it sane. */
const MAX_HEIGHT_UNITS_UI = 12;
/** Slider ceiling: at most eight full cells, within the schema hard cap. */
const maxGridUi = (pitch: GridPitch): number =>
  Math.min(MAX_GRID, 8 * GRID_PITCH_DIVISOR[pitch]);

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

function EditableShapeName({
  shape,
  onRename,
}: {
  shape: TracedShape;
  onRename: (name: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(shape.name);
  const [editing, setEditing] = useState(false);

  useEffect(() => setDraft(shape.name), [shape.id, shape.name]);

  const commit = () => {
    const name = draft.trim();
    if (name.length === 0) {
      setDraft(shape.name);
      setEditing(false);
      return;
    }
    if (name !== shape.name) onRename(name);
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(shape.name);
            setEditing(false);
          }
        }}
        className="h-8 font-medium"
        aria-label="Tool shape name"
        data-testid="input-shape-name"
      />
    );
  }

  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left font-medium hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setEditing(true)}
      aria-label={`Rename ${shape.name}`}
      title="Click to rename"
      data-testid="button-edit-shape-name"
    >
      <span className="truncate">{shape.name}</span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
    </button>
  );
}

const BIN_SETTINGS_SECTIONS = [
  { id: "bin-settings-project", label: "Project", tone: "slate" },
  { id: "bin-settings-size", label: "Size", tone: "blue" },
  { id: "bin-settings-construction", label: "Construction", tone: "rose" },
  { id: "bin-settings-pockets", label: "Tool Cutouts", tone: "violet" },
  { id: "bin-settings-view", label: "View", tone: "amber" },
  { id: "bin-settings-export", label: "Export", tone: "emerald" },
] as const;

export interface BinControlsPanelProps {
  stats: BuildBinStats | null;
  building: boolean;
  exporting: boolean;
  onExport: (format: "3mf" | "3mf-multicolor" | "stl") => void;
  onExportFitCheck: (cutoutId: string, depthMm: number) => void;
  onExportLayout: (format: "dxf" | "svg") => void;
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
  stats,
  building,
  exporting,
  onExport,
  onExportFitCheck,
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
}: BinControlsPanelProps): JSX.Element {
  const {
    spec,
    cutouts,
    selectedCutoutId,
    pendingRemovalId,
    editorMode,
    hydrated,
    dispatch,
  } = useBin();
  const [, navigate] = useLocation();
  const { shapes, storeShape } = useShapeLibrary();
  const shapesById = useMemo(
    () => new Map(shapes.map((shape) => [shape.id, shape])),
    [shapes],
  );

  const dims = useMemo(() => binDimensionsMm(spec), [spec]);
  const issues = useMemo(
    () => [
      ...validateBinSpec(spec).issues,
      ...validateLayout(spec, cutouts, shapesById),
    ],
    [spec, cutouts, shapesById],
  );
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const enabledFeatureCount = [
    spec.lip === "standard",
    spec.fill === "solid",
    spec.liteBase,
    spec.magnetHoles,
    spec.screwHoles,
    spec.labelTab !== null,
  ].filter(Boolean).length;
  const fingerHoleCount = cutouts.reduce(
    (count, cutout) => count + cutout.fingerHoles.length,
    0,
  );
  const [fitCheckDepthMm, setFitCheckDepthMm] = useState(2);
  const [threeMfDialogOpen, setThreeMfDialogOpen] = useState(false);
  const [stlWarningOpen, setStlWarningOpen] = useState(false);
  const hasBlindPocket = cutouts.some(
    (cutout) => cutout.depth.mode !== "through",
  );
  const hasSelectedFloorColor = colorPocketFloors && hasBlindPocket;
  const hasSelectedRimColor = colorStackingRim && spec.lip === "standard";
  const hasSelectedMulticolor =
    hasSelectedFloorColor || hasSelectedRimColor;
  const activeColorCount =
    1 + Number(hasSelectedFloorColor) + Number(hasSelectedRimColor);

  const patchSpec = (patch: Partial<BinSpecInput>, transient = false) =>
    dispatch({ type: "PATCH_SPEC", patch, transient });

  const selectedCutout = cutouts.find((cutout) => cutout.id === selectedCutoutId) ?? null;
  const selectedShape = selectedCutout
    ? (shapesById.get(selectedCutout.shapeId) ?? null)
    : null;
  const pendingRemoval =
    cutouts.find((cutout) => cutout.id === pendingRemovalId) ?? null;
  const pendingRemovalShape = pendingRemoval
    ? (shapesById.get(pendingRemoval.shapeId) ?? null)
    : null;

  const fitLayout = (
    nextCutouts: typeof cutouts,
    historyLabel = "Fit bin to contents",
  ) => {
    const fitted = fitFootprintToPlacements(
      nextCutouts,
      shapesById,
      spec,
    );
    dispatch({ type: "REPLACE_LAYOUT", ...fitted, historyLabel });
  };

  return (
    <div className="flex h-full flex-col">
      <PanelSettingsIndex
        ariaLabel="Find bin settings"
        testIdPrefix="bin"
        items={BIN_SETTINGS_SECTIONS}
      />
      <PanelBody className="flex-1">
        <PanelSection
          id="bin-settings-project"
          title="Project"
          icon={FolderOpen}
          tone="slate"
          summary={projectBusy ? "Saving…" : currentProjectName ? "Saved" : "Draft"}
          defaultOpen={false}
          className="scroll-mt-16"
        >
          <ProjectControls
            hydrated={hydrated}
            libraryReady={projectLibraryReady}
            busy={projectBusy}
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
          icon={Ruler}
          tone="blue"
          summary={`${spec.gridX} × ${spec.gridY} × ${spec.heightUnits}u`}
          className="scroll-mt-16"
        >
          <div className="flex items-center gap-2">
            <Label className="w-16 shrink-0 text-xs">Grid pitch</Label>
            <Select
              value={spec.gridPitch}
              onValueChange={(value) => {
                const gridPitch = value as GridPitch;
                patchSpec({
                  gridPitch,
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
                <SelectItem value="full">Full · 42 mm</SelectItem>
                <SelectItem value="half">Half · 21 mm</SelectItem>
                <SelectItem value="quarter">Quarter · 10.5 mm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {spec.footprint.kind === "rectangle" ? (
            <>
              <CellSlider
                label="Width"
                cells={spec.gridX}
                pitch={spec.gridPitch}
                onChange={(gridX, transient) => patchSpec({ gridX }, transient)}
              />
              <CellSlider
                label="Length"
                cells={spec.gridY}
                pitch={spec.gridPitch}
                onChange={(gridY, transient) => patchSpec({ gridY }, transient)}
              />
            </>
          ) : (
            <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              Bounding grid {spec.gridX} × {spec.gridY}. Add or remove cells in the Layout view,
              or reset to a rectangle to use the size sliders.
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs">Height</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {spec.heightUnits} u · {spec.heightUnits * 7} mm
              </span>
            </div>
            <Slider
              value={[spec.heightUnits]}
              onValueChange={([heightUnits]) =>
                patchSpec({ heightUnits }, true)
              }
              onValueCommit={([heightUnits]) => patchSpec({ heightUnits })}
              min={1}
              max={MAX_HEIGHT_UNITS_UI}
              step={1}
              aria-label="Height in 7 mm units"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Outer size {dims.widthMm.toFixed(1)} × {dims.lengthMm.toFixed(1)} ×{" "}
            {dims.totalHeightMm.toFixed(1)} mm
            {spec.lip === "standard"
              ? ` (rim + ${STACKING_LIP_HEIGHT_ACTUAL.toFixed(1)} mm lip)`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="bin-footprint-summary">
            {occupiedCellCount(spec)} of {spec.gridX * spec.gridY} cells occupied
            {spec.footprint.kind === "custom" ? " · custom footprint" : ""}
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
          {cutouts.length > 0 && (
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
          summary={`${enabledFeatureCount} on`}
          defaultOpen={false}
          className="scroll-mt-16"
        >
          <FeatureSwitch
            label="Stacking lip"
            description="Lets another bin stack on top"
            checked={spec.lip === "standard"}
            onChange={(on) => patchSpec({ lip: on ? "standard" : "none" })}
          />
          <FeatureSwitch
            label="Solid fill"
            description="Material for pockets — required for cutouts"
            checked={spec.fill === "solid"}
            onChange={(on) => patchSpec({ fill: on ? "solid" : "none" })}
          />
          <FeatureSwitch
            label="Lite base"
            description="Hollow base — less plastic, no magnet holes"
            checked={spec.liteBase}
            onChange={(liteBase) => patchSpec({ liteBase })}
          />
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

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <Label className="w-16 shrink-0 text-xs">Label tab</Label>
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
            <p className="text-[11px] text-muted-foreground">
              A sloped shelf under the rim for labelling the bin.
            </p>
          </div>
        </PanelSection>

        {/* Keyed on emptiness: defaultOpen is uncontrolled, and the section
            should reveal itself the moment the first pocket arrives. */}
        <PanelSection
          key={cutouts.length > 0 ? "pockets" : "pockets-empty"}
          id="bin-settings-pockets"
          title="Tool Cutout Settings"
          icon={Scissors}
          tone="violet"
          summary={`${cutouts.length} pocket${cutouts.length === 1 ? "" : "s"} · ${
            fingerHoleCount
          } hole${fingerHoleCount === 1 ? "" : "s"}`}
          defaultOpen={cutouts.length > 0}
          className="scroll-mt-16"
        >
          {cutouts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Trace a tool and press “Add to bin” — pockets land here and can
              be moved and rotated in the Layout view.
            </p>
          ) : (
            <>
              <div
                className="flex gap-2 rounded-md border border-violet-500/25 bg-violet-500/10 px-2.5 py-2 text-[11px] text-violet-900 dark:text-violet-100"
                data-testid="pocket-selection-help"
              >
                <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">Select a tool contour to edit it.</span>{" "}
                  Click it in the Layout view or choose its pocket below. Once
                  selected, click the tool name itself to rename it; the remaining
                  contour, depth, clearance, finger-hole, and edge options appear below.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onAutoArrange}
                data-testid="button-auto-arrange"
              >
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                Auto-arrange
              </Button>
              <div className="space-y-1">
                {cutouts.map((cutout) => {
                  const shape = shapesById.get(cutout.shapeId);
                  const isSelected = cutout.id === selectedCutoutId;
                  return (
                    <div
                      key={cutout.id}
                      className={cn(
                        "flex items-center gap-1 rounded border px-1 py-1 text-xs",
                        isSelected
                          ? "border-violet-500/40 bg-violet-500/10 text-accent-foreground"
                          : "border-transparent hover:border-violet-500/20 hover:bg-accent/50",
                      )}
                      data-testid={`cutout-row-${cutout.id}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5">
                        {isSelected && shape ? (
                          <div className="min-w-0 flex-1">
                            <EditableShapeName
                              shape={shape}
                              onRename={(name) => storeShape({ ...shape, name })}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate rounded text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-pressed={false}
                            onClick={() =>
                              dispatch({ type: "SELECT_CUTOUT", id: cutout.id })
                            }
                            data-testid={`button-select-${cutout.id}`}
                          >
                            {shape?.name ?? "missing shape"}
                          </button>
                        )}
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                            isSelected
                              ? "bg-violet-600 text-white"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isSelected ? "Selected" : "Select to edit"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Duplicate pocket"
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatch({
                            type: "DUPLICATE_CUTOUT",
                            id: cutout.id,
                            newId: crypto.randomUUID(),
                          });
                        }}
                        data-testid={`button-duplicate-${cutout.id}`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Remove pocket"
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: cutout.id });
                        }}
                        data-testid={`button-remove-${cutout.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {selectedCutout && selectedShape && (
            <div className="space-y-3 border-t pt-3">
              <Button
                variant={editorMode === "contour" ? "default" : "outline"}
                size="sm"
                className="w-full"
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
                <Spline className="mr-1.5 h-3.5 w-3.5" />
                {editorMode === "contour" ? "Finish contour editing" : "Edit contour"}
              </Button>
              {editorMode === "contour" && (
                <p className="rounded-md bg-violet-500/10 px-2.5 py-2 text-[11px] text-violet-800 dark:text-violet-200">
                  Drag points to reshape. Click an edge to add a point; right-click a
                  point to remove it.
                </p>
              )}

              {/* Keep finger access beside the selected-pocket heading so it
                  cannot disappear below the pocket-shaping controls. */}
              <div className="space-y-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Finger holes</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Straight cut or top scoop
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    data-testid="button-add-finger-hole"
                    onClick={() =>
                      dispatch({
                        type: "UPDATE_CUTOUT",
                        id: selectedCutout.id,
                        patch: {
                          fingerHoles: [
                            ...selectedCutout.fingerHoles,
                            {
                              id: crypto.randomUUID(),
                              // Default on the outline's right edge so the
                              // cut straddles pocket and material.
                              center: { x: selectedShape.bboxMm.maxX, y: 0 },
                              diameterMm: 18,
                              kind: "straight",
                              depthMm: 12,
                            },
                          ],
                        },
                        historyLabel: "Add finger hole",
                      })
                    }
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add hole
                  </Button>
                </div>
                {selectedCutout.fingerHoles.map((hole, index) => (
                  <div key={hole.id} className="space-y-2 rounded-md border bg-background p-2">
                    <div className="flex items-center gap-2">
                      <Label className="flex-1 text-xs">Hole {index + 1}</Label>
                      <Select
                        value={hole.kind}
                        onValueChange={(kind) =>
                          dispatch({
                            type: "UPDATE_CUTOUT",
                            id: selectedCutout.id,
                            patch: {
                              fingerHoles: selectedCutout.fingerHoles.map((h) =>
                                h.id === hole.id
                                  ? { ...h, kind: kind as FingerHole["kind"] }
                                  : h,
                              ),
                            },
                            historyLabel: "Change finger hole type",
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-7 w-28 px-2 text-xs"
                          aria-label={`Finger hole ${index + 1} type`}
                          data-testid={`finger-hole-kind-${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="straight">Straight</SelectItem>
                          <SelectItem value="scoop">Scoop</SelectItem>
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove finger hole ${index + 1}`}
                        onClick={() =>
                          dispatch({
                            type: "UPDATE_CUTOUT",
                            id: selectedCutout.id,
                            patch: {
                              fingerHoles: selectedCutout.fingerHoles.filter(
                                (h) => h.id !== hole.id,
                              ),
                            },
                            historyLabel: "Remove finger hole",
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <MmSlider
                      label="Diameter"
                      value={hole.diameterMm}
                      min={6}
                      max={40}
                      step={1}
                      onChange={(diameterMm, transient) =>
                        dispatch({
                          type: "UPDATE_CUTOUT",
                          id: selectedCutout.id,
                          patch: {
                            fingerHoles: selectedCutout.fingerHoles.map((h) =>
                              h.id === hole.id ? { ...h, diameterMm } : h,
                            ),
                          },
                          historyLabel: "Resize finger hole",
                          transient,
                        })
                      }
                    />
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Drag each circle in Layout to position it.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Label className="w-16 shrink-0 text-xs">Rotation</Label>
                <DraftNumberInput
                  className="h-8"
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

              <div className="flex items-center gap-2">
                <Label className="w-16 shrink-0 text-xs">Depth</Label>
                <Select
                  value={selectedCutout.depth.mode}
                  onValueChange={(mode) => {
                    const depth =
                      mode === "through"
                        ? ({ mode: "through" } as const)
                        : mode === "mm"
                          ? ({ mode: "mm", value: 10 } as const)
                          : ({ mode: "remaining", floorThicknessMm: 7 } as const);
                    dispatch({
                      type: "UPDATE_CUTOUT",
                      id: selectedCutout.id,
                      patch: { depth },
                      historyLabel: "Change pocket depth",
                    });
                  }}
                >
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="remaining">To the base</SelectItem>
                    <SelectItem value="mm">Fixed depth</SelectItem>
                    <SelectItem value="through">Through</SelectItem>
                  </SelectContent>
                </Select>
                {selectedCutout.depth.mode === "mm" && (
                  <DraftNumberInput
                    className="h-8 w-20"
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

              <MmSlider
                label="Extra pocket clearance"
                value={selectedCutout.clearanceMm}
                min={0}
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
                hint="Added after the Trace margin; new pockets start at 0 mm."
              />
              <MmSlider
                label="Outline corner round"
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
                hint="Rounds sharp corners in the pocket outline from top to bottom."
              />
              <MmSlider
                label="Top edge round"
                value={selectedCutout.topFilletMm}
                min={0}
                max={3}
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
                hint="Rounds the pocket wall into the top surface of the bin."
              />
              <MmSlider
                label="Bottom fillet"
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
                hint="Rounds the wall into the floor; the transition ends one radius above the floor."
              />

            </div>
          )}
        </PanelSection>

        <PanelSection
          id="bin-settings-view"
          title="View Settings"
          icon={Eye}
          tone="amber"
          summary={
            section
              ? "Colors · cut open"
              : `${activeColorCount} color${activeColorCount === 1 ? "" : "s"}`
          }
          defaultOpen={section !== null}
          className="scroll-mt-16"
        >
          <div
            className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-2.5 py-2"
            data-testid="view-color-row-bin"
          >
            <div className="min-w-0">
              <Label htmlFor="input-bin-color" className="text-xs">
                Bin body
              </Label>
              <p className="truncate text-[11px] text-muted-foreground">
                Main preview and 3MF material
              </p>
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
                <Label className="text-xs">Pocket floors</Label>
                <p className="truncate text-[11px] text-muted-foreground">
                  Separate material below blind-pocket surfaces
                </p>
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
              <Label htmlFor="input-pocket-floor-thickness" className="text-[11px]">
                Color thickness
              </Label>
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
                <Label className="text-xs">Stacking rim top</Label>
                <p className="truncate text-[11px] text-muted-foreground">
                  {spec.lip === "standard"
                    ? "Separate material below the original rim surface"
                    : "Turn on the stacking lip to enable this material"}
                </p>
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
              <Label htmlFor="input-stacking-rim-thickness" className="text-[11px]">
                Color thickness
              </Label>
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
          <p className="text-[11px] text-muted-foreground">
            Accent thickness replaces existing material downward from each
            original surface; it never adds height to the bin.
          </p>
          <FeatureSwitch
            label="Cut the preview open"
            description="Slice the 3D view to inspect pockets"
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

        <PanelSection
          id="bin-settings-export"
          title="Export & validation"
          icon={Download}
          tone="emerald"
          summary={
            hasErrors
              ? "Needs attention"
              : building
                ? stats
                  ? "Updating"
                  : "Building"
                : cutouts.length === 0
                  ? "No cutouts"
                : stats
                  ? "Ready"
                  : "No preview"
          }
          defaultOpen={hasErrors}
          className="scroll-mt-16"
        >
          <div className="space-y-1">
            <Label className="text-xs">Model validation</Label>
            {stats ? (
              <p className="text-xs tabular-nums text-muted-foreground">
                {stats.triangles.toLocaleString()} triangles ·{" "}
                {(stats.volumeMm3 / 1000).toFixed(1)} cm³ · ≈
                {((stats.volumeMm3 / 1000) * 1.24).toFixed(0)} g solid PLA
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {building ? "Building preview…" : "No preview yet."}
              </p>
            )}
          </div>
          {cutouts.length === 0 ? (
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
          {issues.map((issue, index) => (
            <p
              key={`${issue.code}-${index}`}
              className={
                issue.severity === "error"
                  ? "text-xs text-destructive"
                  : "text-xs text-amber-600 dark:text-amber-500"
              }
            >
              {issue.message}
            </p>
          ))}

          <div
            className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5"
            data-testid="export-final-model"
          >
            <div>
              <Label className="text-xs">Final printable model</Label>
              <p className="text-[11px] text-muted-foreground">
                {cutouts.length === 0
                  ? "Export the solid bin at print quality. Use 3MF to preserve optional material colors."
                  : "Export the complete bin at print quality. Use 3MF to preserve optional material colors."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="sm"
                disabled={exporting || hasErrors}
                onClick={() => setThreeMfDialogOpen(true)}
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
                onClick={() =>
                  hasSelectedMulticolor
                    ? setStlWarningOpen(true)
                    : onExport("stl")
                }
                data-testid="button-export-stl"
              >
                Save STL
              </Button>
            </div>
          </div>

          <div
            className="space-y-3 rounded-md border border-violet-500/25 bg-violet-500/5 p-2.5"
            data-testid="export-preview-layout"
          >
            <div>
              <Label className="text-xs">Preview &amp; layout checks</Label>
              <p className="text-[11px] text-muted-foreground">
                Lightweight outputs for checking fit or planning a shadow board;
                these are not the final bin model.
              </p>
            </div>

            {selectedCutout && selectedShape ? (
              <div className="space-y-2 border-t pt-2.5">
                <div>
                  <Label className="text-xs">Tool fit template</Label>
                  <p className="text-[11px] text-muted-foreground">
                    A filled outline of “{selectedShape.name}” without the bin or
                    finger holes.
                  </p>
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
                  onClick={() => onExportFitCheck(selectedCutout.id, fitCheckDepthMm)}
                  data-testid="button-export-fit-check"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {exporting ? "Building…" : "Save fit template STL"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Includes its Trace margin, extra clearance, and outline corner
                  round.
                </p>
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
                <Label className="text-xs">Shadow-board layout (top view)</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => onExportLayout("dxf")}
                    data-testid="button-layout-dxf"
                  >
                    Layout DXF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => onExportLayout("svg")}
                    data-testid="button-layout-svg"
                  >
                    Layout SVG
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Bin footprint and pocket silhouettes in millimetres, for CNC
                  or laser shadow boards.
                </p>
              </div>
            )}
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
              Pocketry can recenter the remaining pockets and shrink the bin to
              the smallest Gridfinity size that contains them.
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Include multiple colors in the 3MF?</DialogTitle>
            <DialogDescription>
              Choose a single printable body or preserve the material colors
              selected in View Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="h-auto justify-start px-3 py-2.5 text-left"
              disabled={exporting || hasErrors}
              onClick={() => {
                setThreeMfDialogOpen(false);
                onExport("3mf");
              }}
              data-testid="button-export-single-color-3mf"
            >
              <Box className="mr-2 h-4 w-4 shrink-0" />
              <span>
                <span className="block text-sm font-medium">Single-color 3MF</span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  One body using the selected bin color.
                </span>
              </span>
            </Button>
            <Button
              className="h-auto justify-start px-3 py-2.5 text-left"
              disabled={exporting || hasErrors || !hasSelectedMulticolor}
              onClick={() => {
                setThreeMfDialogOpen(false);
                onExport("3mf-multicolor");
              }}
              data-testid="button-export-multicolor-3mf"
            >
              <Palette className="mr-2 h-4 w-4 shrink-0" />
              <span>
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
                    : "Enable a floor or rim-top color in View Settings first."}
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

      <AlertDialog open={stlWarningOpen} onOpenChange={setStlWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>STL will not include your colors</AlertDialogTitle>
            <AlertDialogDescription>
              STL stores geometry only. The selected color assignments for
              {" "}
              {[
                hasSelectedFloorColor ? "pocket-floor" : null,
                hasSelectedRimColor ? "rim-top" : null,
              ]
                .filter(Boolean)
                .join(" and ")} regions will be omitted. Use 3MF and choose
              Multi-color 3MF to preserve the separate printable materials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onExport("stl")}
              data-testid="button-confirm-stl-without-colors"
            >
              Export STL without colors
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

interface ProjectControlsProps {
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
        <p className="text-xs font-medium">
          {!ready
            ? "Checking for saved projects…"
            : (currentProjectName ?? "Untitled project")}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {!ready
            ? "Project actions will be ready in a moment."
            : currentProjectName
              ? "Saved automatically in this browser’s Project Library."
              : "This draft resumes automatically; save it to the library to name it."}
        </p>
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
              {currentProjectName ? "Rename" : "Save to library"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form className="contents" onSubmit={(event) => void handleSave(event)}>
              <DialogHeader>
                <DialogTitle>
                  {currentProjectName ? "Rename project" : "Save project to library"}
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
        <Label className="text-xs">Portable backup</Label>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            disabled={!ready || busy}
            onClick={onExportProject}
            data-testid="button-export-project"
          >
            Export JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            disabled={!ready || busy}
            onClick={() => importInputRef.current?.click()}
            data-testid="button-import-project"
          >
            Import JSON
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
        <p className="text-[11px] text-muted-foreground">
          JSON is for backup or transfer; downloads follow browser settings.
        </p>
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
  const pitchMm = gridPitchMm(pitch);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {cells} {cells === 1 ? "cell" : "cells"} · {binFootprintMm(cells, pitch).toFixed(1)} mm
        </span>
      </div>
      <Slider
        value={[cells]}
        onValueChange={([value]) => onChange(value, true)}
        onValueCommit={([value]) => onChange(value, false)}
        min={1}
        max={maxGridUi(pitch)}
        step={1}
        aria-label={`${label} in ${pitchMm} mm cells`}
      />
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
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number, transient: boolean) => void;
}): JSX.Element {
  const decimalPlaces = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.toFixed(1)} mm
        </span>
      </div>
      <Slider
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
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
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
        <Label className="text-xs">{label}</Label>
        {description && (
          <p className="truncate text-[11px] text-muted-foreground">{description}</p>
        )}
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
