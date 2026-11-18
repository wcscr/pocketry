import { BoxSelect, Brush, Check, Eraser, Hand, Trash2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type CorrectionTool = "points" | "tool" | "paper" | "pan";

interface CorrectionToolsProps {
  tool: CorrectionTool;
  busy: boolean;
  addFeedback?: string;
  pointUnavailable?: string;
  brushUnavailable?: string;
  hasMarks: boolean;
  onTool: (tool: CorrectionTool) => void;
  onClear: () => void;
  onDone: () => void;
  children: ReactNode;
}

/** Keep point selection and the two detection brushes in the same correction session. */
export function CorrectionTools({ tool, busy, addFeedback, pointUnavailable, brushUnavailable, hasMarks, onTool, onClear, onDone, children }: CorrectionToolsProps) {
  const guidance: Record<CorrectionTool, string> = {
    points: "Pick points or drag a box around them. Drag a selected point to move the group.",
    tool: "Purple shows the pocket. Brush to add material, or draw a loop to fill a gap.",
    paper: "Brush over unwanted background to remove it from the outline.",
    pan: "Drag to move the photo.",
  };
  return <section aria-label="Correction tools" className="border-b bg-background px-2 pb-2">
    <header className="flex items-center justify-between gap-2 px-1 py-1">
      <h2 className="text-sm font-semibold">Correct outline</h2>
      <Button size="sm" variant="outline" aria-label="Done correcting" onClick={onDone}>Done</Button>
    </header>
    <div role="group" aria-label="Correction tool" className="grid grid-cols-3 gap-1 rounded-md bg-muted/50 p-1 [&_button]:h-12 [&_button]:w-full [&_button]:flex-col [&_button]:gap-0.5 [&_button]:px-1 [&_button]:text-xs">
      <CorrectionButton icon={BoxSelect} label="Select points" pressed={tool === "points"} disabled={busy || !!pointUnavailable}
        hint={pointUnavailable ?? "Select individual points or drag a selection box."} onClick={() => onTool("points")}>Select points</CorrectionButton>
      <CorrectionButton icon={Brush} label="Add area" pressed={tool === "tool"} disabled={busy || !!brushUnavailable}
        className={tool === "tool" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : undefined}
        hint={brushUnavailable ?? guidance.tool} onClick={() => onTool("tool")}>Add area</CorrectionButton>
      <CorrectionButton icon={Eraser} label="Remove area" pressed={tool === "paper"} disabled={busy || !!brushUnavailable}
        className={tool === "paper" ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" : undefined}
        hint={brushUnavailable ?? guidance.paper} onClick={() => onTool("paper")}>Remove area</CorrectionButton>
    </div>
    <p className="px-1 py-1 text-xs leading-relaxed text-muted-foreground" role="status">
      {busy ? "Updating the outline…" : tool === "tool" && addFeedback ? `${addFeedback} Purple shows the full pocket area.` : guidance[tool]}
    </p>
    {brushUnavailable && <p className="px-1 pb-1 text-xs text-muted-foreground">{brushUnavailable}</p>}
    <div className="flex flex-wrap items-center gap-1.5 empty:hidden">{children}</div>
    {hasMarks && <CorrectionButton icon={Trash2} label="Clear correction marks" disabled={busy || !!brushUnavailable}
      hint="Clear all brush marks and detect again. Undo restores them." onClick={onClear}>Clear marks</CorrectionButton>}
  </section>;
}

export function CorrectionPanButton({ pressed, onClick }: { pressed: boolean; onClick: () => void }) {
  return <CorrectionButton icon={Hand} label="Pan while correcting" pressed={pressed}
    hint="Move the photo. You can also hold Space while dragging." onClick={onClick} />;
}

export function CorrectButton({ unavailable, hasMarks, onClick }: { unavailable?: string; hasMarks: boolean; onClick: () => void }) {
  return <CorrectionButton icon={Brush} label="Correct" disabled={!!unavailable}
    hint={unavailable ?? "Select outline points or correct the boundary with a brush."} onClick={onClick}>
    Correct{hasMarks && <Check className="h-3 w-3" aria-label="Corrections applied" />}
  </CorrectionButton>;
}

function CorrectionButton({ icon: Icon, label, hint, children, pressed, disabled, className, onClick }: {
  icon: ComponentType<{ className?: string }>; label: string; hint: string; children?: ReactNode;
  pressed?: boolean; disabled?: boolean; className?: string; onClick: () => void;
}) {
  return <Tooltip><TooltipTrigger asChild>
    <span className="pointer-events-auto inline-flex" tabIndex={disabled ? 0 : undefined}>
      <Button variant={pressed ? "secondary" : "ghost"} className={cn("h-11 gap-1.5 px-2", !children && "w-11 px-0", pressed && "ring-1 ring-current/30", className)}
        aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onClick(); }}>
        <Icon className="h-4 w-4" />{children}
      </Button>
    </span>
  </TooltipTrigger><TooltipContent side="bottom" className="max-w-64">{hint}</TooltipContent></Tooltip>;
}
