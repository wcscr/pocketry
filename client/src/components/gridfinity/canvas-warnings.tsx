import { AlertTriangle, ChevronDown, CircleAlert } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { ValidationIssue } from "@shared/gridfinity/validate";

/** Persistent model feedback shared by Layout and 3D, separate from property fields. */
export function CanvasWarnings({ issues, selectedCutoutId, selectedFingerHoleId, onRevealIssue }: {
  issues: readonly ValidationIssue[];
  selectedCutoutId: string | null;
  selectedFingerHoleId: string | null;
  onRevealIssue: (issue: ValidationIssue) => void;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (issues.length === 0) return null;

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const summary = [
    errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"}` : null,
    warnings > 0 ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : null,
  ].filter(Boolean).join(" · ");
  // Keep a stable order while selecting and cycling through overlapping pockets.
  const orderedIssues = [...issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));

  return (
    // Leave the canvas gesture hint visible beneath the warning panel.
    <section
      className={cn(
        "absolute bottom-12 right-3 z-30 flex max-h-[min(50%,22rem)] max-w-[calc(100%_-_1.5rem)] flex-col overflow-hidden rounded-lg border bg-background/95 shadow-md backdrop-blur",
        expanded ? "w-80" : "w-auto motion-safe:animate-warning-attention",
        errors > 0 ? "border-destructive/40 [--warning-pulse-color:239_68_68]" : "border-amber-500/40 [--warning-pulse-color:245_158_11]",
      )}
      aria-label="Model warnings and errors"
      data-testid="canvas-warnings"
    >
      <button
        type="button"
        className="flex min-h-10 shrink-0 items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${summary}`}
        aria-expanded={expanded}
        aria-controls="canvas-warning-list"
        onClick={() => setExpanded(!expanded)}
      >
        {errors > 0 ? <CircleAlert className="h-4 w-4 shrink-0 text-destructive" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
        <span className="flex-1" role="status" aria-live="polite" aria-atomic="true">{summary}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none", !expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div id="canvas-warning-list" className="min-h-0 space-y-1 overflow-y-auto overscroll-contain border-t p-2">
          {orderedIssues.map((issue, index) => {
            const selected = Boolean(
              (selectedCutoutId && issue.cutoutIds?.includes(selectedCutoutId)) ||
              (selectedFingerHoleId && issue.fingerHoleIds?.includes(selectedFingerHoleId)),
            );
            return (
              <button
                type="button"
                key={`${issue.code}-${issue.cutoutIds?.join(",") ?? issue.fingerHoleIds?.join(",") ?? index}`}
                data-issue-code={issue.code}
                data-selected={selected || undefined}
                onClick={() => onRevealIssue(issue)}
                className={cn(
                  "block w-full rounded-md border px-2.5 py-2 text-left text-xs leading-relaxed hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  issue.severity === "error" ? "border-destructive/30 text-destructive" : "border-amber-500/25 text-amber-900 dark:text-amber-100",
                  selected && "bg-accent/60",
                )}
              >
                <span className="block">{issue.message}</span>
                <span className="mt-1 block font-medium underline underline-offset-2">
                  {issue.cutoutIds?.length ? issue.cutoutIds.length > 1 ? "Show pockets · click to switch" : "Edit pocket" : issue.fingerHoleIds?.length ? "Edit finger access" : "Open bin settings"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
