import type { CutoutPlacement } from "@shared/gridfinity/cutout";
import { pocketColorAxis } from "@shared/gridfinity/pocket-color";
import { useBin } from "@/state/bin-store";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/ui/help-hint";
import { Button } from "@/components/ui/button";

/** Placement-specific appearance: linked geometry may have different color
 * references when copies are oriented differently. Changes are undoable. */
export function PocketColorControls({ cutout, enabled, onEnable }: {
  cutout: CutoutPlacement; enabled: boolean; onEnable: () => void;
}): JSX.Element | null {
  const { dispatch } = useBin();
  if (cutout.role === "hole") return null;
  const update = (patch: Partial<CutoutPlacement>) => dispatch({ type: "UPDATE_CUTOUT", id: cutout.id,
    patch, historyLabel: "Change pocket color coverage" });
  const coverage = cutout.colorCoverage ?? "floor";
  const direction = pocketColorAxis(cutout);
  const angle = Math.acos(Math.min(1, Math.max(0, direction.z))) * 180 / Math.PI;
  const reference = cutout.colorFloorAxis ?? "vertical";
  const followsVertical = reference === "vertical" || reference === "insertion" && cutout.insertionMode === "vertical";
  const referenceDescription = reference === "insertion" && !cutout.insertionMode
    ? "No insertion clearance: follows object Z."
    : followsVertical ? "Fixed to the bin’s vertical direction." : "The object axis moves with its rotation.";
  return <details className="border-t py-2 text-xs" data-testid="pocket-color-controls">
    <summary className="cursor-pointer py-1 font-medium">Pocket color</summary>
    <div className="space-y-2 pt-2">
      {!enabled && <div className="space-y-1"><p className="text-muted-foreground">Pocket coloring is off for this bin. Your coverage settings are saved.</p>
        <Button size="sm" variant="outline" onClick={onEnable}>Enable pocket coloring</Button></div>}
      <Label className="block space-y-1 text-xs"><span>Color coverage</span>
        <select className="h-9 w-full rounded border bg-background px-2" aria-label="Pocket color coverage" value={coverage}
          onChange={event => update({ colorCoverage: event.target.value as "floor" | "interior" })}>
          <option value="floor">Floor only</option><option value="interior">Entire interior</option>
        </select>
      </Label>
      {coverage === "floor" ? <>
        <Label className="block space-y-1 text-xs"><span className="flex items-center gap-1">Floor reference <HelpHint label="floor color reference">Colors the object's supporting surface opposite this direction, including curved or stepped bottoms. Extra insertion-clearance walls keep the bin color. This changes color only; insertion clearance and pocket dimensions stay the same.</HelpHint></span>
          <select className="h-9 w-full rounded border bg-background px-2" aria-label="Pocket floor color reference" value={reference}
            onChange={event => update({ colorFloorAxis: event.target.value as NonNullable<CutoutPlacement["colorFloorAxis"]> })}>
            <option value="insertion">Follow insertion axis</option><option value="vertical">Bin vertical</option>
            <option value="x">Object X — width</option><option value="y">Object Y — length</option><option value="z">Object Z — thickness</option>
          </select>
        </Label>
        <p className="text-muted-foreground">{angle.toFixed(1)}° from vertical. {referenceDescription}</p>
      </> : <p className="text-muted-foreground">Colors a lining on the walls and floor below the bin surface.</p>}
      <p className="text-muted-foreground">Color and lining thickness are set in Materials &amp; Colors. Applies only to this pocket.</p>
    </div>
  </details>;
}
