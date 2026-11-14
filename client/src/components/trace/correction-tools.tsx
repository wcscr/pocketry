import { Brush, Check, Hand, Minus, Plus, Trash2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type CorrectionTool = "tool" | "paper" | "pan";

/** The correction tools replace the ordinary toolbar while marking the photo. */
export function CorrectionTools({ tool, busy, hasMarks, onTool, onClear, onDone }: {
  tool: CorrectionTool; busy: boolean; hasMarks: boolean;
  onTool: (tool: CorrectionTool) => void; onClear: () => void; onDone: () => void;
}) {
  return <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Correction tools">
    <CorrectionButton icon={Plus} label="Add" pressed={tool === "tool"} disabled={busy}
      className={tool === "tool" ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-200" : undefined}
      hint="Draw inside missing tool material. The outline updates after each stroke; Undo restores the previous result."
      onClick={() => onTool("tool")}>Add</CorrectionButton>
    <CorrectionButton icon={Minus} label="Remove" pressed={tool === "paper"} disabled={busy}
      className={tool === "paper" ? "bg-rose-100 text-rose-900 hover:bg-rose-200 dark:bg-rose-950 dark:text-rose-200" : undefined}
      hint="Draw on unwanted background or shadow. The outline updates after each stroke; Undo restores the previous result."
      onClick={() => onTool("paper")}>Remove</CorrectionButton>
    <CorrectionButton icon={Hand} label="Pan while correcting" pressed={tool === "pan"}
      hint="Move the photo without marking it. You can also hold Space while dragging."
      onClick={() => onTool("pan")} />
    <CorrectionButton icon={Trash2} label="Clear correction marks" disabled={busy || !hasMarks}
      hint="Clear all correction marks and detect again with the current settings. Undo restores the corrections."
      onClick={onClear} />
    <CorrectionButton icon={Check} label="Done correcting" hint="Finish correcting and hide the marks. Changes are already applied. Escape also finishes."
      onClick={onDone}>Done</CorrectionButton>
  </div>;
}

export function CorrectButton({ unavailable, hasMarks, onClick }: { unavailable?: string; hasMarks: boolean; onClick: () => void }) {
  return <CorrectionButton icon={Brush} label="Correct" disabled={!!unavailable}
    hint={unavailable ?? "Add missing tool material or remove unwanted background by marking the photo."} onClick={onClick}>
    Correct{hasMarks && <Check className="h-3 w-3" aria-label="Corrections applied" />}
  </CorrectionButton>;
}

function CorrectionButton({ icon: Icon, label, hint, children, pressed, disabled, className, onClick }: {
  icon: ComponentType<{ className?: string }>; label: string; hint: string; children?: ReactNode;
  pressed?: boolean; disabled?: boolean; className?: string; onClick: () => void;
}) {
  return <Tooltip><TooltipTrigger asChild>
    <span className="inline-flex" tabIndex={disabled ? 0 : undefined}>
      <Button variant={pressed ? "secondary" : "ghost"} className={cn("h-11 gap-1.5 px-2", !children && "w-11 px-0", pressed && "ring-1 ring-current/30", className)}
        aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
        <Icon className="h-4 w-4" />{children}
      </Button>
    </span>
  </TooltipTrigger><TooltipContent side="bottom" className="max-w-64">{hint}</TooltipContent></Tooltip>;
}
