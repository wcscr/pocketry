import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { calibrationFromDraft, hasCalibrationEndpoints, type Calibration } from "@shared/geometry/scale";
import { OUTER_RING } from "@shared/geometry/types";
import { getRing } from "@/lib/geometry/outline";
import { ContourEditTools } from "@/components/canvas/contour-edit-tools";
import { WorkflowHint } from "@/components/canvas/workflow-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PerspectiveProposal } from "@/lib/calibrate/perspective";
import type { TemplateVariant } from "@/lib/calibrate/template";
import { useTrace } from "@/state/trace-store";
import { AutoCalibrationOptions } from "./auto-calibration-options";
import { TraceDetectionControls, type DetectionSettings } from "./trace-detection-controls";

export interface MobileTraceActionsProps {
  onChoosePhoto: () => void;
  onStartOver: () => void;
  onOpenSettings: (sectionId: string) => void;
  onApplyPerspective: (proposal: PerspectiveProposal, template: TemplateVariant, scale?: boolean | Calibration) => void;
  onDetectMarkers: () => void;
  onReprocess: (settings: DetectionSettings) => void;
}

type TraceStep = "photo" | "scale" | "region" | "outline";
const STEPS: TraceStep[] = ["photo", "scale", "region", "outline"];

/** Keep step navigation, guidance, and common adjustments beside the mobile canvas. */
export function MobileTraceActions({ onChoosePhoto, onStartOver, onOpenSettings, onApplyPerspective, onDetectMarkers, onReprocess }: MobileTraceActionsProps): JSX.Element {
  const trace = useTrace();
  const { dispatch, pendingAutoCalibration, pendingPerspective, calibration, draftCalibration, processing } = trace;
  const [length, setLength] = useState(String(trace.rulerLengthMm));
  const [reviewStep, setReviewStep] = useState<"photo" | "scale" | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  useEffect(() => setLength(String(trace.rulerLengthMm)), [trace.rulerLengthMm]);
  useEffect(() => { setReviewStep(null); setRestartOpen(false); }, [trace.sourceRevision]);
  useEffect(() => { if (trace.mode !== "pan" || pendingAutoCalibration) setReviewStep(null); }, [trace.mode, pendingAutoCalibration]);
  const manualPending = !calibration && hasCalibrationEndpoints(draftCalibration);
  const confirmedRuler = calibrationFromDraft(draftCalibration, Number(length));
  const hasRegion = Boolean(trace.region && trace.region.width > 5 && trace.region.height > 5);
  const step: TraceStep = pendingAutoCalibration ? "scale" : reviewStep ?? (!calibration || trace.mode === "calibrate" || trace.mode === "perspective"
    ? "scale" : trace.mode === "region" || (!hasRegion && !trace.outline.length) ? "region" : "outline");
  const previousStep = STEPS[Math.max(0, STEPS.indexOf(step) - 1)];
  const editingSelection = (trace.mode === "edit" || trace.mode === "remove") && trace.selection && getRing(trace.outline, trace.selection)
    ? trace.selection : null;
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
  else if (trace.mode === "edit") guidance = "Drag points to move. Tap an edge to add. Toggle Remove to delete.";
  else if (trace.mode === "remove") guidance = "Tap a point to remove it. Turn Remove off to add or move.";
  else if (calibration && trace.outline.length) guidance = "Adjust the outline below, or choose Edit contours to move points.";
  else if (calibration && hasRegion) guidance = "No outline found. Adjust sensitivity or go back to redraw the region.";
  else if (calibration) guidance = "Select the tool's region to detect its outline.";

  return <div className="space-y-2" data-testid="mobile-trace-actions">
    <div className="flex items-center justify-between gap-1">
      <Button variant="ghost" size="sm" className="h-9 gap-1 px-1" disabled={step === "photo" || processing} aria-label={`Back to ${previousStep}`} onClick={back}>
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />Back
      </Button>
      {editingSelection ? <ContourEditTools compact removeActive={trace.mode === "remove"}
        selectionLabel={editingSelection.ringIndex === OUTER_RING ? `Contour ${editingSelection.shapeIndex + 1}` : `Hole ${editingSelection.ringIndex + 1}`}
        onChange={(remove) => dispatch({ type: "SET_MODE", mode: remove ? "remove" : "edit" })} />
        : <span className="text-xs font-semibold capitalize" data-testid="trace-current-step">{STEPS.indexOf(step) + 1} / 4 · {step}</span>}
      <Button variant="ghost" size="sm" className="h-9 px-1" onClick={() => setRestartOpen(true)}>
        Start over
      </Button>
    </div>
    {!(step === "scale" && pendingAutoCalibration) && <WorkflowHint>{guidance}</WorkflowHint>}
    {step === "outline" && hasRegion && <TraceDetectionControls compact onReprocess={onReprocess} />}
    {step === "scale" && manualPending && !pendingAutoCalibration && !processing ? <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1 text-xs" htmlFor="mobile-ruler-length">Reference length (mm)
        <Input id="mobile-ruler-length" type="number" inputMode="decimal" min="0.01" step="any" value={length} onChange={(event) => setLength(event.target.value)} />
      </label>
      <Button className="min-h-11" disabled={!confirmedRuler} onClick={() => {
        if (!confirmedRuler) return;
        dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: Number(length) });
        dispatch({ type: "SET_CALIBRATION", calibration: confirmedRuler });
      }}>Confirm scale</Button>
    </div> : null}
    {step === "scale" && pendingAutoCalibration ? <AutoCalibrationOptions
      onSetManually={redrawScale} onApplyPerspective={onApplyPerspective} onDetectMarkers={onDetectMarkers}
    /> : <div className="flex gap-2">
      {step === "photo" ? <>
        <Button variant="outline" className={actionClass} onClick={onChoosePhoto}>Change photo</Button>
        <Button className={actionClass} onClick={() => setReviewStep("scale")}>Use this photo</Button>
      </> : step === "scale" && calibration ? <>
        <Button variant="outline" className={actionClass} onClick={redrawScale}>Redraw scale</Button>
        <Button className={actionClass} onClick={continueToRegion}>Use this scale</Button>
      </> : <>
        <Button variant="outline" className={actionClass} onClick={() => onOpenSettings(
          pendingAutoCalibration || !calibration ? "trace-settings-scale" : "trace-settings-detect",
        )}>Controls</Button>
        {!processing && !calibration && !manualPending ? <Button className={actionClass} onClick={() => {
          if (trace.mode === "perspective") onOpenSettings("trace-settings-scale");
          else redrawScale();
        }}>{trace.mode === "perspective" ? "Review corners" : "Set scale"}</Button>
        : !processing && step === "region" && hasRegion ? <Button className={actionClass} onClick={() => dispatch({ type: "SET_MODE", mode: trace.outline.length ? "edit" : "pan" })}>Keep this region</Button>
        : !processing && step === "outline" && trace.outline.length > 0 ? <Button className={actionClass} onClick={() => onOpenSettings("trace-settings-output")}>Add to bin / export</Button>
        : !processing && calibration && trace.mode !== "region" ? <Button className={actionClass} onClick={continueToRegion}>Draw tool region</Button> : null}
      </>}
    </div>}
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
