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
  return <div className="shrink-0 space-y-1 border-b bg-background px-3 py-2" data-testid="trace-photo-bounds-control">
    <div className="flex min-h-9 items-center gap-3">
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-xs font-medium">Show full photo</Label>
        <HelpHint label="full photo">For tools extending beyond the calibration sheet. Scale stays the same.</HelpHint>
      </div>
      <Switch id={id} checked={correction.showFullPhoto ?? false} disabled={!correction.paperBounds}
        aria-describedby={correction.fullPhotoUnavailableReason ? `${id}-unavailable` : undefined} onCheckedChange={show => dispatch({ type: "SET_SHOW_FULL_PHOTO", show })} />
    </div>
    {correction.fullPhotoUnavailableReason && <p id={`${id}-unavailable`} className="text-[11px] text-muted-foreground">
      {correction.fullPhotoUnavailableReason}
    </p>}
  </div>;
}
