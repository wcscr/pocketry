import type { ComponentProps } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A visible affordance for native details, without changing its mounted contents. */
export function DisclosureSummary({ children, className, ...props }: ComponentProps<"summary">): JSX.Element {
  return <summary {...props} className={cn("disclosure-summary", className)}>
    <ChevronRight aria-hidden="true" className="disclosure-chevron h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none" />
    <span className="min-w-0 flex-1">{children}</span>
    <span aria-hidden="true" className="shrink-0 text-xs font-normal text-muted-foreground">
      <span className="disclosure-show">Show</span><span className="disclosure-hide">Hide</span>
    </span>
  </summary>;
}
