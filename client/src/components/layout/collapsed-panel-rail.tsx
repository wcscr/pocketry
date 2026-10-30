import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Keep the panel's name and opening direction visible after it collapses. */
export function CollapsedPanelRail({ label, side, controls, onExpand, className, testId, ariaLabel, title }: {
  label: string;
  side: "left" | "right";
  controls: string;
  onExpand: () => void;
  className?: string;
  testId: string;
  ariaLabel?: string;
  title?: string;
}) {
  const description = `${label} collapsed — click to expand`;
  return <button type="button" data-testid={testId} aria-label={ariaLabel ?? `Expand ${label.toLowerCase()} panel`}
    aria-controls={controls} aria-expanded={false} title={title ?? description} onClick={onExpand}
    className={cn("group relative flex h-full w-8 shrink-0 cursor-pointer flex-col items-center bg-blue-500/5 pt-4 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-foreground focus-visible:z-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
      side === "left" ? "border-r border-blue-500/20 shadow-[inset_-3px_0_8px_-4px_rgb(59_130_246/0.3)]" : "border-l border-blue-500/20 shadow-[inset_3px_0_8px_-4px_rgb(59_130_246/0.3)]",
      className)}>
    <span className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center text-blue-600 dark:text-blue-400" aria-hidden="true">
      {side === "left" ? <ChevronRight className="h-5 w-5" strokeWidth={2.5} /> : <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />}
    </span>
    <span className="text-xs font-medium tracking-wide [writing-mode:vertical-rl]">{label}</span>
  </button>;
}
