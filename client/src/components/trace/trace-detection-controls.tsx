import { useExperimentalFeatures } from "@/state/experimental-features";
import { DetectedOutlineControls } from "./detected-outline-controls";
import { useEffect, useId, useState, type ReactNode } from "react";

import { correctionUnavailable } from "./correction-tools";
import { Brush, ChevronDown, RotateCcw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpHint } from "@/components/ui/help-hint";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { initialTraceState, useTrace } from "@/state/trace-store";
import { LabelledSlider } from "./labelled-slider";
import { TraceSymmetryTool } from "./trace-symmetry-tool";

export interface DetectionSettings {
  editableCurves?: boolean;
  sensitivity: number;
  includeInteriorHoles: boolean;
  boundary?: "auto" | "color" | "teed";
  /** Start fresh from photo pixels, resetting tuning and correction strokes. */
  restart?: boolean;
  /** Retry only this detection with the larger tool-edge model. */
  highDetail?: boolean;
}

/** Shared controls keep inline and drawer adjustments on the same guarded detection path. */
export function TraceDetectionControls({ onReprocess, onCorrectOutline, compact = false, children, outlineActions }: {
  onReprocess: (settings: DetectionSettings) => void;
  onCorrectOutline?: () => void;
  compact?: boolean;
  children?: ReactNode;
  /** Editing and contour controls precede the final restart action. */
  outlineActions?: ReactNode;
}) {
  const { enabled: advancedEditing } = useExperimentalFeatures();
  const trace = useTrace();
  const [manualOpen, setManualOpen] = useState(false);
  const manualId = useId();
  const holesHelpId = useId();
  const { dispatch, sensitivity, tolerancePx, includeInteriorHoles, processing } = trace;
  const holesHelp = trace.boundaryMethod === "teed"
    ? "Tool edges traces only the outer boundary. Enabling holes asks to switch to Color contrast."
    : trace.boundaryMethod === "auto" ? "With holes enabled, Automatic uses Color contrast." : null;
  const [draftSensitivity, setDraftSensitivity] = useState<number | null>(null);
  const [pendingDetection, setPendingDetection] = useState<DetectionSettings | null>(null);
  const switchingForHoles = trace.boundaryMethod === "teed" && pendingDetection?.boundary === "color" && pendingDetection.includeInteriorHoles;
  useEffect(() => {
    setDraftSensitivity(null);
    setPendingDetection(null);
  }, [trace.sourceRevision, trace.region]);
  useEffect(() => { if (!processing) setDraftSensitivity(null); }, [processing, sensitivity]);

  const apply = (settings: DetectionSettings) => {
    setPendingDetection(null);
    setDraftSensitivity(settings.sensitivity);
    // With an existing outline, publish controls with the successful detection
    // result. Failure/cancellation must not relabel the old geometry.
    if (!trace.outline.length) {
      dispatch({ type: "SET_SENSITIVITY", sensitivity: settings.sensitivity });
      dispatch({ type: "SET_INCLUDE_INTERIOR_HOLES", include: settings.includeInteriorHoles });
      if (settings.boundary) dispatch({ type: "SET_BOUNDARY_METHOD", method: settings.boundary });
    }
    // Commit the exact released value; the next store render has not happened yet.
    onReprocess(settings);
  };
  const request = (settings: DetectionSettings) => {
    setDraftSensitivity(null);
    if (!settings.restart && !settings.highDetail && settings.sensitivity === sensitivity && settings.includeInteriorHoles === includeInteriorHoles &&
        (settings.boundary ?? trace.boundaryMethod) === trace.boundaryMethod) return;
    const switchingMethod = settings.boundary !== undefined && settings.boundary !== trace.boundaryMethod;
    // Comparing untouched detector results is reversible and needs no warning.
    // Only protect adjustments the fresh method would actually discard.
    const discardsSettings = sensitivity !== initialTraceState.sensitivity ||
      tolerancePx !== initialTraceState.tolerancePx || trace.smoothing !== initialTraceState.smoothing ||
      trace.detectionHints.length > 0 || settings.includeInteriorHoles !== includeInteriorHoles;
    const confirmRestart = settings.restart && trace.outline.length > 0 && (!switchingMethod || discardsSettings);
    // Standard re-detection discards brush marks. Experimental tuning reuses them.
    if (confirmRestart || (!advancedEditing && trace.detectionHints.length > 0) || trace.history.stack[trace.history.index]?.hasManualEdits) setPendingDetection(settings);
    else apply(settings);
  };
  const cancel = () => { setPendingDetection(null); setDraftSensitivity(null); };
  const restart = (boundary = trace.boundaryMethod) => request({ boundary, restart: true,
    sensitivity: initialTraceState.sensitivity, includeInteriorHoles: boundary === "teed" ? false : includeInteriorHoles });
  const requestHoles = (include: boolean) => {
    if (include && trace.boundaryMethod === "teed") {
      // Enabling holes changes detection methods, so always explain and confirm it.
      setPendingDetection({ boundary: "color", restart: true,
        sensitivity: initialTraceState.sensitivity, includeInteriorHoles: true });
    } else request({ sensitivity, includeInteriorHoles: include });
  };

  const brushDisabled = correctionUnavailable(trace);
  const tuning = <>
    <div className={compact && advancedEditing ? "grid grid-cols-2 gap-4" : "space-y-3"} data-testid={compact ? "mobile-trace-tuning" : "trace-tuning"}>
      <LabelledSlider id={compact ? "mobile-sensitivity" : "sensitivity"} label="Sensitivity"
        // Stored values are threshold bias; invert only the control so existing traces retain their settings.
        value={128 - (draftSensitivity ?? sensitivity)} min={-127} max={128} step={1}
        format={(value) => value === 0 ? "auto" : `${value > 0 ? "+" : ""}${value}`}
        disabled={processing} onChange={(value) => setDraftSensitivity(128 - value)}
        onCommit={(value) => request({ sensitivity: 128 - value, includeInteriorHoles })}
        touchTarget={compact}
        touchScrollGuard
        hint={compact ? undefined : trace.boundaryMethod !== "color"
          ? "Auto checks for missing foreground and chooses a stable edge sensitivity while protecting visible paper gaps and separate tools. Moving this slider overrides Auto. Higher includes more of the image. Updates on release and asks before replacing edits."
          : "Higher includes more of the image. Updates when you release the slider; asks before replacing manual edits."} />
      {advancedEditing && <LabelledSlider id={compact ? "mobile-detail" : "detail"} label="Simplification"
        value={tolerancePx} min={0.1} max={8} step={0.1} format={(value) => `${value.toFixed(1)} px`}
        disabled={processing || !!trace.curves} onChange={(value) => dispatch({ type: "SET_TOLERANCE", tolerancePx: value })}
        touchTarget={compact} hint={compact ? undefined : "Higher values use fewer points and may omit small features. Your edits are preserved."} />}
    </div>
    {children}
    {advancedEditing && onCorrectOutline && trace.region && <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={onCorrectOutline} disabled={!!brushDisabled}>
        <Brush className="h-4 w-4" />Correct
      </Button>
      <HelpHint label="experimental correction brushes">{brushDisabled ?? "Mark missing tool material with Add or unwanted background with Remove. Each stroke reruns detection and can be undone."}</HelpHint>
    </div>}
    <DetectedOutlineControls />
    {compact && trace.outline.length > 0 && <TraceSymmetryTool />}
    {trace.curves && <p className="text-xs text-muted-foreground">Lines and curves are applied. Use Edit outline for adjustments and Bin clearance for fit.</p>}
  </>;

  return <>
    {trace.boundaryMethod === "teed" && !includeInteriorHoles && trace.imageUrl && trace.region &&
      trace.detectedImageUrl === trace.imageUrl && <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="min-w-0 flex-1" disabled={processing}
          onClick={() => request({ sensitivity, includeInteriorHoles, highDetail: true })}>
          Retry at higher resolution
        </Button>
        <HelpHint label="higher-resolution retry">Trace this region again at 768 px. The larger model uses more memory than the 512 px default. Undo restores the previous outline.</HelpHint>
      </div>}
    {!compact && <div className="flex items-center justify-between gap-2">
      <div className="w-full space-y-1.5">
        <div className="flex items-center gap-1"><Label htmlFor="outline-detection-method" className="text-xs">Find the outline using</Label>
          <HelpHint label="outline detection method">Find the tool's outline in the photo. Tool edges works best on light paper; Color contrast can also find interior holes. Automatic chooses a method for the background.</HelpHint></div>
        <select id="outline-detection-method" className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          value={trace.boundaryMethod} disabled={processing}
          onChange={event => { const boundary = event.target.value as "auto" | "color" | "teed";
            if (boundary !== trace.boundaryMethod) restart(boundary); }}>
          <option value="teed">Tool edges · white sheet</option>
          <option value="auto">Automatic · match background</option>
          <option value="color">Color contrast</option>
        </select>
      </div>
    </div>}
    {!compact && <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="include-interior-holes" className="text-xs">Include interior holes</Label>
          <HelpHint label="interior holes">Trace openings inside the tool to keep material in those areas of the pocket. Tool edges will ask to switch to Color contrast; Automatic chooses it for you. Reflections usually aren't holes.</HelpHint>
        </div>
        <Switch id="include-interior-holes" checked={includeInteriorHoles} disabled={processing}
          aria-describedby={holesHelp ? holesHelpId : undefined}
          onCheckedChange={requestHoles} />
      </div>
      {holesHelp && <p id={holesHelpId} className="text-xs text-muted-foreground">{holesHelp}</p>}
    </div>}
    {outlineActions}
    {compact ? tuning : <div className="space-y-3 border-t pt-3">
      <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="min-w-0 flex-1" aria-expanded={manualOpen} aria-controls={manualId}
        onClick={() => { if (manualOpen) trace.detectedOutlineReview.close(); setManualOpen(open => !open); }}>
        <Settings2 className="h-4 w-4" />Manual detection settings
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
      </Button>
      <HelpHint label="manual detection settings">Adjust sensitivity or compare the detected outline with the current contour.</HelpHint>
      </div>
      <div id={manualId} hidden={!manualOpen} className="space-y-3 rounded-md border p-3">{tuning}</div>
    </div>}
    <div className="flex items-center gap-1 border-t pt-3"><Button variant="outline" size="sm" className="min-w-0 flex-1" disabled={processing || !trace.imageUrl || !trace.region}
      onClick={() => restart()}><RotateCcw className="h-4 w-4" />Restart outline detection</Button>
      <HelpHint label="restarting outline detection">Start over from the selected photo region when you want a fresh outline. Resets detection settings while keeping the photo, scale, and region. Undo restores the previous outline.</HelpHint>
    </div>
    <Dialog open={pendingDetection !== null} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{switchingForHoles ? "Switch detection to include holes?" : pendingDetection?.restart
          ? pendingDetection.boundary !== trace.boundaryMethod ? "Switch detection method?" : "Restart outline detection?"
          : "Re-detect from the photo?"}</DialogTitle>
          <DialogDescription>{switchingForHoles
            ? "Color contrast is needed to detect holes. This replaces your outline and edits; Undo restores them."
            : pendingDetection?.restart
            ? `Start again from the photo inside the selected region. This replaces your outline and edits, resets Sensitivity to Auto and sets Simplification to ${initialTraceState.tolerancePx.toFixed(1)} px. Your photo, calibration, region and margin stay in place. Undo restores the previous outline and settings.`
            : "This replaces manual contour edits with a fresh detection. Undo restores your edited outline."}</DialogDescription>
        </DialogHeader>
        <Button onClick={() => { if (pendingDetection) apply(pendingDetection); }}>{switchingForHoles ? "Switch and include holes" : pendingDetection?.restart
          ? pendingDetection.boundary !== trace.boundaryMethod ? "Switch and restart" : "Restart detection" : "Replace manual edits"}</Button>
        <Button variant="outline" onClick={cancel}>{pendingDetection?.restart ? "Keep current outline" : "Keep my edits"}</Button>
      </DialogContent>
    </Dialog>
  </>;
}

