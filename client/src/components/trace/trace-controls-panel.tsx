import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  CheckCircle2,
  Crop,
  Download,
  Image as ImageIcon,
  Scaling,
  RotateCcw,
  RotateCw,
  ScanLine,
  Settings2,
  Expand,
} from "lucide-react";
import { useLocation } from "wouter";

import {
  hasCalibrationEndpoints,
  type Calibration,
} from "@shared/geometry/scale";

import {
  PanelFooter,
  revealPanelSection,
  PanelSection,
  PanelSettingsIndex,
} from "@/components/layout/panel-section";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RulerLengthInput } from "./ruler-length-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabelledSlider } from "./labelled-slider";
import { TraceDetectionControls } from "./trace-detection-controls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  validPerspectiveQuad,
  type PerspectiveProposal,
  type PerspectiveQuad,
} from "@/lib/calibrate/perspective";
import {
  templateDisplayName,
  type TemplatePaper,
  type TemplateVariant,
} from "@/lib/calibrate/template";
import { describeScale, exportScale } from "@/lib/export/scale";
import { TraceHandoffDialog } from "./trace-handoff-dialog";
import type { ImageRotationDirection } from "@/lib/geometry/image-rotation";
import {
  adjustOutlineMargin,
  MARGIN_MM_OPTIONS,
} from "@/lib/image-processor";
import { cn } from "@/lib/utils";
import { HelpHint } from "@/components/ui/help-hint";
import { useToast } from "@/hooks/use-toast";
import { useShapeLibrary } from "@/state/shape-library";
import { useTrace, type ExportFormat } from "@/state/trace-store";

import { CalibrationDownloads } from "./calibration-downloads";
import { AutoCalibrationOptions } from "./auto-calibration-options";
import { RingList } from "./ring-list";
import { revealTraceStep } from "./reveal-trace-step";
import { TracePhotoBoundsControl } from "./trace-photo-bounds-control";
import { TracePanelSections } from "./trace-panel-sections";
import { useTraceInspector } from "./trace-inspector-context";
import { TRACE_WORKFLOW_SECTIONS } from "./trace-workflow";

const RESPONSIVE_PANEL_ACTION =
  "h-auto min-h-9 w-full whitespace-normal break-words px-2 py-2 text-sm leading-tight";

export interface TraceControlsPanelProps {
  /** Defer guided focus while the desktop controls are collapsed. */
  active?: boolean;
  settingsSectionRequest?: { id: string };
  onCanvasInteraction?: () => void;
  onReplaceImage: () => void;
  onRotateImage: (direction: ImageRotationDirection) => void;
  onExport: () => void;
  onReprocess: (settings?: { sensitivity: number; includeInteriorHoles: boolean }) => void;
  /** Re-run ArUco marker detection on the full frame, with feedback. */
  onDetectMarkers: () => void;
  /** Paper scale by default; false for manual scale, or an aid ruler to transform. */
  onApplyPerspective: (
    proposal: PerspectiveProposal,
    template: TemplateVariant,
    usePaperScale?: boolean | Calibration,
  ) => void;
}

const TRACE_SETTINGS_SECTION_DETAILS = TRACE_WORKFLOW_SECTIONS;

/**
 * Everything that used to sit above or below the canvas, moved into the side
 * panel so the canvas gets the whole working area.
 *
 * Sections are plain collapsibles rather than cards: in a ~300px panel, nested
 * card padding and borders waste roughly a tenth of the usable width.
 */
