import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTrace } from "@/state/trace-store";

/** Change the visible photo bounds without rewarping or discarding trace edits. */
export function TracePhotoBoundsControl(): JSX.Element | null {
  const { perspectiveCorrection: correction, dispatch } = useTrace();
  const id = useId();
  if (!correction?.paperBounds && !correction?.fullPhotoUnavailableReason) return null;
  return <div className="space-y-1.5 rounded-md border p-2" data-testid="trace-photo-bounds-control">
    <div className="flex min-h-9 items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs">Show full corrected photo</Label>
      <Switch id={id} checked={correction.showFullPhoto ?? false} disabled={!correction.paperBounds}
        aria-describedby={`${id}-hint`} onCheckedChange={show => dispatch({ type: "SET_SHOW_FULL_PHOTO", show })} />
    </div>
    <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
      {correction.fullPhotoUnavailableReason ?? "For tools extending beyond the paper. Scale, region, and contour edits stay unchanged."}
    </p>
  </div>;
}
