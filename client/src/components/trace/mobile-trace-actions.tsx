import { useEffect, useState } from "react";

import { calibrationFromDraft, hasCalibrationEndpoints } from "@shared/geometry/scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PerspectiveProposal } from "@/lib/calibrate/perspective";
import type { TemplateVariant } from "@/lib/calibrate/template";
import { useTrace } from "@/state/trace-store";

export interface MobileTraceActionsProps {
  onChoosePhoto: () => void;
  onOpenSettings: (sectionId: string) => void;
  onApplyPerspective: (proposal: PerspectiveProposal, template: TemplateVariant) => void;
}

/** Keep the current workflow step reachable while the controls drawer is closed. */
export function MobileTraceActions({ onChoosePhoto, onOpenSettings, onApplyPerspective }: MobileTraceActionsProps): JSX.Element {
  const trace = useTrace();
  const { dispatch, pendingAutoCalibration, pendingPerspective, calibration, draftCalibration, processing } = trace;
  const [length, setLength] = useState(String(trace.rulerLengthMm));
  useEffect(() => setLength(String(trace.rulerLengthMm)), [trace.rulerLengthMm]);
  const template = pendingPerspective?.template ?? pendingPerspective?.paper;
  const manualPending = !calibration && hasCalibrationEndpoints(draftCalibration);
  const confirmedRuler = calibrationFromDraft(draftCalibration, Number(length));
  const hasRegion = trace.region && trace.region.width > 5 && trace.region.height > 5;
  const scaleSettings = () => onOpenSettings("trace-settings-scale");
  const actionClass = "min-h-11 flex-1 whitespace-normal leading-tight";

  if (!trace.imageUrl) {
    return <Button className="min-h-11 w-full" onClick={onChoosePhoto}>Choose a photo</Button>;
  }

  let guidance = "Set the photo's real size to continue.";
  if (processing) guidance = "Analyzing photo…";
  else if (pendingAutoCalibration) guidance = "Scale detected. Check the ruler on the photo.";
  else if (manualPending) guidance = "Enter the real distance between the ruler points.";
  else if (trace.mode === "calibrate") guidance = "Tap two points a known distance apart.";
  else if (trace.mode === "perspective") guidance = `Tap the page corners clockwise (${trace.manualPerspectivePoints.length}/4).`;
  else if (trace.mode === "region") guidance = "Drag a box around the whole tool to detect its outline.";
  else if (trace.mode === "navigate") guidance = "Drag to pan. Pinch or use + / − to zoom.";
  else if (trace.mode === "edit") guidance = "Drag points to move. Tap to add. Use − to remove.";
  else if (trace.mode === "remove") guidance = "Tap an outline point to remove it. Undo restores it.";
  else if (calibration && trace.outline.length) guidance = "Review the outline, then add it to a bin or export.";
  else if (calibration && hasRegion) guidance = "No outline found. Adjust detection or redraw the region.";
  else if (calibration) guidance = "Select the tool's region to detect its outline.";

  return <div className="space-y-2" data-testid="mobile-trace-actions">
    <p className="text-xs text-muted-foreground" role="status">{guidance}</p>
    {manualPending && !processing ? <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1 text-xs" htmlFor="mobile-ruler-length">Reference length (mm)
        <Input id="mobile-ruler-length" type="number" inputMode="decimal" min="0.01" step="any" value={length} onChange={(event) => setLength(event.target.value)} />
      </label>
      <Button className="min-h-11" disabled={!confirmedRuler} onClick={() => {
        if (!confirmedRuler) return;
        dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: Number(length) });
        dispatch({ type: "SET_CALIBRATION", calibration: confirmedRuler });
      }}>Confirm scale</Button>
    </div> : null}
    <div className="flex gap-2">
      <Button variant="outline" className={actionClass} onClick={() => onOpenSettings(
        pendingAutoCalibration || !calibration ? "trace-settings-scale" : "trace-settings-detect",
      )}>Controls</Button>
      {!processing && pendingAutoCalibration ? <Button className={actionClass} onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION" })}>
        {pendingPerspective ? "Use scale only" : "Accept detected scale"}
      </Button> : !processing && !calibration && !manualPending ? <Button className={actionClass} onClick={() => {
        if (trace.mode === "perspective") scaleSettings();
        else dispatch({ type: "SET_MODE", mode: "calibrate" });
      }}>{trace.mode === "perspective" ? "Review corners" : "Set scale"}</Button> : !processing && calibration && trace.outline.length > 0 ? <Button className={actionClass} onClick={() => onOpenSettings("trace-settings-output")}>Add to bin / export</Button> : !processing && calibration && trace.mode !== "region" ? <Button className={actionClass} onClick={() => dispatch({ type: "SET_MODE", mode: "region" })}>Draw tool region</Button> : null}
    </div>
    {!processing && pendingAutoCalibration && pendingPerspective && template ? <Button className="min-h-11 w-full whitespace-normal" onClick={() => onApplyPerspective(pendingPerspective, template)}>Correct perspective &amp; use scale</Button> : null}
  </div>;
}
