import { SlidersHorizontal } from "lucide-react";
import { pocketName, type DepthSpec } from "@shared/gridfinity/cutout";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { MobileAdjustmentTray } from "@/components/layout/mobile-adjustment-tray";
import { Button } from "@/components/ui/button";
import { LabelledSlider } from "@/components/trace/labelled-slider";

/** Small, live controls use the same reducer and history commits as full settings. */
export function MobileBinActions({ open, onOpenChange, onMore, onExport }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMore: (section: string) => void;
  onExport: () => void;
}) {
  const bin = useBin();
  const { shapes } = useShapeLibrary();
  const cutout = bin.cutouts.find(item => item.id === bin.selectedCutoutId);
  const shape = shapes.find(item => item.id === cutout?.shapeId);
  const depth = cutout?.split ? cutout.split.depths[bin.selectedPocketSection] : cutout?.depth;
  const updateDepth = (next: DepthSpec, transient: boolean) => {
    if (!cutout) return;
    const depths = cutout.split ? [...cutout.split.depths] as [DepthSpec, DepthSpec] : null;
    if (depths) depths[bin.selectedPocketSection] = next;
    bin.dispatch({ type: "UPDATE_CUTOUT", id: cutout.id,
      patch: cutout.split && depths ? { split: { ...cutout.split, depths } } : { depth: next },
      transient, historyLabel: cutout.split ? "Change section depth" : "Change pocket depth" });
  };
  const updateClearance = (clearanceMm: number, transient: boolean) => {
    if (cutout) bin.dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { clearanceMm }, transient, historyLabel: "Change pocket clearance" });
  };
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  return <div>
    {open && <MobileAdjustmentTray title={cutout ? pocketName(cutout, shape) : "Adjust bin"}
      onClose={() => onOpenChange(false)} onMore={() => onMore(cutout ? "bin-settings-pockets" : "bin-settings-size")}>
      {cutout && depth ? <>
        {cutout.split && <div className="mb-2 flex gap-2" role="group" aria-label="Section to edit">
          {([0, 1] as const).map(section => <Button key={section} className="min-h-11 flex-1" variant={bin.selectedPocketSection === section ? "secondary" : "outline"}
            aria-pressed={bin.selectedPocketSection === section} onClick={() => bin.dispatch({ type: "SELECT_CUTOUT", id: cutout.id, section })}>Section {section === 0 ? "A" : "B"}</Button>)}
        </div>}
        <div className="grid grid-cols-2 gap-4">
          {depth.mode === "through" ? <p className="text-xs">Through pocket. Change depth mode in More settings.</p> :
            <LabelledSlider id="quick-pocket-depth" label={depth.mode === "remaining" ? "Floor thickness" : "Pocket depth"}
              value={depth.mode === "remaining" ? depth.floorThicknessMm : depth.value} min={depth.mode === "remaining" ? 0 : 0.5}
              max={Math.max(7, bin.spec.heightUnits * 7)} step={0.5} format={mm} touchTarget
              onChange={value => updateDepth(depth.mode === "remaining" ? { mode: "remaining", floorThicknessMm: value } : { mode: "mm", value }, true)}
              onCommit={value => updateDepth(depth.mode === "remaining" ? { mode: "remaining", floorThicknessMm: value } : { mode: "mm", value }, false)} />}
          <LabelledSlider id="quick-pocket-clearance" label="Extra clearance" value={cutout.clearanceMm} min={-2} max={2} step={0.1} format={mm} touchTarget
            onChange={value => updateClearance(value, true)} onCommit={value => updateClearance(value, false)} />
        </div>
      </> : <>
        <LabelledSlider id="quick-bin-height" label="Bin height" value={bin.spec.heightUnits} min={1} max={12} step={0.5} format={value => `${value} units`} touchTarget
          onChange={heightUnits => bin.dispatch({ type: "PATCH_SPEC", patch: { heightUnits }, transient: true })}
          onCommit={heightUnits => bin.dispatch({ type: "PATCH_SPEC", patch: { heightUnits } })} />
        <p className="text-xs text-muted-foreground">Select a pocket to adjust its depth and clearance. More settings includes bin size, construction, and projects.</p>
      </>}
    </MobileAdjustmentTray>}
    <div className="flex gap-2">
      <Button variant="outline" className="min-h-11 flex-1 gap-2" onClick={() => onOpenChange(!open)} aria-expanded={open}><SlidersHorizontal className="h-4 w-4" aria-hidden />Adjust</Button>
      <Button className="min-h-11 flex-1" onClick={onExport}>Export bin</Button>
    </div>
  </div>;
}
