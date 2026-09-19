import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTrace } from "@/state/trace-store";
import { LabelledSlider } from "./labelled-slider";

export interface DetectionSettings {
  sensitivity: number;
  includeInteriorHoles: boolean;
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
  useEffect(() => {
    setDraftSensitivity(null);
    setPendingDetection(null);
  }, [trace.sourceRevision, trace.region]);

  const apply = (settings: DetectionSettings) => {
    setPendingDetection(null);
    setDraftSensitivity(null);
    dispatch({ type: "SET_SENSITIVITY", sensitivity: settings.sensitivity });
    dispatch({ type: "SET_INCLUDE_INTERIOR_HOLES", include: settings.includeInteriorHoles });
    // Commit the exact released value; the next store render has not happened yet.
    onReprocess(settings);
  };
  const request = (settings: DetectionSettings) => {
    setDraftSensitivity(null);
    if (settings.sensitivity === sensitivity && settings.includeInteriorHoles === includeInteriorHoles) return;
    if (trace.history.stack[trace.history.index]?.hasManualEdits) setPendingDetection(settings);
    else apply(settings);
  };
  const cancel = () => { setPendingDetection(null); setDraftSensitivity(null); };

  return <>
    {!compact && <div className="flex items-center justify-between gap-2">
      <Label htmlFor="include-interior-holes" className="text-xs">Include interior holes</Label>
      <Switch id="include-interior-holes" checked={includeInteriorHoles} disabled={processing}
        onCheckedChange={(include) => request({ sensitivity, includeInteriorHoles: include })} />
    </div>}
    <div className={compact ? "grid grid-cols-2 gap-4" : "space-y-3"} data-testid={compact ? "mobile-trace-tuning" : "trace-tuning"}>
      <LabelledSlider id={compact ? "mobile-sensitivity" : "sensitivity"} label="Sensitivity"
        value={draftSensitivity ?? sensitivity} min={0} max={255} step={1}
        format={(value) => value === 128 ? "auto" : `${value > 128 ? "+" : ""}${value - 128}`}
        disabled={processing} onChange={setDraftSensitivity}
        onCommit={(value) => request({ sensitivity: value, includeInteriorHoles })}
        touchTarget={compact}
        hint={compact ? undefined : "Lower includes more of the image. Updates when you release the slider; asks before replacing manual edits."} />
      <LabelledSlider id={compact ? "mobile-detail" : "detail"} label="Detail"
        value={tolerancePx} min={0.1} max={8} step={0.1} format={(value) => `${value.toFixed(1)} px`}
        disabled={processing} onChange={(value) => dispatch({ type: "SET_TOLERANCE", tolerancePx: value })}
        touchTarget={compact} hint={compact ? undefined : "How closely the outline follows the pixels."} />
    </div>
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
