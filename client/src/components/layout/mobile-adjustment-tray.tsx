import { useId, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Nonmodal quick adjustments: the sibling canvas stays visible and interactive. */
export function MobileAdjustmentTray({ title, children, onClose, onMore }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onMore: () => void;
}) {
  const heading = useId();
  return <section aria-labelledby={heading} data-mobile-expanded="true" className="mobile-adjustment-tray mb-2 max-h-[32dvh] overflow-y-auto rounded-t-lg border bg-background p-2">
    <div className="mb-2 flex items-center gap-2">
      <h2 id={heading} className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      <Button variant="outline" className="h-11 shrink-0 gap-2 bg-secondary/50 px-3 text-xs shadow-sm" onClick={onMore}>
        <Settings2 className="h-4 w-4" aria-hidden />More settings
      </Button>
      <Button variant="outline" className="h-11 px-3" onClick={onClose}>Done</Button>
    </div>
    {children}
  </section>;
}
