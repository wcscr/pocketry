import { ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A settings disclosure whose visibility never mounts or unmounts its fields. */
export function SettingsGroup({ title, summary, open, onOpenChange, testId, children }: {
  title: string;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return <section className="min-w-0 rounded-lg border bg-background" data-settings-disclosure data-state={open ? "open" : "closed"}>
    <h3>
      <button type="button" id={`${id}-trigger`} aria-label={`${title} settings`} aria-describedby={`${id}-summary`} aria-expanded={open} aria-controls={`${id}-body`}
        data-settings-disclosure-trigger data-testid={`${testId}-trigger`}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={event => {
          // Closing from pointer or keyboard settles a focused numeric draft
          // through its existing blur transaction before hiding its field.
          event.currentTarget.focus({ preventScroll: true });
          onOpenChange(!open);
        }}>
        <ChevronRight aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span id={`${id}-summary`} className="block text-xs font-normal text-muted-foreground">{summary}</span>
        </span>
        <span aria-hidden className="shrink-0 text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
    </h3>
    <div id={`${id}-body`} hidden={!open} aria-labelledby={`${id}-trigger`} data-testid={`${testId}-body`} className="space-y-3 border-t px-3 py-3">
      {children}
    </div>
  </section>;
}
