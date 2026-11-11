import { useEffect, useId, useState, type ReactNode } from "react";

import { ChevronDown, RotateCcw, Settings2 } from "lucide-react";

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
}

/** Shared controls keep inline and drawer adjustments on the same guarded detection path. */
export function TraceDetectionControls({ onReprocess, compact = false, children, outlineActions }: {
  onReprocess: (settings: DetectionSettings) => void;
  compact?: boolean;
  children?: ReactNode;
  /** Editing and contour controls precede the final restart action. */
  outlineActions?: ReactNode;
}) {
  const trace = useTrace();
  const [manualOpen, setManualOpen] = useState(false);
  const manualId = useId();
  const { dispatch, sensitivity, tolerancePx, includeInteriorHoles, processing } = trace;
  const [draftSensitivity, setDraftSensitivity] = useState<number | null>(null);
  const [pendingDetection, setPendingDetection] = useState<DetectionSettings | null>(null);
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
    if (!settings.restart && settings.sensitivity === sensitivity && settings.includeInteriorHoles === includeInteriorHoles &&
        (settings.boundary ?? trace.boundaryMethod) === trace.boundaryMethod) return;
    const switchingMethod = settings.boundary !== undefined && settings.boundary !== trace.boundaryMethod;
    // Comparing untouched detector results is reversible and needs no warning.
    // Only protect adjustments the fresh method would actually discard.
    const discardsSettings = sensitivity !== initialTraceState.sensitivity ||
      tolerancePx !== initialTraceState.tolerancePx || trace.smoothing !== initialTraceState.smoothing ||
      trace.detectionHints.length > 0 || settings.includeInteriorHoles !== includeInteriorHoles;
    const confirmRestart = settings.restart && trace.outline.length > 0 && (!switchingMethod || discardsSettings);
    if (confirmRestart || trace.history.stack[trace.history.index]?.hasManualEdits) setPendingDetection(settings);
    else apply(settings);
  };
  const cancel = () => { setPendingDetection(null); setDraftSensitivity(null); };
  const restart = (boundary = trace.boundaryMethod) => request({ boundary, restart: true,
    sensitivity: initialTraceState.sensitivity, includeInteriorHoles: boundary === "teed" ? false : includeInteriorHoles });

  const tuning = <>
<div className={compact ? "grid grid-cols-2 gap-4" : "space-y-3"} data-testid={compact ? "mobile-trace-tuning" : "trace-tuning"}>
      <LabelledSlider id={compact ? "mobile-sensitivity" : "sensitivity"} label="Sensitivity"
        // Stored values are threshold bias; invert only the control so existing traces retain their settings.
        value={128 - (draftSensitivity ?? sensitivity)} min={-127} max={128} step={1}
        format={(value) => value === 0 ? "auto" : `${value > 0 ? "+" : ""}${value}`}
        disabled={processing} onChange={(value) => setDraftSensitivity(128 - value)}
        onCommit={(value) => request({ sensitivity: 128 - value, includeInteriorHoles })}
        touchTarget={compact}
        hint={compact ? undefined : trace.boundaryMethod !== "color"
          ? "Auto checks for missing foreground and chooses a stable edge sensitivity while protecting visible paper gaps and separate tools. Moving this slider overrides Auto. Higher includes more of the image. Updates on release and asks before replacing edits."
          : "Higher includes more of the image. Updates when you release the slider; asks before replacing manual edits."} />
      <LabelledSlider id={compact ? "mobile-detail" : "detail"} label="Simplification"
        value={tolerancePx} min={0.1} max={8} step={0.1} format={(value) => `${value.toFixed(1)} px`}
        disabled={processing || !!trace.curves} onChange={(value) => dispatch({ type: "SET_TOLERANCE", tolerancePx: value })}
        touchTarget={compact} hint={compact ? undefined : "Higher values use fewer points and may omit small features. Your edits are preserved."} />
    </div>
    {children}
    {compact && trace.outline.length > 0 && <TraceSymmetryTool />}
    {trace.curves && <p className="text-xs text-muted-foreground">Lines and curves are applied. Use Edit outline for adjustments and Bin clearance for fit.</p>}
  </>;

  return <>
    {!compact && <div className="flex items-center justify-between gap-2">
      <div className="w-full space-y-1.5">
        <div className="flex items-center gap-1"><Label htmlFor="outline-detection-method" className="text-xs">Find the outline using</Label>
          <HelpHint label="outline detection method">Tool edges is the default for new sessions and works best on light paper. Automatic chooses between Tool edges and Color contrast for the photo's background. Saved drafts keep their chosen method.</HelpHint></div>
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
    {!compact && <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Label htmlFor="include-interior-holes" className="text-xs">Include interior holes</Label>
        <HelpHint label="interior holes">Trace openings inside the tool. Reflections are usually not holes. Automatic uses Color contrast when this is enabled. Changing this setting asks before replacing manual edits.</HelpHint>
      </div>
      <Switch id="include-interior-holes" checked={includeInteriorHoles} disabled={processing || trace.boundaryMethod === "teed"}
        onCheckedChange={(include) => request({ sensitivity, includeInteriorHoles: include })} />
    </div>}
    {compact ? tuning : <>
      <Button variant="outline" size="sm" className="w-full" aria-expanded={manualOpen} aria-controls={manualId}
        onClick={() => setManualOpen(open => !open)}>
        <Settings2 className="h-4 w-4" />Manual detection settings
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
      </Button>
      <div id={manualId} hidden={!manualOpen} className="space-y-3 rounded-md border p-3">{tuning}</div>
    </>}
    {outlineActions}
    <div className="border-t pt-3"><Button variant="outline" size="sm" className="w-full" disabled={processing || !trace.imageUrl || !trace.region}
      onClick={() => restart()}><RotateCcw className="h-4 w-4" />Restart outline detection</Button></div>
    <Dialog open={pendingDetection !== null} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pendingDetection?.restart
          ? pendingDetection.boundary !== trace.boundaryMethod ? "Switch detection method?" : "Restart outline detection?"
          : "Re-detect from the photo?"}</DialogTitle>
          <DialogDescription>{pendingDetection?.restart
            ? `Start again from the photo inside the selected region. This replaces the outline and tool/paper corrections, resets Sensitivity to Auto and Simplification to ${initialTraceState.tolerancePx.toFixed(1)} px. Your photo, calibration, region and margin stay in place. Undo restores the previous outline and settings.`
            : "This replaces manual contour edits with a fresh detection. Undo restores your edited outline."}</DialogDescription>
        </DialogHeader>
        <Button onClick={() => { if (pendingDetection) apply(pendingDetection); }}>{pendingDetection?.restart
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
        <HelpHint label="editable curves">Off by default: detection makes a familiar point outline, with rounded edges approximated by points. Enable this to keep true curves and edit their handles after re-detection or adjustment. Turning it off converts existing curves to their displayed points as one undoable edit. Existing saved curves load intact.</HelpHint></div>
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