/** Optional curve editing lives below the primary outline actions. */
export function TraceCurveSettings({ onReprocess }: { onReprocess: (settings: DetectionSettings) => void }) {
  const trace = useTrace();
  const { dispatch, sensitivity, includeInteriorHoles, processing } = trace;
  const [confirmCurves, setConfirmCurves] = useState(false);
  useEffect(() => { setConfirmCurves(false); }, [trace.sourceRevision, trace.region]);
  return <>
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1"><Label htmlFor="editable-curves" className="text-xs">Editable curves</Label>
        <HelpHint label="editable curves">Keep curved edges editable with handles after detection or adjustment. Useful for refining rounded tool shapes. Turning this off converts curves to points; Undo restores them.</HelpHint></div>
      <Switch id="editable-curves" checked={trace.editableCurves || !!trace.curves} disabled={processing}
        onCheckedChange={enabled => {
          if (enabled && trace.outline.length > 0 && trace.region && trace.imageUrl) setConfirmCurves(true);
          else dispatch({ type: "SET_EDITABLE_CURVES", enabled });
        }} />
    </div>
    <Dialog open={confirmCurves} onOpenChange={setConfirmCurves}>
      <DialogContent>
        <DialogHeader><DialogTitle>Re-detect before using curves?</DialogTitle>
          <DialogDescription>Detection cleans up lines and rounded sections automatically. Editable curves retains true curves after re-detection or adjustment. Re-detecting starts again from the photo and replaces your outline edits; Undo restores them. You can also keep the current outline.</DialogDescription>
        </DialogHeader>
        <Button onClick={() => {
          setConfirmCurves(false);
          dispatch({ type: "SET_EDITABLE_CURVES", enabled: true });
          onReprocess({ sensitivity, includeInteriorHoles, boundary: trace.boundaryMethod, editableCurves: true });
        }}>Re-detect photo</Button>
        <Button variant="outline" onClick={() => { setConfirmCurves(false); dispatch({ type: "SET_EDITABLE_CURVES", enabled: true }); }}>Keep current outline</Button>
        <Button variant="ghost" onClick={() => setConfirmCurves(false)}>Cancel</Button>
      </DialogContent>
    </Dialog>
  </>;
}
