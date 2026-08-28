import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  CheckCircle2,
  Crop,
  Download,
  Image as ImageIcon,
  Ruler,
  RotateCcw,
  ScanLine,
  ScanSearch,
  Sparkles,
  Settings2,
} from "lucide-react";
import { useLocation } from "wouter";

import {
  calibrationFromDraft,
  hasCalibrationEndpoints,
} from "@shared/geometry/scale";

import {
  PanelBody,
  PanelFooter,
  PanelSection,
  PanelSettingsIndex,
} from "@/components/layout/panel-section";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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
import { downloadCalibrationTemplate } from "@/lib/calibrate/download-template";
import type { TemplatePaper } from "@/lib/calibrate/template";
import { describeScale, exportScale } from "@/lib/export/scale";
import { normalizeTracedShape } from "@/lib/gridfinity/traced-shape";
import {
  adjustOutlineMargin,
  MARGIN_MM_OPTIONS,
} from "@/lib/image-processor";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useShapeLibrary } from "@/state/shape-library";
import { useTrace, type ExportFormat } from "@/state/trace-store";

import { RingList } from "./ring-list";

const RESPONSIVE_PANEL_ACTION =
  "h-auto min-h-9 w-full whitespace-normal break-words px-2 py-2 text-[clamp(0.75rem,4cqw,0.875rem)] leading-tight";

export interface TraceControlsPanelProps {
  onReplaceImage: () => void;
  onExport: () => void;
  onReprocess: () => void;
  /** Re-run ArUco marker detection on the full frame, with feedback. */
  onDetectMarkers: () => void;
  /** Rectify the selected paper plane and replace the working image. */
  onApplyPerspective: (
    proposal: PerspectiveProposal,
    paper: TemplatePaper,
  ) => void;
}

const TRACE_SETTINGS_SECTION_DETAILS = [
  { id: "trace-settings-source", label: "Source", tone: "slate" },
  { id: "trace-settings-scale", label: "Scale", tone: "amber" },
  { id: "trace-settings-crop", label: "Region", tone: "rose" },
  { id: "trace-settings-detect", label: "Tool Detection", tone: "blue" },
  {
    id: "trace-settings-output",
    label: "Change Output Format",
    tone: "emerald",
  },
] as const;

/**
 * Everything that used to sit above or below the canvas, moved into the side
 * panel so the canvas gets the whole working area.
 *
 * Sections are plain collapsibles rather than cards: in a ~300px panel, nested
 * card padding and borders waste roughly a tenth of the usable width.
 */
