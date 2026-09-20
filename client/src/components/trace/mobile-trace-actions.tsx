import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, SlidersHorizontal } from "lucide-react";

import { hasCalibrationEndpoints, type Calibration } from "@shared/geometry/scale";
import { WorkflowHint } from "@/components/canvas/workflow-hint";
import { MobileCanvasOverlay } from "@/components/layout/mobile-canvas-overlay";
import { MobileAdjustmentTray } from "@/components/layout/mobile-adjustment-tray";
import { useTraceRestartAction } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PerspectiveProposal } from "@/lib/calibrate/perspective";
import type { TemplateVariant } from "@/lib/calibrate/template";
import { useTrace } from "@/state/trace-store";
import { AutoCalibrationOptions } from "./auto-calibration-options";
import { TraceDetectionControls, type DetectionSettings } from "./trace-detection-controls";
import { RulerLengthInput } from "./ruler-length-input";

export interface MobileTraceActionsProps {
  onChoosePhoto: () => void;
  onAddToBin: () => void;
  onStartOver: () => void;
  onOpenSettings: (sectionId: string) => void;
  onApplyPerspective: (proposal: PerspectiveProposal, template: TemplateVariant, scale?: boolean | Calibration) => void;
  onDetectMarkers: () => void;
  onReprocess: (settings: DetectionSettings) => void;
}

type TraceStep = "photo" | "scale" | "region" | "outline";
const STEPS: TraceStep[] = ["photo", "scale", "region", "outline"];

