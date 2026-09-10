import { Portal } from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

/** Optional field guidance, available on hover, keyboard focus, and touch. */
export function HelpHint({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              // Radix closes tooltips on click by default. Keep a tap usable,
              // and avoid toggling an enclosing details summary.
              event.preventDefault();
              setOpen((current) => !current);
            }}
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <Portal>
          <TooltipContent side="top" className="max-w-64 text-xs font-normal leading-relaxed" onEscapeKeyDown={(event) => {
            event.stopPropagation();
            setOpen(false);
          }}>
            {children}
          </TooltipContent>
        </Portal>
      </Tooltip>
    </TooltipProvider>
  );
}