export function TraceControlsPanel({
  active = true,
  onReplaceImage,
  onRotateImage,
  onExport,
  onReprocess,
  onDetectMarkers,
  onApplyPerspective,
  settingsSectionRequest,
  onCanvasInteraction: onCanvasInteractionProp,
}: TraceControlsPanelProps): JSX.Element {
  const store = useTrace();
  const inspector = useTraceInspector();
  const showSection = inspector?.showSection;
  const onCanvasInteraction = () => { inspector?.showCanvas(); onCanvasInteractionProp?.(); };
  const {
    dispatch,
    imageUrl,
    sourceRevision,
    imageSize,
    fileName,
    outline,
    calibration,
    pendingAutoCalibration,
    pendingCalibrationSource,
    calibrationSource,
    draftCalibration,
    pendingPerspective,
    manualPerspectivePoints,
    perspectiveCorrection,
    perspectiveOriginalImageUrl,
    region,
    sensitivity,
    margin,
    exportFormat,
    extrusionHeight,
    processing,
  } = store;
  const { toast } = useToast();
  useEffect(() => {
    if (!active || !settingsSectionRequest) return;
    if (showSection) showSection(settingsSectionRequest.id);
    else revealPanelSection(settingsSectionRequest.id, TRACE_SETTINGS_SECTION_DETAILS);
  }, [active, settingsSectionRequest, showSection]);

  const scale = exportScale(calibration, imageSize.height);
  const displayedScale = exportScale(
    pendingAutoCalibration ?? calibration,
    imageSize.height,
  );
  const hasImage = imageSize.width > 0;
  const hasOutline = outline.length > 0;
  const reviewingScale = pendingAutoCalibration !== null;
  const usingReferenceStrip =
    pendingCalibrationSource === "strip" || calibrationSource === "strip";
  const hasDetectionRegion = Boolean(
    region && region.width > 5 && region.height > 5,
  );
  const manualRulerPending =
    calibration === null && hasCalibrationEndpoints(draftCalibration);
  const traceSettingsSections = TRACE_SETTINGS_SECTION_DETAILS.map((item) => {
    if (item.id === "trace-settings-source") return item;
    if (item.id === "trace-settings-scale") {
      return {
        ...item,
        disabled: !hasImage,
        disabledReason: "Choose a source image first",
      };
    }
    if (item.id === "trace-settings-crop") {
      return {
        ...item,
        disabled: !scale.mmPerPx || reviewingScale,
        disabledReason: hasImage
          ? "Set the scale first"
          : "Choose a source image first",
      };
    }
    if (item.id === "trace-settings-detect") {
      return {
        ...item,
        disabled: !scale.mmPerPx || !hasDetectionRegion || reviewingScale,
        disabledReason: !hasImage
          ? "Choose a source image first"
          : !scale.mmPerPx
            ? "Set the scale first"
            : "Set a detection region first",
      };
    }
    return {
      ...item,
      disabled: !hasOutline || reviewingScale || (item.id === "trace-settings-margin" && !scale.mmPerPx),
      disabledReason: !hasImage
        ? "Choose a source image first"
        : "Detect a tool first",
    };
  });
  const [sectionEpoch, setSectionEpoch] = useState(0);
  const [restoreSourceRevision, setRestoreSourceRevision] = useState<number | null>(null);
  const requestRestoreSource = () => {
    if (outline.length || region || calibration || draftCalibration || store.history.stack.length > 1) {
      setRestoreSourceRevision(sourceRevision);
    } else {
      dispatch({ type: "RESTORE_PERSPECTIVE_SOURCE" });
    }
  };
  const [guidedSection, setGuidedSection] = useState<
    "scale" | "region" | "detection" | null
  >(null);
  const guideTo = (section: "scale" | "region" | "detection" | null, reveal = true) => {
    setGuidedSection(section);
    showSection?.(section === "scale" ? "trace-settings-scale" : section === "region" ? "trace-settings-crop"
      : section === "detection" ? "trace-settings-detect" : "trace-settings-source", reveal);
  };
  // The template marker family identifies paper automatically. A markerless
  // four-corner fallback still needs the printed paper's dimensions.
  const perspectivePaper = store.manualPerspectivePaper;
  const setPerspectivePaper = (paper: TemplatePaper) => dispatch({ type: "SET_PERSPECTIVE_PAPER", paper });
  const previousSourceRevision = useRef(sourceRevision);
  const previousScaleComplete = useRef(scale.mmPerPx !== null);
  const previousAutoPending = useRef(pendingAutoCalibration !== null);
  const previousManualRulerPending = useRef(manualRulerPending);
  const previousMode = useRef(store.mode);
  const previousPerspectiveCount = useRef(manualPerspectivePoints.length);
  const focusWhenReady = useRef<
    "scale" | "auto" | "ruler" | "length" | "region" | "detection" | null
  >(null);
  const marginRequest = useRef(0);
  const latestMarginGeometry = useRef({ outline, margin, calibration });
  latestMarginGeometry.current = { outline, margin, calibration };

  const handleMarginChange = (nextMargin: number): void => {
    const request = ++marginRequest.current;

    void (async () => {
      while (request === marginRequest.current) {
        const current = latestMarginGeometry.current;
        if (current.margin === nextMargin) return;
        if (current.outline.length === 0 || !current.calibration) {
          dispatch({ type: "SET_MARGIN", margin: nextMargin });
          return;
        }

        let adjusted;
        try {
          adjusted = await adjustOutlineMargin(
            current.outline,
            current.margin,
            nextMargin,
            current.calibration,
          );
        } catch (cause) {
          if (request !== marginRequest.current) return;
          toast({
            title: "Could not adjust contour margin",
            description: cause instanceof Error ? cause.message : String(cause),
            variant: "destructive",
          });
          return;
        }

        if (request !== marginRequest.current) return;
        const latest = latestMarginGeometry.current;
        if (
          latest.outline !== current.outline ||
          latest.margin !== current.margin ||
          latest.calibration !== current.calibration
        ) {
          // A vertex edit or scale change landed while the offset was running.
          // Retry against that latest edited contour rather than overwriting it.
          continue;
        }
        dispatch({
          type: "MARGIN_COMMITTED",
          outline: adjusted,
          margin: nextMargin,
        });
        return;
      }
    })();
  };

  // A new source starts a new guided pass through the controls. Remounting the
  // section body resets every uncontrolled collapsible; once decoding finishes,
  // Source closes and Scale opens. Existing Trace state survives route changes
  // because an ordinary remount does not look like a newly selected image.
  useEffect(() => {
    if (sourceRevision === previousSourceRevision.current) return;
    previousSourceRevision.current = sourceRevision;
    const restoredSection = outline.length > 0 || region ? "detection" : "scale";
    guideTo(imageUrl === null ? null : restoredSection);
    focusWhenReady.current = imageUrl === null ? null : restoredSection;
    setSectionEpoch((epoch) => epoch + 1);
  }, [imageUrl, sourceRevision, outline.length, region]);

  // Two placed endpoints are still only a pixel ruler. Keep Scale open and
  // focus the length field so the default preference cannot silently become a
  // physical scale without explicit confirmation.
  useEffect(() => {
    const becamePending =
      !previousManualRulerPending.current && manualRulerPending;
    previousManualRulerPending.current = manualRulerPending;
    if (!becamePending) return;
    guideTo("scale");
    focusWhenReady.current = "length";
    setSectionEpoch((epoch) => epoch + 1);
  }, [manualRulerPending]);

  // The fourth corner ends canvas selection. Bring its review/apply controls
  // back into view, including when a compact inspector was hidden for drawing.
  useEffect(() => {
    const completed = previousPerspectiveCount.current < 4 && manualPerspectivePoints.length === 4;
    previousPerspectiveCount.current = manualPerspectivePoints.length;
    if (!completed) return;
    guideTo("scale");
    focusWhenReady.current = "scale";
    setSectionEpoch(epoch => epoch + 1);
  }, [manualPerspectivePoints.length]);

  // A usable manual scale advances only after reference-length confirmation.
  // An automatically detected scale is likewise incomplete until accepted.
  useEffect(() => {
    const complete = scale.mmPerPx !== null;
    const becameComplete = !previousScaleComplete.current && complete;
    previousScaleComplete.current = complete;
    if (!becameComplete || outline.length > 0 || region) return;
    dispatch({ type: "SET_MODE", mode: "region" });
    guideTo("region");
    focusWhenReady.current = "region";
    setSectionEpoch((epoch) => epoch + 1);
  }, [scale.mmPerPx, outline.length, region, dispatch]);

  // Re-entering ruler placement (including perspective-only correction) must
  // reveal its instructions. A committed region advances to detection without
  // reacting to temporary rectangles emitted during the drag itself.
  useEffect(() => {
    const rulerStarted =
      previousMode.current !== "calibrate" && store.mode === "calibrate";
    const regionCommitted =
      previousMode.current === "region" && store.mode === "pan" && region !== null;
    previousMode.current = store.mode;
    if (rulerStarted) {
      // Keep a compact canvas accessible while placing points; their length
      // confirmation will reveal the inspector when the ruler is complete.
      guideTo("scale", false);
      focusWhenReady.current = "ruler";
      setSectionEpoch((epoch) => epoch + 1);
      return;
    }
    if (!regionCommitted) return;
    guideTo("detection");
    focusWhenReady.current = "detection";
    setSectionEpoch((epoch) => epoch + 1);
  }, [region, store.mode]);

  // Sheet detection is a review step: reopen Scale and focus the explicit
  // acceptance action instead of silently advancing the workflow.
  useEffect(() => {
    const pending = pendingAutoCalibration !== null;
    const becamePending = !previousAutoPending.current && pending;
    previousAutoPending.current = pending;
    if (!becamePending) return;
    guideTo("scale");
    focusWhenReady.current = "auto";
    setSectionEpoch((epoch) => epoch + 1);
  }, [pendingAutoCalibration]);

  useLayoutEffect(() => {
    const requested = focusWhenReady.current;
    if (!active || !requested || imageSize.width === 0) return;
    const sectionId =
      requested === "detection"
        ? "trace-settings-detect"
        : requested === "region"
          ? "trace-settings-crop"
          : "trace-settings-scale";
    const section = document.getElementById(sectionId);
    const focusTarget: HTMLElement | null | undefined =
      requested === "auto"
        ? section?.querySelector<HTMLButtonElement>(
            '[data-testid="button-correct-perspective-aid-scale"], [data-testid="button-apply-auto-perspective"], [data-testid="button-accept-auto-scale"]',
          )
        : requested === "ruler"
          ? section?.querySelector<HTMLButtonElement>('[data-testid="button-set-scale"]')
          : requested === "length"
            ? section?.querySelector<HTMLInputElement>("#ruler-length")
            : section?.querySelector<HTMLElement>(
                "[data-panel-section-trigger]",
              ) ?? section;
    if (!section || !focusTarget) return;
    focusWhenReady.current = null;
    focusTarget.focus({ preventScroll: true });
    if (requested === "length" && focusTarget instanceof HTMLInputElement) {
      focusTarget.select();
    }

    const contextSelector = requested === "auto"
      ? '[data-testid="auto-calibration-options"]'
      : requested === "ruler"
        ? '[data-testid="manual-scale-placement"]'
        : requested === "length"
          ? '[data-testid="reference-length-setting"]'
          : null;
    const context = contextSelector ? section.querySelector<HTMLElement>(contextSelector) : section;
    return revealTraceStep(section, focusTarget, context ?? focusTarget);
  }, [active, guidedSection, imageSize.width, sectionEpoch, inspector?.activeSection, inspector?.settings]);

  const shapeLibrary = useShapeLibrary();
  const [, navigate] = useLocation();

  const manualPerspectiveProposal: PerspectiveProposal | null =
    manualPerspectivePoints.length === 4 &&
    validPerspectiveQuad(manualPerspectivePoints)
      ? {
          source: "manual",
          points: manualPerspectivePoints as PerspectiveQuad,
        }
      : null;

  const [handoffOpen, setHandoffOpen] = useState(false);
  const openHandoff = () => setHandoffOpen(true);
  const handleClearRegion = () => {
    dispatch({ type: "SET_MODE", mode: "region" });
    onCanvasInteraction?.();
    dispatch({ type: "SET_REGION", region: null });
    guideTo("region");
    focusWhenReady.current = "region";
    setSectionEpoch((epoch) => epoch + 1);
  };

  const handleSetScale = () => {
    const nextMode = store.mode === "calibrate" ? "pan" : "calibrate";
    dispatch({
      type: "SET_MODE",
      mode: nextMode,
    });
    if (nextMode === "calibrate") onCanvasInteraction?.();
  };

  const manualScaleAction = (
    <Button
      variant={store.mode === "calibrate" ? "default" : "outline"}
      size="sm"
      className={cn(
        RESPONSIVE_PANEL_ACTION,
        imageSize.width > 0 &&
          !calibration &&
          !pendingAutoCalibration &&
          !manualRulerPending &&
          store.mode !== "calibrate" &&
          "animate-pulse motion-reduce:animate-none",
      )}
      data-testid="button-set-scale"
      disabled={!hasImage}
      onClick={handleSetScale}
    >
      {store.mode === "calibrate"
        ? "Placing ruler"
        : manualRulerPending
          ? "Redraw ruler"
          : pendingAutoCalibration
            ? "Set manually instead"
            : "Set scale"}
    </Button>
  );

  return (
    <div className="flex h-full flex-col [container-type:inline-size]">
      {inspector ? <header className="min-h-14 shrink-0 border-b py-2 pl-3 pr-12">
        <h2 className="text-sm font-semibold">Photo tracing</h2>
        <p className="text-xs text-muted-foreground">From photo to pocket</p>
      </header> : <PanelSettingsIndex
        ariaLabel="Find trace settings"
        testIdPrefix="trace"
        items={traceSettingsSections}
      />}
      <TracePanelSections key={sectionEpoch}>
        <PanelSection
          key={hasImage ? "source-ready" : "source-empty"}
          id="trace-settings-source"
          title="Photo"
          icon={ImageIcon}
          tone="slate"
          summary={hasImage ? fileName || "Loaded" : "No image"}
          defaultOpen={!hasImage}
          className="scroll-mt-16"
        >
          {store.draftSaveStatus !== "disabled" && store.draftSaveStatus !== "empty" && !(hasImage && store.draftSaveStatus === "error") && (
            <p role="status" className={cn("text-xs", store.draftSaveStatus === "error" ? "text-destructive" : "text-muted-foreground")}>
              {store.draftSaveStatus === "loading" ? "Restoring trace draft…"
                : store.draftSaveStatus === "saving" ? "Saving trace draft…"
                : store.draftSaveStatus === "error" ? "Couldn’t restore the saved trace. Choose a photo to start again."
                : "Trace draft saved in this browser"}
            </p>
          )}
          {hasImage ? (
            <>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="truncate font-medium text-foreground">
                  {fileName || "Source image"}
                </div>
                <div>
                  {imageSize.width} × {imageSize.height} px
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full"
                onClick={onReplaceImage} data-testid="button-source-image">
                Choose source image
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={processing}
                  onClick={() => onRotateImage("counterclockwise")}
                  data-testid="button-rotate-image-counterclockwise"
                >
                  <RotateCcw className="h-4 w-4" />
                  Rotate left 90°
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={processing}
                  onClick={() => onRotateImage("clockwise")}
                  data-testid="button-rotate-image-clockwise"
                >
                  <RotateCw className="h-4 w-4" />
                  Rotate right 90°
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Choose or drop an image in the workspace to begin.
            </div>
          )}
        </PanelSection>

        <PanelSection
          key={`${hasImage ? "scale-ready" : "scale-empty"}-${pendingAutoCalibration ? "pending" : calibration ? "set" : "unset"}`}
          id="trace-settings-scale"
          title="Scale"
          icon={Scaling}
          tone="amber"
          summary={
            pendingAutoCalibration
              ? "Review auto scale"
              : (calibrationSource === "sheet" || calibrationSource === "strip") && scale.mmPerPx
                ? `${calibrationSource === "strip" ? "Strip" : "Sheet"} · ${scale.mmPerPx.toFixed(3)} mm/px`
                : scale.mmPerPx
                  ? `${scale.mmPerPx.toFixed(3)} mm/px`
                  : "Not set"
          }
          defaultOpen={
            guidedSection === "scale" ||
            (guidedSection === null && imageSize.width > 0)
          }
          className="scroll-mt-16"
          disabled={!hasImage}
        >
          {pendingAutoCalibration && <AutoCalibrationOptions
            onSetManually={handleSetScale} onApplyPerspective={onApplyPerspective} onDetectMarkers={onDetectMarkers}
          />}

          {!pendingAutoCalibration && (
            <div className="space-y-3" data-testid="manual-scale-placement">
              {manualScaleAction}

              {store.mode === "calibrate" ? (
                <div
                  role="status"
                  data-testid="manual-scale-guidance"
                  className="flex gap-2 rounded-md border border-rose-500/60 bg-rose-500/10 p-3 text-rose-900 ring-2 ring-rose-500/20 dark:text-rose-100"
                >
                  <Scaling className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      Set scale manually:
                    </p>
                    <p className="text-xs leading-relaxed">
                      Select two points on the image that are a known distance
                      apart. Zoom in first for more precise placement.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {!pendingAutoCalibration && (!calibration || calibrationSource === "manual") && (
            <div
              className={cn(
                "space-y-1.5 rounded-md",
                manualRulerPending &&
                  "border border-amber-500/60 bg-amber-500/10 p-2 ring-2 ring-amber-500/30",
              )}
              data-testid="reference-length-setting"
            >
              <Label
                htmlFor="ruler-length"
                className={cn(
                  "text-xs",
                  manualRulerPending &&
                    "font-semibold text-amber-800 dark:text-amber-200",
                )}
              >
                Reference length (mm)
              </Label>
              <RulerLengthInput id="ruler-length" disabled={!hasImage} />
              {manualRulerPending ? (
                <p
                  id="reference-length-guidance"
                  className="text-[11px] font-medium text-amber-800 dark:text-amber-200"
                >
                  Ruler placed. Enter its real length, then press Enter or
                  Confirm scale.
                </p>
              ) : null}
            </div>
          )}

          {!pendingAutoCalibration && (
            <p className="text-[11px] text-muted-foreground">
              {displayedScale.mmPerPx === null ? "Scale not set — only SVG can export in image pixels" : describeScale(displayedScale)}
            </p>
          )}

          {!pendingAutoCalibration && (calibrationSource === "sheet" || calibrationSource === "strip") && calibration && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {calibrationSource === "strip"
                ? "Reference-strip scale accepted"
                : "Calibration-sheet scale accepted"}
            </p>
          )}

          {!pendingAutoCalibration && calibration && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => dispatch({ type: "SET_CALIBRATION", calibration: null })}
            >
              Clear scale
            </Button>
          )}

          {!pendingAutoCalibration && (!usingReferenceStrip || perspectiveCorrection) && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ScanLine className="h-4 w-4 text-amber-600" />
                Perspective correction
              </div>
              {perspectiveCorrection ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Corrected from{" "}
                    {perspectiveCorrection.source === "template"
                      ? "four template markers"
                      : "four manually selected page corners"}{" "}
                    using{" "}
                    {templateDisplayName(
                      perspectiveCorrection.template ?? perspectiveCorrection.paper,
                    )}{" "}
                    dimensions.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!perspectiveOriginalImageUrl}
                    onClick={requestRestoreSource}
                    data-testid="button-restore-perspective-source"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restore original photo
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    The four Pocketry v2 signature markers identify A4 or US Letter
                    automatically. Stock or incomplete marker sets are rejected. If
                    the markers are unavailable, select the four visible paper corners:
                    top-left, top-right, bottom-right, then bottom-left.
                  </p>
                  {!pendingPerspective && (
                    <div className="space-y-1.5">
                      <Label htmlFor="manual-perspective-paper" className="text-xs">
                        Paper size for manual fallback
                      </Label>
                      <Select
                        value={perspectivePaper ?? undefined}
                        onValueChange={(value) =>
                          setPerspectivePaper(value as TemplatePaper)
                        }
                      >
                        <SelectTrigger
                          id="manual-perspective-paper"
                          className="w-full"
                        >
                          <SelectValue placeholder="Choose A4 or US Letter" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="a4">A4</SelectItem>
                          <SelectItem value="letter">US Letter</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    variant={store.mode === "perspective" ? "default" : "outline"}
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      onCanvasInteraction?.();
                      dispatch({
                        type: store.mode === "perspective" ? "CANCEL_PERSPECTIVE_SELECTION" : "START_PERSPECTIVE_SELECTION",
                      });
                    }}
                    data-testid="button-select-perspective-points"
                  >
                    {store.mode === "perspective"
                      ? `Cancel · corner ${manualPerspectivePoints.length + 1} of 4`
                      : manualPerspectivePoints.length === 4
                        ? "Reselect page corners"
                        : "Select four page corners"}
                  </Button>
                  {manualPerspectivePoints.length > 0 && (
                    <p className="text-[11px] text-muted-foreground" role="status">
                      {manualPerspectivePoints.length < 4
                        ? `${manualPerspectivePoints.length} of 4 corners selected.`
                        : manualPerspectiveProposal
                          ? "Four corners selected. Drag a numbered marker to refine it, or apply the correction."
                          : "The selected points cross or collapse. Reselect the corners in clockwise order."}
                    </p>
                  )}
                  {manualPerspectiveProposal && (
                    <>

                    <Button
                      size="sm"
                      className="w-full"
                      disabled={processing || perspectivePaper === null}
                      onClick={() => {
                        if (perspectivePaper) {
                          onApplyPerspective(
                            manualPerspectiveProposal,
                            perspectivePaper,
                          );
                        }
                      }}
                      data-testid="button-apply-manual-perspective"
                    >
                      Apply perspective correction
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={RESPONSIVE_PANEL_ACTION}
                      disabled={processing || perspectivePaper === null}
                      onClick={() => {
                        if (perspectivePaper) {
                          onApplyPerspective(manualPerspectiveProposal, perspectivePaper, false);
                        }
                      }}
                      data-testid="button-correct-manual-perspective-only"
                    >
                      Correct perspective only
                    </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {!pendingAutoCalibration && <details className="text-xs" data-testid="manual-calibration-advanced">
            <summary className="min-h-9 cursor-pointer rounded py-2 font-medium [@media(pointer:coarse)]:min-h-11">Advanced</summary>
            <Button variant="outline" size="sm" className="w-full" disabled={!hasImage || processing}
              onClick={onDetectMarkers} data-testid="button-detect-markers">Detect references again</Button>
          </details>}
          <CalibrationDownloads onPaperSelected={setPerspectivePaper} />
        </PanelSection>

        <PanelSection
          key={region ? "crop-set" : "crop-empty"}
          id="trace-settings-crop"
          title="Region"
          icon={Crop}
          tone="rose"
          summary={region ? `${Math.round(region.width)} × ${Math.round(region.height)}` : "Not set"}
          defaultOpen={guidedSection === "region" || (guidedSection === null && region !== null)}
          attention={guidedSection === "region"}
          className="scroll-mt-16"
          disabled={!scale.mmPerPx || reviewingScale}
        >
          <TracePhotoBoundsControl />
          {region ? (
            <p className="text-xs text-muted-foreground">
              {Math.round(region.width)} × {Math.round(region.height)} px at{" "}
              {Math.round(region.x)}, {Math.round(region.y)}
            </p>
          ) : store.mode === "region" ? (
            <div
              role="status"
              data-testid="detection-region-guidance"
              className="flex gap-2 rounded-md border border-rose-500/60 bg-rose-500/10 p-3 text-rose-900 ring-2 ring-rose-500/20 dark:text-rose-100"
            >
              <Crop className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs font-medium">Click and drag around the tool.</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Choose Set region, then draw a box around the entire tool.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={store.mode === "region" ? "default" : "outline"}
              size="sm"
              disabled={!scale.mmPerPx || reviewingScale}
              aria-pressed={store.mode === "region"}
              data-testid="button-set-region"
              onClick={() => { dispatch({ type: "SET_MODE", mode: "region" }); onCanvasInteraction?.(); }}
            >
              Set region
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={region === null}
              data-testid="button-clear-region"
              onClick={handleClearRegion}
            >
              Clear region
            </Button>
          </div>
        </PanelSection>

        <PanelSection
          key={hasImage ? "detect-ready" : "detect-empty"}
          id="trace-settings-detect"
          title="Outline"
          icon={Settings2}
          tone="blue"
          summary={
            sensitivity === 128
              ? "Auto"
              : sensitivity > 128
                ? `+${sensitivity - 128}`
                : `${sensitivity - 128}`
          }
          defaultOpen={
            guidedSection === "detection" ||
            (guidedSection === null &&
              sectionEpoch === 0 &&
              imageSize.width > 0 &&
              !hasOutline)
          }
          attention={guidedSection === "detection"}
          className="scroll-mt-16"
          disabled={!scale.mmPerPx || !hasDetectionRegion || reviewingScale}
        >
          <TraceDetectionControls onReprocess={onReprocess} />

          <div className="space-y-1.5" data-testid="detection-contours">
            <div className="flex items-center gap-1">
              <p className="text-xs font-semibold">Contours</p>
              <HelpHint label="contour editing">
                Choose Edit contours. Drag a point to move it; click an edge to add one. On a phone, use Move, Add, or Remove and pinch to zoom.
                Simplification adjusts your edited contour. Sensitivity and interior holes re-detect from the photo and ask before replacing manual edits. Undo restores your contour.
              </HelpHint>
            </div>
            <RingList />
          </div>
        </PanelSection>

        <PanelSection
          id="trace-settings-margin"
          title="Margin"
          icon={Expand}
          tone="violet"
          summary={margin ? `${margin.toFixed(1)} mm` : "No margin"}
          defaultOpen={false}
          className="scroll-mt-16"
          disabled={!hasOutline || !scale.mmPerPx || reviewingScale}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="margin" className="text-xs">Offset (mm)</Label>
              <HelpHint label="trace margin">
                Adds space around the edited outline without re-detecting it. Changes can be undone.
                Bin clearance is added on top of this trace margin. Leave this at zero to adjust fit in the bin designer.
              </HelpHint>
            </div>
            <Select
              value={scale.mmPerPx && margin !== null ? String(margin) : undefined}
              onValueChange={(value) => handleMarginChange(Number(value))}
              disabled={!scale.mmPerPx}
            >
              <SelectTrigger id="margin" className="w-full">
                <SelectValue
                  placeholder={scale.mmPerPx ? "Select margin" : "Set scale first"}
                />
              </SelectTrigger>
              <SelectContent>
                {MARGIN_MM_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value === 0 ? "0 mm — no margin" : `${value.toFixed(1)} mm`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" className="w-full" disabled={!margin}
            data-testid="button-reset-margin" onClick={() => handleMarginChange(0)}>Reset to zero</Button>
        </PanelSection>

        <PanelSection
          id="trace-settings-output"
          title="Export outline"
          icon={Download}
          tone="emerald"
          summary={exportFormat.toUpperCase()}
          defaultOpen={false}
          className="scroll-mt-16"
          disabled={!hasOutline || reviewingScale}
        >
          <div className="space-y-2">
            <Label htmlFor="format" className="text-xs">
              Export format
            </Label>
            <Select
              value={exportFormat}
              onValueChange={(value) =>
                dispatch({
                  type: "SET_EXPORT_FORMAT",
                  exportFormat: value as ExportFormat,
                })
              }
            >
              <SelectTrigger id="format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="svg">{scale.mmPerPx ? "SVG — vector outline" : "SVG — image pixels (unscaled)"}</SelectItem>
                <SelectItem value="dxf" disabled={!scale.mmPerPx}>DXF — CAD / CAM</SelectItem>
                <SelectItem value="dwg" disabled={!scale.mmPerPx}>DWG — AutoCAD</SelectItem>
                <SelectItem value="stl" disabled={!scale.mmPerPx}>STL — 3D print</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Inline rather than hidden behind a popover: it changes the
              exported part, so it should be visible when STL is chosen. */}
          {exportFormat === "stl" && (
            <LabelledSlider
              id="extrusion"
              label="Extrusion height"
              value={extrusionHeight}
              min={0.5}
              max={50}
              step={0.5}
              format={(v) => `${v} mm`}
              onChange={(v) =>
                dispatch({ type: "SET_EXTRUSION_HEIGHT", extrusionHeight: v })
              }
            />
          )}
        </PanelSection>
      </TracePanelSections>

      <AlertDialog open={restoreSourceRevision === sourceRevision} onOpenChange={(open) => { if (!open) setRestoreSourceRevision(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the original photo and clear this trace?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the perspective correction, scale, region, contours and their edit history.
              You cannot undo this reset. Pockets already added to Bin stay there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setRestoreSourceRevision(null); dispatch({ type: "RESTORE_PERSPECTIVE_SOURCE" }); }}>
              Restore and clear trace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {handoffOpen && <TraceHandoffDialog onClose={() => setHandoffOpen(false)}
        onChoosePhoto={onReplaceImage} onCanvasInteraction={onCanvasInteraction} />}
      <PanelFooter>
        {shapeLibrary.pendingIds.length > 0 && <Button variant="secondary" className="mb-2 w-full" onClick={() => navigate("/bin")}>
          Arrange {shapeLibrary.pendingIds.length} queued tool{shapeLibrary.pendingIds.length === 1 ? "" : "s"}
        </Button>}
        <div className="grid grid-cols-2 gap-2 [&_button]:h-auto [&_button]:min-h-10 [&_button]:whitespace-normal [&_button]:px-2 [&_button]:leading-tight">
          {/* The trace → bin handoff. Disabled without a calibration: an
              uncalibrated outline has no physical size, and letting it into
              the bin is the design doc's most expensive footgun. The tooltip
              rides a wrapper span because disabled buttons emit no events. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full">
                <Button
                  className="w-full"
                  onClick={openHandoff}
                  disabled={!hasOutline || !scale.mmPerPx || reviewingScale}
                  data-testid="button-add-to-bin"
                >
                  <Box className="h-4 w-4" />
                  Add to bin
                </Button>
              </span>
            </TooltipTrigger>
            {(!hasOutline || !scale.mmPerPx) && (
              <TooltipContent>
                {hasOutline
                  ? "Set a scale first — pockets need real-world millimetres."
                  : "Trace an image first."}
              </TooltipContent>
            )}
          </Tooltip>

          <Button
            variant="outline"
            className="w-full"
            onClick={onExport}
            disabled={!hasOutline || reviewingScale || (!scale.mmPerPx && exportFormat !== "svg")}
          >
            <Download className="h-4 w-4" />
            Save {exportFormat.toUpperCase()}{!scale.mmPerPx && exportFormat === "svg" ? " (pixels)" : ""}
          </Button>
        </div>
        {hasOutline && !scale.mmPerPx && <p className="mt-2 text-xs text-muted-foreground">Set scale for STL, DXF or DWG. Choose SVG in Export to save image pixels without a physical size.</p>}
      </PanelFooter>
    </div>
  );
}
