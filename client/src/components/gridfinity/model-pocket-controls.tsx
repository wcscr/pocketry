import { modelDimensions } from "@shared/gridfinity/model-pocket";
import { resolvePocketDepth, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useBin } from "@/state/bin-store";
import { useExperimentalFeatures } from "@/state/experimental-features";

/** Model dimensions are independent of insertion depth; moving the model never stretches it. */
export function ModelPocketControls({ shape, cutout }: { shape: TracedShape; cutout: CutoutPlacement }) {
  const { spec, dispatch } = useBin();
  const { enabled: experimentalEnabled, setSettingsOpen } = useExperimentalFeatures();
  if (!shape.model) return null;
  if (!experimentalEnabled) return <div className="space-y-1 py-2 text-xs text-muted-foreground">
    <p>Enable experimental features in Settings to edit this model pocket. Its geometry is preserved.</p>
    <Button size="sm" variant="link" className="h-9 px-0 text-xs" onClick={() => setSettingsOpen(true)}>Show experimental settings</Button>
  </div>;
  const dimensions = modelDimensions(shape.model);
  const scales = [cutout.scaleX, cutout.scaleY, cutout.modelScaleZ ?? 1];
  const keys = ["scaleX", "scaleY", "modelScaleZ"] as const;
  const top = resolvePocketDepth(spec, cutout.depth).infillTopZ;
  const update = (patch: Partial<CutoutPlacement>, historyLabel: string, transient = false) => dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch, historyLabel, transient });
  const resize = (i: number, value: number, transient: boolean) => {
    const scale = value / dimensions[i];
    if (!cutout.aspectRatioLocked) { update({ [keys[i]]: scale }, "Resize model pocket", transient); return; }
    const ratio = scale / scales[i];
    const next = scales.map(s => s * ratio);
    if (next.some(s => s < 0.05 || s > 20)) return;
    update({ scaleX: next[0], scaleY: next[1], modelScaleZ: next[2] }, "Scale model pocket", transient);
  };
  return <section className="space-y-3 py-2" aria-label="Imported model properties">
    <Label className="block space-y-1 text-xs">Insertion path
      <select aria-label="Model insertion path" value={cutout.modelInsertionMode ?? "axis"}
        className="h-9 w-full rounded-md border bg-background px-2"
        onChange={event => update({ modelInsertionMode: event.target.value as "axis" | "vertical" }, "Change model insertion path")}>
        <option value="axis">Follow pocket angle</option>
        <option value="vertical">Vertical drop-in</option>
      </select>
    </Label>
    <Label className="flex items-center gap-2 text-xs">Insertion depth
      <DraftNumberInput aria-label="Model insertion depth in millimetres" value={top - (cutout.elevationMm ?? 0)} min={top - 300} max={top} step={0.5} displayPrecision={2}
        onValueChange={depth => update({ elevationMm: top - depth }, "Change model insertion depth", true)}
        onValueCommit={depth => update({ elevationMm: top - depth }, "Change model insertion depth")} /><span>mm</span>
    </Label>
    <p className="text-[11px] text-muted-foreground">Distance from the fill surface to the cavity’s lowest point. Negative values lift it above the fill. Model dimensions stay fixed.</p>
    <div className="flex items-center justify-between"><span className="text-xs font-medium">Model dimensions (mm)</span>
      <Button size="sm" variant="outline" aria-pressed={cutout.aspectRatioLocked} onClick={() => update({ aspectRatioLocked: !cutout.aspectRatioLocked }, "Change model scale lock")}>Scale together: {cutout.aspectRatioLocked ? "On" : "Off"}</Button>
    </div>
    <div className="grid grid-cols-3 gap-2">{keys.map((key, i) => <Label key={key} className="space-y-1 text-xs">{["X", "Y", "Z"][i]}
      <DraftNumberInput className="h-8" aria-label={`Model ${["X", "Y", "Z"][i]} size in millimetres`} value={dimensions[i] * scales[i]} min={dimensions[i] * 0.05} max={dimensions[i] * 20} step={1} displayPrecision={2}
        onValueChange={value => resize(i, value, true)} onValueCommit={value => resize(i, value, false)} />
    </Label>)}</div>
    <Label className="flex items-center gap-2 text-xs">Fit margin
      <DraftNumberInput aria-label="Model fit margin in millimetres" value={cutout.clearanceMm} min={0} max={5} step={0.1} displayPrecision={2}
        onValueChange={clearanceMm => update({ clearanceMm }, "Change model clearance", true)}
        onValueCommit={clearanceMm => update({ clearanceMm }, "Change model clearance")} /><span>mm</span>
    </Label>
    <p className="text-[11px] text-muted-foreground">Room around the tool for easy placement and removal. Start at 0.3 mm, then check the fit with your printer and tool.</p>
    <Label className="flex items-center gap-2 text-xs">Detail smoothing
      <DraftNumberInput aria-label="Model detail smoothing in millimetres" value={cutout.modelSmoothingMm ?? 1} min={0} max={5} step={0.25} displayPrecision={2}
        onValueChange={modelSmoothingMm => update({ modelSmoothingMm }, "Change model smoothing", true)}
        onValueCommit={modelSmoothingMm => update({ modelSmoothingMm }, "Change model smoothing")} /><span>mm</span>
    </Label>
    <p className="text-[11px] text-muted-foreground">Softens small grooves, ribs and sharp corners while keeping the tool’s broad shape. Larger values clear more detail. Set to 0 to keep CAD detail (slower).</p>
    <p className="text-[11px] text-muted-foreground">Choose Follow pocket angle to insert along the rotated model’s Z axis, or Vertical drop-in to lower it straight down at its resting angle.</p>
  </section>;
}
