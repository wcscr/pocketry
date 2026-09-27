import { useId } from "react";
import { HelpHint } from "@/components/ui/help-hint";
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
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-xs">Show full corrected photo</Label>
        <HelpHint label="full corrected photo">Reveal tools extending beyond the paper. Scale, region, and contour edits stay unchanged.</HelpHint>
      </div>
      <Switch id={id} checked={correction.showFullPhoto ?? false} disabled={!correction.paperBounds}
        aria-describedby={correction.fullPhotoUnavailableReason ? `${id}-hint` : undefined} onCheckedChange={show => dispatch({ type: "SET_SHOW_FULL_PHOTO", show })} />
    </div>
    {correction.fullPhotoUnavailableReason && <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
      {correction.fullPhotoUnavailableReason}
    </p>}
  </div>;
}
