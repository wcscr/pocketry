import { useId } from "react";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTrace } from "@/state/trace-store";

/** A comparison switch plus one explicit, undoable replacement action. */
export function DetectedOutlineControls() {
  const { detectedOutlineReview: review } = useTrace();
  const id = useId();
  return <TooltipProvider delayDuration={250}><div className="space-y-2" data-testid="detected-outline-controls">
    <Tooltip><TooltipTrigger asChild>
      <span className="flex items-center justify-between gap-3" tabIndex={review.unavailable ? 0 : undefined}>
        <Label htmlFor={id} className="text-xs">Detected outline</Label>
        <Switch id={id} checked={review.showing} disabled={!!review.unavailable} onCheckedChange={review.setShowing} />
      </span>
    </TooltipTrigger><TooltipContent className="max-w-64">
      {review.unavailable ?? "Preview the detected contour before smoothing and fitting. Your outline stays unchanged until you choose Use detected outline."}
    </TooltipContent></Tooltip>
    {review.showing && <Tooltip><TooltipTrigger asChild>
      <span className="block" tabIndex={review.pending || review.error || review.unchanged ? 0 : undefined}>
        <Button variant="outline" size="sm" className="w-full" disabled={review.pending || !!review.error || review.unchanged}
          onClick={review.useOutline}>
          {review.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : review.error ? <AlertCircle className="h-4 w-4" aria-hidden />
              : review.unchanged ? <Check className="h-4 w-4" aria-hidden /> : null}
          Use detected outline
        </Button>
      </span>
    </TooltipTrigger><TooltipContent className="max-w-64">{review.hint}</TooltipContent></Tooltip>}
    <span className="sr-only" role="status">{review.error ?? (review.showing ? review.pending ? "Preparing detected outline." : review.unchanged ? "Detected outline is already in use." : "Previewing detected outline. Your current outline is unchanged." : "")}</span>
  </div></TooltipProvider>;
}
