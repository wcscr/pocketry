import { Check, Loader2, Minus } from "lucide-react";
import { Portal } from "@radix-ui/react-tooltip";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  alreadyApplied: boolean;
  result?: { changed: boolean; before: number; after: number; maxDeviation: number };
  pending?: boolean;
  error?: string;
  showOriginal: boolean;
  onCompare: (original: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}

/** One automatic preview, a visual comparison and an undoable Apply. */
export function OutlineSimplificationPanel(props: Props) {
  const { alreadyApplied, result, pending, error, showOriginal } = props;
  const noChange = !!result && !result.changed && !pending;
  const applyHint = pending ? "Updating preview…" : alreadyApplied ? "Smoothing is already applied."
    : noChange ? "Smoothing would not change the outline." : error ? "Resolve the preview error before applying." : "Apply this preview to the outline.";
  return <TooltipProvider delayDuration={250}><div className="w-full space-y-4" aria-busy={!!pending}>
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Smooth outline</h3>
        {(alreadyApplied || noChange) && <Tooltip><TooltipTrigger asChild>
          <span tabIndex={0} role="img" aria-label={applyHint} className="inline-flex text-muted-foreground">
            {alreadyApplied ? <Check className="h-4 w-4" aria-hidden="true" data-testid="applied-simplification" />
              : <Minus className="h-4 w-4" aria-hidden="true" data-testid="unchanged-simplification" />}
          </span>
        </TooltipTrigger><Portal><TooltipContent className="text-xs">{applyHint}</TooltipContent></Portal></Tooltip>}
      </div>
      <p className="text-xs text-muted-foreground">Smooth small bumps while keeping the overall shape.</p>
    </div>

    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
      <span role="status" className="text-muted-foreground">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        <span className="sr-only">{pending ? "Updating preview…" : alreadyApplied ? "Smoothing is already applied."
          : result ? result.changed ? "Preview ready." : "Smoothing would not change the outline."
          : "Preparing preview…"}</span>
      </span>
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Compare outline">
        <Button size="sm" variant={showOriginal ? "secondary" : "ghost"} className="px-2 text-xs"
          aria-pressed={showOriginal} disabled={!result || noChange} onClick={() => props.onCompare(true)}>Original</Button>
        <Button size="sm" variant={!showOriginal ? "secondary" : "ghost"} className="gap-1 px-2 text-xs"
          aria-pressed={!showOriginal} disabled={!result || noChange} onClick={() => props.onCompare(false)}>
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />Preview
        </Button>
      </div>
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end gap-2 border-t pt-3">
      <Button size="sm" variant="outline" className="min-h-10" onClick={props.onCancel}>Cancel</Button>
      <Tooltip><TooltipTrigger asChild>
        <span tabIndex={pending || !result?.changed ? 0 : undefined} aria-label={pending || !result?.changed ? applyHint : undefined}>
          <Button size="sm" className="min-h-10 min-w-20" disabled={pending || !result?.changed} onClick={props.onApply}>Apply</Button>
        </span>
      </TooltipTrigger><Portal><TooltipContent className="max-w-64 text-xs">{applyHint}</TooltipContent></Portal></Tooltip>
    </div>
  </div></TooltipProvider>;
}
