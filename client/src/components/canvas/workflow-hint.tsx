import { Lightbulb } from "lucide-react";

import { cn } from "@/lib/utils";

/** A brief emphasis on changed guidance, with steady text and reduced-motion support. */
export function WorkflowHint({ children, className }: { children: string; className?: string }) {
  return (
    <div key={children} role="status" className={cn(
      "workflow-hint flex items-center gap-2 rounded-md border border-sky-500/50 bg-sky-50 px-3 py-2 text-sm font-medium leading-snug text-sky-950 dark:bg-sky-950 dark:text-sky-100",
      className,
    )}>
      <Lightbulb aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