/** Keep step navigation, guidance, and common adjustments beside the mobile canvas. */
export function MobileTraceActions({ onChoosePhoto, onAddToBin, onStartOver, onOpenSettings, onApplyPerspective, onDetectMarkers, onReprocess }: MobileTraceActionsProps): JSX.Element {
  const trace = useTrace();
  const { dispatch, pendingAutoCalibration, pendingPerspective, calibration, draftCalibration, processing } = trace;
  const [reviewStep, setReviewStep] = useState<"photo" | "scale" | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const requestRestart = useCallback(() => setRestartOpen(true), []);
  useTraceRestartAction(trace.imageUrl ? requestRestart : null);
  useEffect(() => { setReviewStep(null); setRestartOpen(false); }, [trace.sourceRevision]);
  useEffect(() => { if (trace.mode !== "pan" || pendingAutoCalibration) setReviewStep(null); }, [trace.mode, pendingAutoCalibration]);
  const manualPending = !calibration && hasCalibrationEndpoints(draftCalibration);
  const hasRegion = Boolean(trace.region && trace.region.width > 5 && trace.region.height > 5);
  const step: TraceStep = pendingAutoCalibration ? "scale" : reviewStep ?? (!calibration || trace.mode === "calibrate" || trace.mode === "perspective"
    ? "scale" : trace.mode === "region" || (!hasRegion && !trace.outline.length) ? "region" : "outline");
  useEffect(() => setAdjustOpen(false), [step, trace.sourceRevision]);
  const previousStep = STEPS[Math.max(0, STEPS.indexOf(step) - 1)];
  const actionClass = "min-h-11 flex-1 whitespace-normal leading-tight";
  const continueToRegion = () => { setReviewStep(null); dispatch({ type: "SET_MODE", mode: "region" }); };
  const redrawScale = () => { setReviewStep(null); dispatch({ type: "SET_MODE", mode: "calibrate" }); };
  const back = () => {
    if (pendingAutoCalibration) dispatch({ type: "DISMISS_AUTO_CALIBRATION" });
    if (step === "outline") dispatch({ type: "SET_MODE", mode: "region" });
    else {
      setReviewStep(step === "region" ? "scale" : "photo");
      // Reviewing an earlier step keeps the photo, accepted ruler, crop, and edits intact.
      dispatch({ type: "SET_MODE", mode: "pan" });
    }
  };

  if (!trace.imageUrl) {
    return <Button className="min-h-11 w-full" onClick={onChoosePhoto}>Choose a photo</Button>;
  }

  let guidance = "Set the photo's real size to continue.";
  if (step === "photo") guidance = "Keep this photo or choose a different one.";
  else if (processing) guidance = "Analyzing photo…";
  else if (step === "scale" && calibration) guidance = "Scale is set. Keep it or redraw the ruler.";
  else if (pendingAutoCalibration) guidance = "Scale detected. Check the ruler on the photo.";
  else if (manualPending) guidance = "Enter the real distance between the ruler points.";
  else if (trace.mode === "calibrate") guidance = "Tap two points a known distance apart.";
  else if (trace.mode === "perspective") guidance = `Tap the page corners clockwise (${trace.manualPerspectivePoints.length}/4).`;
  else if (trace.mode === "region") guidance = hasRegion
    ? "Keep this region or drag a new box around the tool." : "Drag a box around the whole tool to detect its outline.";
  else if (trace.mode === "navigate") guidance = "Drag to pan. Pinch or use + / − to zoom.";
  else if ((trace.mode === "edit" || trace.mode === "remove") && !trace.selection) guidance = "Tap a contour to select it for editing.";
  else if (trace.mode === "edit" || trace.mode === "remove") guidance = "Choose Move, Add, or Remove. Drag elsewhere to pan; pinch to zoom.";
  else if (calibration && trace.outline.length) guidance = "Choose Adjust to refine the outline, or Edit contours to move points.";
  else if (calibration && hasRegion) guidance = "No outline found. Adjust sensitivity or go back to redraw the region.";
  else if (calibration) guidance = "Select the tool's region to detect its outline.";

  const hasTuning = step === "outline" && (hasRegion || trace.outline.length > 0);
  const openFullSettings = (id: string) => { setAdjustOpen(false); onOpenSettings(id); };
  return <div data-testid="mobile-trace-actions">
    <span className="sr-only" data-testid="trace-current-step">{STEPS.indexOf(step) + 1} / 4 · {step}</span>
    <MobileCanvasOverlay>
      <WorkflowHint className="absolute left-2 right-2 top-16"
        hintKey={`${trace.sourceRevision}:${step}:${trace.mode === "edit" || trace.mode === "remove" ? "edit" : trace.mode === "navigate" ? "pan" : step}`}>
        {guidance}
      </WorkflowHint>
    </MobileCanvasOverlay>
    {hasTuning && adjustOpen && <MobileAdjustmentTray title="Adjust outline" onClose={() => setAdjustOpen(false)} onMore={() => openFullSettings("trace-settings-detect")}>
      <TraceDetectionControls compact onReprocess={onReprocess} />
      <Button variant="ghost" className="mt-1 h-11 w-full" onClick={() => openFullSettings("trace-settings-output")}>Export outline</Button>
    </MobileAdjustmentTray>}
    {step === "scale" && manualPending && !pendingAutoCalibration && !processing && <div className="mb-2 space-y-1" data-mobile-expanded="true">
      <label className="text-xs" htmlFor="mobile-ruler-length">Reference length (mm)</label>
      <RulerLengthInput id="mobile-ruler-length" />
    </div>}
    {step === "scale" && pendingAutoCalibration && <div className="mb-2 max-h-[35dvh] overflow-y-auto" data-mobile-expanded="true">
      <AutoCalibrationOptions onSetManually={redrawScale} onApplyPerspective={onApplyPerspective} onDetectMarkers={onDetectMarkers} />
    </div>}
    <div className="flex min-h-11 items-stretch gap-2" role="group" aria-label={`Trace actions: ${step}`}>
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={step === "photo" || processing} aria-label={`Back to ${previousStep}`} onClick={back}>
        <ChevronLeft aria-hidden className="h-4 w-4" /><span className="sr-only">Back</span>
      </Button>
      {step === "photo" ? <>
        <Button variant="outline" className={actionClass} onClick={onChoosePhoto}>Change photo</Button>
        <Button className={actionClass} onClick={() => setReviewStep("scale")}>Use this photo</Button>
      </> : step === "scale" && calibration && !pendingAutoCalibration ? <>
        <Button variant="outline" className={actionClass} onClick={redrawScale}>Redraw scale</Button>
        <Button className={actionClass} onClick={continueToRegion}>Use this scale</Button>
      </> : <>
        <Button variant="outline" className="min-h-11 gap-1.5 px-3" aria-expanded={hasTuning ? adjustOpen : undefined} onClick={() => {
          if (hasTuning) setAdjustOpen(open => !open);
          else openFullSettings(!calibration ? "trace-settings-scale" : "trace-settings-detect");
        }}><SlidersHorizontal className="h-4 w-4" aria-hidden />Adjust</Button>
        {!processing && !pendingAutoCalibration && !calibration && !manualPending ? <Button className={actionClass} onClick={() => {
          if (trace.mode === "perspective") openFullSettings("trace-settings-scale"); else redrawScale();
        }}>{trace.mode === "perspective" ? "Review corners" : "Set scale"}</Button>
        : !processing && !pendingAutoCalibration && step === "region" && hasRegion ? <Button className={actionClass} onClick={() => dispatch({ type: "SET_MODE", mode: trace.outline.length ? "edit" : "pan" })}>Keep this region</Button>
        : !processing && !pendingAutoCalibration && step === "outline" && trace.outline.length > 0 ? <Button className={actionClass} onClick={onAddToBin}>Add to bin</Button>
        : !processing && !pendingAutoCalibration && calibration && trace.mode !== "region" ? <Button className={actionClass} onClick={continueToRegion}>Draw tool region</Button>
        : <span className="flex min-w-0 flex-1 items-center justify-end text-xs text-muted-foreground">{processing ? "Analyzing…" : step === "region" ? "Draw tool region" : "Review scale"}</span>}
      </>}
    </div>
    <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Start a new trace?</DialogTitle>
          <DialogDescription>This clears the current photo, scale, region, and contour edits. Pockets already added to Bin stay there.</DialogDescription>
        </DialogHeader>
        <Button variant="destructive" onClick={() => { setRestartOpen(false); onStartOver(); }}>Clear trace and start over</Button>
        <Button variant="outline" onClick={() => setRestartOpen(false)}>Keep working</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