export function TraceControlsPanel({
  onReplaceImage,
  onExport,
  onReprocess,
  onDetectMarkers,
  onApplyPerspective,
}: TraceControlsPanelProps): JSX.Element {
  const store = useTrace();
  const {
    dispatch,
    imageUrl,
    sourceRevision,
    imageSize,
    fileName,
    outline,
    calibration,
    pendingAutoCalibration,
    calibrationSource,
    draftCalibration,
    rulerLengthMm,
    pendingPerspective,
    manualPerspectivePoints,
    perspectiveCorrection,
    perspectiveOriginalImageUrl,
    region,
    sensitivity,
    tolerancePx,
    smoothing,
    margin,
    exportFormat,
    extrusionHeight,
    processing,
  } = store;
  const { toast } = useToast();

  const scale = exportScale(calibration, imageSize.height);
  const displayedScale = exportScale(
    pendingAutoCalibration ?? calibration,
    imageSize.height,
  );
  const hasImage = imageSize.width > 0;
  const hasOutline = outline.length > 0;
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
        disabled: !scale.mmPerPx,
        disabledReason: hasImage
          ? "Set the scale first"
          : "Choose a source image first",
      };
    }
    if (item.id === "trace-settings-detect") {
      return {
        ...item,
        disabled: !scale.mmPerPx || !hasDetectionRegion,
        disabledReason: !hasImage
          ? "Choose a source image first"
          : !scale.mmPerPx
            ? "Set the scale first"
            : "Set a detection region first",
      };
    }
    return {
      ...item,
      disabled: !scale.mmPerPx || !hasOutline,
      disabledReason: !hasImage
        ? "Choose a source image first"
        : !scale.mmPerPx
          ? "Set the scale first"
          : "Detect a tool first",
    };
  });
  const [sectionEpoch, setSectionEpoch] = useState(0);
  const [guidedSection, setGuidedSection] = useState<
    "scale" | "region" | "detection" | null
  >(null);
  const [calibrationSheetOpen, setCalibrationSheetOpen] = useState(false);
  // The template marker family identifies paper automatically. A markerless
  // four-corner fallback still needs the printed paper's dimensions.
  const [perspectivePaper, setPerspectivePaper] =
    useState<TemplatePaper | null>(null);
  const previousSourceRevision = useRef(sourceRevision);
  const previousScaleComplete = useRef(scale.mmPerPx !== null);
  const previousAutoPending = useRef(pendingAutoCalibration !== null);
  const previousManualRulerPending = useRef(manualRulerPending);
  const previousMode = useRef(store.mode);
  const focusWhenReady = useRef<
    "scale" | "auto" | "length" | "region" | "detection" | null
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
    setGuidedSection(imageUrl === null ? null : "scale");
    focusWhenReady.current = imageUrl === null ? null : "scale";
    setSectionEpoch((epoch) => epoch + 1);
  }, [imageUrl, sourceRevision]);

  // Two placed endpoints are still only a pixel ruler. Keep Scale open and
  // focus the length field so the default preference cannot silently become a
  // physical scale without explicit confirmation.
  useEffect(() => {
    const becamePending =
      !previousManualRulerPending.current && manualRulerPending;
    previousManualRulerPending.current = manualRulerPending;
    if (!becamePending) return;
    setGuidedSection("scale");
    focusWhenReady.current = "length";
    setSectionEpoch((epoch) => epoch + 1);
  }, [manualRulerPending]);

  // A usable manual scale advances only after reference-length confirmation.
  // An automatically detected scale is likewise incomplete until accepted.
  useEffect(() => {
    const complete = scale.mmPerPx !== null;
    const becameComplete = !previousScaleComplete.current && complete;
    previousScaleComplete.current = complete;
    if (!becameComplete) return;
    dispatch({ type: "SET_MODE", mode: "region" });
    setGuidedSection("region");
    focusWhenReady.current = "region";
    setSectionEpoch((epoch) => epoch + 1);
  }, [scale.mmPerPx, dispatch]);

  // The canvas returns to pointer mode when a valid detection region is
  // committed. That explicit transition advances the guided workflow without
  // reacting to the temporary rectangles emitted during the drag itself.
  useEffect(() => {
    const regionCommitted =
      previousMode.current === "region" && store.mode === "pan" && region !== null;
    previousMode.current = store.mode;
    if (!regionCommitted) return;
    setGuidedSection("detection");
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
    setGuidedSection("scale");
    focusWhenReady.current = "auto";
    setSectionEpoch((epoch) => epoch + 1);
  }, [pendingAutoCalibration]);

  useLayoutEffect(() => {
    const requested = focusWhenReady.current;
    if (!requested || imageSize.width === 0) return;
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
            '[data-testid="button-accept-auto-scale"]',
          )
        : requested === "length"
          ? section?.querySelector<HTMLInputElement>("#ruler-length")
          : section?.querySelector<HTMLButtonElement>(
              "[data-panel-section-trigger]",
            );
    if (!section || !focusTarget) return;
    focusWhenReady.current = null;
    focusTarget.focus({ preventScroll: true });
    if (requested === "length" && focusTarget instanceof HTMLInputElement) {
      focusTarget.select();
    }

    const frame = window.requestAnimationFrame(() => {
      section?.parentElement?.scrollTo?.({
        top: section.offsetTop,
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [guidedSection, imageSize.width, sectionEpoch]);

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

  const handleAddToBin = () => {
    const shape = normalizeTracedShape(outline, scale, fileName || "Traced tool");
    if (!shape) return;
    shapeLibrary.addShape(shape);
    navigate("/bin");
  };

  const handleClearRegion = () => {
    dispatch({ type: "SET_REGION", region: null });
    dispatch({ type: "SET_MODE", mode: "region" });
    setGuidedSection("region");
    focusWhenReady.current = "region";
    setSectionEpoch((epoch) => epoch + 1);
  };

  const handleSetScale = () => {
    if (manualRulerPending) {
      dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: null });
    }
    dispatch({
      type: "SET_MODE",
      mode: store.mode === "calibrate" ? "pan" : "calibrate",
    });
  };

  return (
    <div className="flex h-full flex-col [container-type:inline-size]">
      <PanelSettingsIndex
        ariaLabel="Find trace settings"
        testIdPrefix="trace"
        items={traceSettingsSections}
      />
      <PanelBody key={sectionEpoch}>
        <PanelSection
          key={hasImage ? "source-ready" : "source-empty"}
          id="trace-settings-source"
          title="Source image"
          icon={ImageIcon}
          tone="slate"
          summary={hasImage ? fileName || "Loaded" : "No image"}
          defaultOpen={!hasImage}
          className="scroll-mt-16"
        >
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
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onReplaceImage}
                data-testid="button-source-image"
              >
                Choose Source Image
              </Button>
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
          icon={Ruler}
          tone="amber"
          summary={
            pendingAutoCalibration
              ? "Review auto scale"
              : calibrationSource === "sheet" && scale.mmPerPx
                ? `Sheet · ${scale.mmPerPx.toFixed(3)} mm/px`
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
          {pendingAutoCalibration && (
            <div
              className="space-y-2 rounded-md border border-amber-400/50 bg-amber-500/10 p-3"
              role="status"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
                <Sparkles className="h-4 w-4" />
                Scale detected from the sheet
              </div>
              <p className="text-xs text-muted-foreground">
                Pocketry found {displayedScale.mmPerPx?.toFixed(3)} mm/px. Review
                the ruler on the image, then accept it to continue.
              </p>
              {pendingPerspective ? (
                <>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                    {pendingPerspective.paper === "a4" ? "A4" : "US Letter"}{" "}
                    template detected automatically
                  </p>
                  <Button
                    size="sm"
                    className={RESPONSIVE_PANEL_ACTION}
                    disabled={processing || !pendingPerspective.paper}
                    onClick={() =>
                      pendingPerspective.paper &&
                      onApplyPerspective(
                        pendingPerspective,
                        pendingPerspective.paper,
                      )
                    }
                    data-testid="button-apply-auto-perspective"
                  >
                    <ScanLine className="mr-1.5 h-4 w-4" />
                    Correct perspective &amp; use scale
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={RESPONSIVE_PANEL_ACTION}
                    onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION" })}
                    data-testid="button-accept-auto-scale"
                  >
                    Use scale without correction
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className={RESPONSIVE_PANEL_ACTION}
                  onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION" })}
                  data-testid="button-accept-auto-scale"
                >
                  Accept detected scale
                </Button>
              )}
            </div>
          )}

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

          {store.mode === "calibrate" ? (
            <div
              role="status"
              data-testid="manual-scale-guidance"
              className="flex gap-2 rounded-md border border-rose-500/60 bg-rose-500/10 p-3 text-rose-900 ring-2 ring-rose-500/20 dark:text-rose-100"
            >
              <Ruler className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  Auto Calibration Unsuccessful:
                </p>
                <p className="text-xs leading-relaxed">
                  Select two points on the image that are a known distance
                  apart. Zoom in first for more precise placement.
                </p>
              </div>
            </div>
          ) : null}

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
            <DraftNumberInput
              id="ruler-length"
              min={1}
              step="any"
              value={rulerLengthMm}
              disabled={!hasImage}
              aria-describedby={
                manualRulerPending ? "reference-length-guidance" : undefined
              }
              onValueChange={(value) =>
                dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: value })
              }
              onValueCommit={(value) => {
                const completed = calibrationFromDraft(
                  draftCalibration,
                  value,
                );
                if (completed) {
                  dispatch({ type: "SET_CALIBRATION", calibration: completed });
                }
              }}
            />
            {manualRulerPending ? (
              <p
                id="reference-length-guidance"
                className="text-[11px] font-medium text-amber-800 dark:text-amber-200"
              >
                Ruler placed. Enter its real length, then press Enter or leave
                this field.
              </p>
            ) : null}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {describeScale(displayedScale)}
          </p>

          {calibrationSource === "sheet" && calibration && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Calibration-sheet scale accepted
            </p>
          )}

          {(calibration || pendingAutoCalibration) && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => dispatch({ type: "SET_CALIBRATION", calibration: null })}
            >
              {pendingAutoCalibration ? "Dismiss detected scale" : "Clear scale"}
            </Button>
          )}

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
                  {perspectiveCorrection.paper === "a4" ? "A4" : "US Letter"}{" "}
                  dimensions.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!perspectiveOriginalImageUrl}
                  onClick={() => dispatch({ type: "RESTORE_PERSPECTIVE_SOURCE" })}
                  data-testid="button-restore-perspective-source"
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
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
                  onClick={() =>
                    dispatch({
                      type:
                        store.mode === "perspective"
                          ? "CANCEL_PERSPECTIVE_SELECTION"
                          : "START_PERSPECTIVE_SELECTION",
                    })
                  }
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
                )}
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Need a calibration sheet?{" "}
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2 hover:no-underline"
              onClick={() => {
                setPerspectivePaper("a4");
                downloadCalibrationTemplate("a4");
              }}
              data-testid="link-print-template-a4"
            >
              Print A4 PDF template
            </button>{" "}
            or{" "}
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2 hover:no-underline"
              onClick={() => {
                setPerspectivePaper("letter");
                downloadCalibrationTemplate("letter");
              }}
              data-testid="link-print-template-letter"
            >
              Print US Letter PDF template
            </button>
            .
          </p>

          <Dialog open={calibrationSheetOpen} onOpenChange={setCalibrationSheetOpen}>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-xs font-normal text-muted-foreground"
              onClick={() => setCalibrationSheetOpen(true)}
              data-testid="button-calibration-sheet-options"
            >
              Calibration sheet options
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Calibration sheet</DialogTitle>
                <DialogDescription>
                  Print the current v2 sheet once at 100%, then include it beneath
                  tools for automatic scale and perspective correction. Its custom
                  marker dictionary prevents stock ArUco sheets from being mistaken
                  for Pocketry; all four markers are required.
                </DialogDescription>
              </DialogHeader>
              <Button
                variant="outline"
                disabled={imageSize.width === 0}
                onClick={() => {
                  setCalibrationSheetOpen(false);
                  onDetectMarkers();
                }}
                data-testid="button-detect-markers"
              >
                <ScanSearch className="mr-1.5 h-4 w-4" />
                Detect sheet in this image
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={perspectivePaper === "a4" ? "default" : "outline"}
                  aria-pressed={perspectivePaper === "a4"}
                  onClick={() => {
                    setPerspectivePaper("a4");
                    downloadCalibrationTemplate("a4");
                  }}
                  data-testid="button-template-a4"
                >
                  Print A4 PDF
                </Button>
                <Button
                  variant={perspectivePaper === "letter" ? "default" : "outline"}
                  aria-pressed={perspectivePaper === "letter"}
                  onClick={() => {
                    setPerspectivePaper("letter");
                    downloadCalibrationTemplate("letter");
                  }}
                  data-testid="button-template-letter"
                >
                  Print US Letter PDF
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </PanelSection>

        <PanelSection
          key={region ? "crop-set" : "crop-empty"}
          id="trace-settings-crop"
          title="Set Detection Region"
          icon={Crop}
          tone="rose"
          summary={region ? `${Math.round(region.width)} × ${Math.round(region.height)}` : "Not set"}
          defaultOpen={guidedSection === "region" || (guidedSection === null && region !== null)}
          attention={guidedSection === "region"}
          className="scroll-mt-16"
          disabled={!scale.mmPerPx}
        >
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
              <div className="space-y-1">
                <p className="text-sm font-semibold">Draw a box around the tool</p>
                <p className="text-xs leading-relaxed">
                  Click and drag on the image to enclose the entire tool inside
                  the detection region.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Choose Set Region, then draw a box around the entire tool.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={store.mode === "region" ? "default" : "outline"}
              size="sm"
              disabled={!scale.mmPerPx}
              aria-pressed={store.mode === "region"}
              data-testid="button-set-region"
              onClick={() => dispatch({ type: "SET_MODE", mode: "region" })}
            >
              Set Region
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={region === null}
              data-testid="button-clear-region"
              onClick={handleClearRegion}
            >
              Clear Region
            </Button>
          </div>
        </PanelSection>

        <PanelSection
          key={hasImage ? "detect-ready" : "detect-empty"}
          id="trace-settings-detect"
          title="Tool Detection"
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
          disabled={!scale.mmPerPx || !hasDetectionRegion}
        >
          <div
            role="note"
            data-testid="detection-tuning-guidance"
            className="flex gap-2 rounded-md border border-rose-500/60 bg-rose-500/10 p-3 text-rose-900 ring-2 ring-rose-500/20 dark:text-rose-100"
          >
            <ScanSearch className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <p
                data-testid="contour-editing-guidance"
                className="text-base font-bold leading-snug"
              >
                Edit the contour shape: select a shape, then move, add, or delete
                its detected vertices.
              </p>
              <p className="text-xs leading-relaxed">
                Drag a vertex to move it, click to add one, or right-click a vertex
                to delete it. Adjust <strong>Sensitivity</strong> and{" "}
                <strong>Detail</strong> to fine-tune the contour. Remove any arrant
                holes / contours by clicking the trash can icon below.
              </p>
            </div>
          </div>

          {/*
            The threshold is chosen automatically; this biases it. 128 means
            "use the automatic level unchanged", which is why the control is
            labelled Sensitivity rather than Threshold.
          */}
          <LabelledSlider
            id="sensitivity"
            label="Sensitivity"
            value={sensitivity}
            min={0}
            max={255}
            step={1}
            format={(v) => (v === 128 ? "auto" : v > 128 ? `+${v - 128}` : `${v - 128}`)}
            onChange={(v) => dispatch({ type: "SET_SENSITIVITY", sensitivity: v })}
            onCommit={onReprocess}
            hint="Lower admits more of the image as tool."
          />

          {/* Detail and Smoothing re-derive from the cached dense outline, so
              they are instant and never re-run segmentation. */}
          <LabelledSlider
            id="detail"
            label="Detail"
            value={tolerancePx}
            min={0.1}
            max={8}
            step={0.1}
            format={(v) => `${v.toFixed(1)} px`}
            onChange={(v) => dispatch({ type: "SET_TOLERANCE", tolerancePx: v })}
            hint="How closely the outline follows the pixels."
          />

          <LabelledSlider
            id="smoothing"
            label="Smoothing"
            value={smoothing}
            min={0}
            max={5}
            step={1}
            format={(v) => (v === 0 ? "off" : `${v}`)}
            onChange={(v) => dispatch({ type: "SET_SMOOTHING", smoothing: v })}
            hint="Removes pixel noise; corners stay sharp."
          />

          <div className="space-y-1.5">
            <Label htmlFor="margin" className="text-xs">
              Margin
            </Label>
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
                    {value.toFixed(1)} mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Offsets the current edited contour without re-detecting it. Margin
              changes are saved in Edit history. Defaults to 1.5 mm.
            </p>
          </div>

          <div className="space-y-1.5" data-testid="detection-contours">
            <p className="text-xs font-semibold">Contours</p>
            <RingList />
          </div>
        </PanelSection>

        <PanelSection
          id="trace-settings-output"
          title="Change Output Format"
          icon={Download}
          tone="emerald"
          summary={exportFormat.toUpperCase()}
          defaultOpen={false}
          className="scroll-mt-16"
          disabled={!scale.mmPerPx || !hasOutline}
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
                <SelectItem value="svg">SVG — vector outline</SelectItem>
                <SelectItem value="dxf">DXF — CAD / CAM</SelectItem>
                <SelectItem value="dwg">DWG — AutoCAD</SelectItem>
                <SelectItem value="stl">STL — 3D print</SelectItem>
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
      </PanelBody>

      <PanelFooter>
        <div className="grid grid-cols-2 gap-2">
          {/* The trace → bin handoff. Disabled without a calibration: an
              uncalibrated outline has no physical size, and letting it into
              the bin is the design doc's most expensive footgun. The tooltip
              rides a wrapper span because disabled buttons emit no events. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full">
                <Button
                  className="w-full"
                  onClick={handleAddToBin}
                  disabled={!hasOutline || !scale.mmPerPx}
                  data-testid="button-add-to-bin"
                >
                  <Box className="mr-2 h-4 w-4" />
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
            disabled={!hasOutline}
          >
            <Download className="mr-2 h-4 w-4" />
            Save {exportFormat.toUpperCase()}
          </Button>
        </div>
      </PanelFooter>
    </div>
  );
}

interface LabelledSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  /** Fired on release, for anything too expensive to run per frame. */
  onCommit?: () => void;
  hint?: string;
  className?: string;
}

function LabelledSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
  hint,
  className,
}: LabelledSliderProps): JSX.Element {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) => onChange(values[0])}
        onValueCommit={onCommit}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
