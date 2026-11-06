import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpHint } from "@/components/ui/help-hint";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTrace } from "@/state/trace-store";
import { LabelledSlider } from "./labelled-slider";
import { TraceSymmetryTool } from "./trace-symmetry-tool";

export interface DetectionSettings {
  editableCurves?: boolean;
  sensitivity: number;
  includeInteriorHoles: boolean;
  boundary?: "auto" | "color" | "teed";
}

/** Shared controls keep inline and drawer adjustments on the same guarded detection path. */
export function TraceDetectionControls({ onReprocess, compact = false }: {
  onReprocess: (settings: DetectionSettings) => void;
  compact?: boolean;
}) {
  const trace = useTrace();
  const { dispatch, sensitivity, tolerancePx, includeInteriorHoles, processing } = trace;
  const [draftSensitivity, setDraftSensitivity] = useState<number | null>(null);
  const [pendingDetection, setPendingDetection] = useState<DetectionSettings | null>(null);
  const [confirmCurves, setConfirmCurves] = useState(false);
  useEffect(() => {
    setDraftSensitivity(null);
    setPendingDetection(null);
    setConfirmCurves(false);
  }, [trace.sourceRevision, trace.region]);

  const apply = (settings: DetectionSettings) => {
    setPendingDetection(null);
    setDraftSensitivity(null);
    dispatch({ type: "SET_SENSITIVITY", sensitivity: settings.sensitivity });
    dispatch({ type: "SET_INCLUDE_INTERIOR_HOLES", include: settings.includeInteriorHoles });
    if (settings.boundary) dispatch({ type: "SET_BOUNDARY_METHOD", method: settings.boundary });
    // Commit the exact released value; the next store render has not happened yet.
    onReprocess(settings);
  };
  const request = (settings: DetectionSettings) => {
    setDraftSensitivity(null);
    if (settings.sensitivity === sensitivity && settings.includeInteriorHoles === includeInteriorHoles &&
        (settings.boundary ?? trace.boundaryMethod) === trace.boundaryMethod) return;
    if (trace.history.stack[trace.history.index]?.hasManualEdits) setPendingDetection(settings);
    else apply(settings);
  };
  const cancel = () => { setPendingDetection(null); setDraftSensitivity(null); };

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
    {compact && trace.outline.length > 0 && <TraceSymmetryTool />}
    {trace.curves && <p className="text-xs text-muted-foreground">Lines and curves are applied. Use Edit outline for adjustments and Bin clearance for fit.</p>}
  </>;

  return <>
    {!compact && <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1"><Label htmlFor="editable-curves" className="text-xs">Editable curves</Label>
        <HelpHint label="editable curves">Off by default: detection makes a familiar point outline, with rounded edges approximated by points. Enable this to keep true curves and edit their handles after re-detection or adjustment. Turning it off converts existing curves to their displayed points as one undoable edit. Existing saved curves load intact.</HelpHint></div>
      <Switch id="editable-curves" checked={trace.editableCurves || !!trace.curves} disabled={processing}
        onCheckedChange={enabled => {
          if (enabled && trace.outline.length > 0 && trace.region && trace.imageUrl) setConfirmCurves(true);
          else dispatch({ type: "SET_EDITABLE_CURVES", enabled });
        }} />
    </div>}
    {!compact && <div className="flex items-center justify-between gap-2">
      <div className="w-full space-y-1.5">
        <div className="flex items-center gap-1"><Label htmlFor="outline-detection-method" className="text-xs">Find the outline using</Label>
          <HelpHint label="outline detection method">Automatic checks the paper around the selected tool: it uses on-device Tool edges for light neutral paper, and Color contrast for other or uncertain backgrounds. You can choose either method yourself. Detection also cleans up straight lines and rounded sections. Adjust simplification previews a different allowance.</HelpHint></div>
        <select id="outline-detection-method" className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          value={trace.boundaryMethod} disabled={processing}
          onChange={event => { const boundary = event.target.value as "auto" | "color" | "teed";
            request({ sensitivity, includeInteriorHoles: boundary === "teed" ? false : includeInteriorHoles, boundary }); }}>
          <option value="auto">Automatic · match background</option>
          <option value="teed">Tool edges · white sheet</option>
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
    {compact ? tuning : <details><summary className="cursor-pointer py-2 text-xs font-medium">Advanced detection settings</summary><div className="space-y-3 pt-2">{tuning}</div></details>}
    <Dialog open={confirmCurves} onOpenChange={setConfirmCurves}>
      <DialogContent>
        <DialogHeader><DialogTitle>Re-detect before using curves?</DialogTitle>
          <DialogDescription>Detection cleans up lines and rounded sections automatically. Editable curves retains true curves after re-detection or adjustment. Re-detecting starts again from the photo and replaces your outline edits; Undo restores them. You can also keep the current outline.</DialogDescription>
        </DialogHeader>
        <Button onClick={() => {
          setConfirmCurves(false);
          dispatch({ type: "SET_EDITABLE_CURVES", enabled: true });
          apply({ sensitivity, includeInteriorHoles, boundary: trace.boundaryMethod, editableCurves: true });
        }}>Re-detect photo</Button>
        <Button variant="outline" onClick={() => { setConfirmCurves(false); dispatch({ type: "SET_EDITABLE_CURVES", enabled: true }); }}>Keep current outline</Button>
        <Button variant="ghost" onClick={() => setConfirmCurves(false)}>Cancel</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={pendingDetection !== null} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Re-detect from the photo?</DialogTitle>
          <DialogDescription>This replaces manual contour edits with a fresh detection. Undo restores your edited outline.</DialogDescription>
        </DialogHeader>
        <Button onClick={() => { if (pendingDetection) apply(pendingDetection); }}>Replace manual edits</Button>
        <Button variant="outline" onClick={cancel}>Keep my edits</Button>
      </DialogContent>
    </Dialog>
  </>;
}
