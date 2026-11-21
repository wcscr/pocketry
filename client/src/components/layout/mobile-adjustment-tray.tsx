import { useId, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Nonmodal quick adjustments: the sibling canvas stays visible and interactive. */
export function MobileAdjustmentTray({ title, children, onClose, onMore, className }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onMore: () => void;
  className?: string;
}) {
  const heading = useId();
  return <section aria-labelledby={heading} data-mobile-expanded="true" className={cn("mobile-adjustment-tray mb-2 max-h-[132px] overflow-y-auto overscroll-contain rounded-t-lg border bg-background p-2", className)}>
    <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-2 flex items-center gap-1 border-b bg-background px-2 py-1.5">
      <h2 id={heading} className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      <Button variant="outline" className="h-11 shrink-0 gap-2 bg-secondary/50 px-3 text-xs shadow-sm" onClick={onMore}>
        All properties
      </Button>
      <Button variant="outline" className="h-11 px-3" onClick={onClose}>Done</Button>
    </div>
    {children}
  </section>;
}
