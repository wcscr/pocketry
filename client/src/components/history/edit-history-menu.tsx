import { Check, History } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface EditHistoryItem {
  label: string;
}

export interface EditHistoryMenuProps {
  entries: readonly EditHistoryItem[];
  index: number;
  onJump: (index: number) => void;
  /** Optional custom trigger; the standard history icon is used otherwise. */
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
  testId?: string;
}

/**
 * A compact, shared history browser for Trace and Bin. Newest entries appear
 * first, redo states remain visible above the current marker, and selecting
 * any entry jumps directly to that exact document state.
 */
export function EditHistoryMenu({
  entries,
  index,
  onJump,
  trigger,
  align = "end",
  testId = "button-edit-history",
}: EditHistoryMenuProps): JSX.Element {
  const reversed = entries.map((entry, entryIndex) => ({
    entry,
    entryIndex,
  })).reverse();

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Show edit history"
            title="Show edit history"
            data-testid={testId}
          >
            <History className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-72 p-0"
        data-testid={`${testId}-menu`}
      >
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Edit history</p>
          <p className="text-[11px] text-muted-foreground">
            Step {index + 1} of {entries.length} · choose a step to return to it
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {reversed.map(({ entry, entryIndex }) => {
            const current = entryIndex === index;
            const redo = entryIndex > index;
            return (
              <button
                key={`${entryIndex}-${entry.label}`}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                  current
                    ? "bg-accent font-medium text-accent-foreground"
                    : "hover:bg-accent/60",
                  redo && "text-muted-foreground",
                )}
                onClick={() => onJump(entryIndex)}
                aria-current={current ? "step" : undefined}
                data-testid={`history-step-${entryIndex}`}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] tabular-nums",
                    current && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {current ? <Check className="h-2.5 w-2.5" /> : entryIndex + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {current && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    Current
                  </span>
                )}
                {redo && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    Redo
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
