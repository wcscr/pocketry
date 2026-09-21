import { useState } from "react";
import { useLocation } from "wouter";
import { exportScale } from "@/lib/export/scale";
import { normalizeTracedShape } from "@/lib/gridfinity/traced-shape";
import { useShapeLibrary } from "@/state/shape-library";
import { useTrace } from "@/state/trace-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Shared naming and handoff, reachable directly from the mobile action bar. */
export function TraceHandoffDialog({ onClose, onChoosePhoto, onCanvasInteraction }: {
  onClose: () => void;
  onChoosePhoto: () => void;
  onCanvasInteraction?: () => void;
}) {
  const trace = useTrace();
  const { outline, fileName, margin } = trace;
  const library = useShapeLibrary();
  const [, navigate] = useLocation();
  const [separateTools, setSeparateTools] = useState(true);
  const [toolNames, setToolNames] = useState(() => outline.map((_, i) => outline.length === 1 ? fileName || "Traced tool" : `Tool ${i + 1}`));
  const scale = exportScale(trace.calibration, trace.imageSize.height);
  const ready = !!scale.mmPerPx && outline.length > 0 && !trace.pendingAutoCalibration && !trace.processing;
  const add = (anotherPhoto: boolean) => {
    if (!ready) return;
    const parts = separateTools ? outline.map(part => [part]) : [outline];
    for (const [index, part] of parts.entries()) {
      const shape = normalizeTracedShape(part, scale, toolNames[index]?.trim() || `Tool ${index + 1}`);
      if (shape) library.addShape({ ...shape, traceMarginMm: margin ?? 0 });
    }
    onClose();
    onCanvasInteraction?.();
    if (anotherPhoto) onChoosePhoto();
    else navigate("/bin");
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>Name your tools</DialogTitle>
      <DialogDescription>Each tool becomes an independently movable pocket. The trace already includes {margin ?? 0} mm of margin per edge.</DialogDescription></DialogHeader>
      {outline.length > 1 && <div className="flex items-center justify-between gap-2">
        <Label htmlFor="separate-tools">Separate pockets ({outline.length} objects)</Label>
        <Switch id="separate-tools" checked={separateTools} onCheckedChange={setSeparateTools} />
      </div>}
      {!separateTools && <p className="text-xs text-muted-foreground">All objects will move together as one pocket.</p>}
      <div className="max-h-60 space-y-3 overflow-y-auto">
        {(separateTools ? outline : [outline[0]]).map((_, index) => <div key={index}>
          <Label htmlFor={`tool-name-${index}`}>{separateTools ? `Tool ${index + 1}` : "Group name"}</Label>
          <Input id={`tool-name-${index}`} value={toolNames[index] ?? ""} maxLength={80}
            onChange={event => setToolNames(names => names.map((name, i) => i === index ? event.target.value : name))} />
        </div>)}
      </div>
      <Button disabled={!ready} onClick={() => add(false)}>Add and arrange</Button>
      <Button disabled={!ready} variant="outline" onClick={() => add(true)}>Add and trace another photo</Button>
    </DialogContent>
  </Dialog>;
}
