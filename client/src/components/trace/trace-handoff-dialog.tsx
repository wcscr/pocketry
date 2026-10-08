import { useState } from "react";
import { useLocation } from "wouter";
import { exportScale } from "@/lib/export/scale";
import { normalizeTracedShape } from "@/lib/gridfinity/traced-shape";
import { useShapeLibrary } from "@/state/shape-library";
import { hasPendingManualCalibration, useTrace } from "@/state/trace-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";

type DepthMode = "mm" | "to-floor" | "through";

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
  const [depths, setDepths] = useState(() => outline.map(() => ""));
  const [depthModes, setDepthModes] = useState<DepthMode[]>(() => outline.map(() => "mm"));
  const keyboard = useKeyboardViewport();
  const depthValues = depths.map(value => Number(value.trim().replace(",", ".")));
  const validDepth = (index: number) => depthModes[index] !== "mm" || (Number.isFinite(depthValues[index]) && depthValues[index] >= 1 && depthValues[index] <= 120);
  const chosenDepths = (separateTools ? outline : [outline[0]]).every((_, index) => validDepth(index));
  const scale = exportScale(trace.calibration, trace.imageSize.height);
  const ready = !!scale.mmPerPx && outline.length > 0 && !trace.pendingAutoCalibration && !hasPendingManualCalibration(trace) && !trace.processing;
  const add = (anotherPhoto: boolean) => {
    if (!ready || !chosenDepths) return;
    const parts = separateTools ? outline.map(part => [part]) : [outline];
    for (const [index, part] of parts.entries()) {
      const shape = normalizeTracedShape(part, scale, toolNames[index]?.trim() || `Tool ${index + 1}`);
      const mode = depthModes[index];
      if (shape) library.addShape({ ...shape, traceMarginMm: margin ?? 0 },
        mode === "mm" ? { mode, value: depthValues[index] } : { mode });
    }
    onClose();
    onCanvasInteraction?.();
    if (anotherPhoto) onChoosePhoto();
    else navigate("/bin");
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto"
      style={keyboard ? { top: keyboard.top + keyboard.height / 2, maxHeight: Math.max(1, keyboard.height - 32) } : undefined}>
      <DialogHeader><DialogTitle>Name your tools and choose pocket depths</DialogTitle>
      <DialogDescription>Choose a fixed depth, To Floor, or Through for each tool. A photo cannot tell us its thickness. The trace already includes {margin ?? 0} mm of margin per edge.</DialogDescription></DialogHeader>
      {outline.length > 1 && <div className="flex items-center justify-between gap-2">
        <Label htmlFor="separate-tools">Separate pockets ({outline.length} objects)</Label>
        <Switch id="separate-tools" checked={separateTools} onCheckedChange={setSeparateTools} />
      </div>}
      {!separateTools && <p className="text-xs text-muted-foreground">All objects will move together as one pocket.</p>}
      <div className="space-y-4">
        {(separateTools ? outline : [outline[0]]).map((_, index) => <div key={index} className="space-y-2 rounded-md border p-3">
          <Label htmlFor={`tool-name-${index}`}>{separateTools ? `Tool ${index + 1}` : "Group name"}</Label>
          <Input id={`tool-name-${index}`} value={toolNames[index] ?? ""} maxLength={80}
            onChange={event => setToolNames(names => names.map((name, i) => i === index ? event.target.value : name))} />
          <RadioGroup aria-label={`Pocket depth mode — ${separateTools ? `Tool ${index + 1}` : "Group"}`}
            aria-describedby={`tool-depth-help-${index}`} value={depthModes[index]}
            onValueChange={mode => setDepthModes(values => values.map((value, i) => i === index ? mode as DepthMode : value))}>
            {([ ["mm", "Fixed depth"], ["to-floor", "To Floor"], ["through", "Through — no pocket floor"] ] as const).map(([mode, label]) =>
              <div key={mode} className="flex items-center gap-2">
                <RadioGroupItem id={`tool-${mode}-${index}`} value={mode} />
                <Label htmlFor={`tool-${mode}-${index}`}>{label}</Label>
              </div>)}
          </RadioGroup>
          <Label htmlFor={`tool-depth-${index}`}>Pocket depth (mm){separateTools && outline.length > 1 ? ` — Tool ${index + 1}` : ""}</Label>
          <Input id={`tool-depth-${index}`} inputMode="decimal" value={depths[index]} disabled={depthModes[index] !== "mm"}
            required={depthModes[index] === "mm"} aria-invalid={depthModes[index] === "mm" && depths[index] !== "" && !validDepth(index)} aria-describedby={`tool-depth-help-${index}`}
            onChange={event => setDepths(values => values.map((value, i) => i === index ? event.target.value : value))} />
          <p id={`tool-depth-help-${index}`} className="text-xs text-muted-foreground">
            {depthModes[index] === "through" ? "Cuts through the bin. The work surface must support the tool. Outlines with holes may leave loose pieces."
              : depthModes[index] === "to-floor" ? "Extends to the bin’s default floor: 7 mm above the underside for Gridfinity, or 2 mm for a flat-bottom bin. Bin height stays unchanged."
              : "Choose a depth from 1 to 120 mm. Measure the tool and leave enough exposed to lift it out. Bin height stays unchanged."}
          </p>
        </div>)}
      </div>
      {!chosenDepths && <p role="status" className="text-sm">Choose a valid fixed depth, To Floor, or Through for every pocket to continue.</p>}
      <Button disabled={!ready || !chosenDepths} onClick={() => add(false)}>Add and arrange</Button>
      <Button disabled={!ready || !chosenDepths} variant="outline" onClick={() => add(true)}>Add and trace another photo</Button>
    </DialogContent>
  </Dialog>;
}
