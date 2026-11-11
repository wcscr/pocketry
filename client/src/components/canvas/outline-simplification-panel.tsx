import { Button } from "@/components/ui/button";

interface Props {
  presets: readonly { value: string; label: string }[];
  preset?: string;
  result?: { changed: boolean; before: number; after: number; maxDeviation: number };
  pending?: boolean;
  error?: string;
  showOriginal: boolean;
  onPreset: (value: string) => void;
  onCompare: (original: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}

/** Three smoothing levels, a visual comparison and an undoable Apply. */
export function OutlineSimplificationPanel(props: Props) {
  const { presets, preset, result, pending, error, showOriginal } = props;
  return <div className="w-full space-y-4" aria-busy={!!pending}>
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">Auto simplify outline</h3>
      <p className="text-xs text-muted-foreground">Smooth small bumps while keeping the overall shape.</p>
    </div>

    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Simplification amount">
        {presets.map(p => <Button key={p.value} size="sm" variant={preset === p.value ? "default" : "ghost"}
          className="min-h-10 px-2 text-xs" aria-pressed={preset === p.value}
          onClick={() => props.onPreset(p.value)}>{p.label}</Button>)}
      </div>
      <p className="text-xs text-muted-foreground">{preset === "fine" ? "Keep small features and corners."
        : preset === "smooth" ? "Remove more bumps for a smoother edge."
        : preset === "balanced" ? "Keep the shape while reducing small bumps."
        : "Using your custom amount."}</p>
    </div>

    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-xs tabular-nums">{pending ? "Updating preview…"
        : result ? result.changed ? "Preview ready." : "No smoother outline at this setting."
        : "Choose an amount to preview."}</p>
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Compare outline">
        <Button size="sm" variant={showOriginal ? "secondary" : "ghost"} className="px-2 text-xs"
          aria-pressed={showOriginal} disabled={!result} onClick={() => props.onCompare(true)}>Original</Button>
        <Button size="sm" variant={!showOriginal ? "secondary" : "ghost"} className="gap-1 px-2 text-xs"
          aria-pressed={!showOriginal} disabled={!result} onClick={() => props.onCompare(false)}>
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />Preview
        </Button>
      </div>
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end gap-2 border-t pt-3">
      <Button size="sm" variant="outline" className="min-h-10" onClick={props.onCancel}>Cancel</Button>
      <Button size="sm" className="min-h-10 min-w-20" disabled={pending || !result?.changed} onClick={props.onApply}>Apply</Button>
    </div>
  </div>;
}
