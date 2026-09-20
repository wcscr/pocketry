import { useRef, useState, type PointerEvent } from "react";
import { Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Dismissal belongs to a workflow step, not each changing instruction within it. */
export function WorkflowHint({ children, className, hintKey = children }: {
  children: string;
  className?: string;
  hintKey?: string;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const hidden = dismissed.has(hintKey);
  const dismiss = () => setDismissed(keys => new Set(keys).add(hintKey));
  const finishSwipe = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    start.current = null;
    if (origin?.id === event.pointerId && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 48) dismiss();
  };
  return <div className={cn("pointer-events-none flex justify-end", className)}>
    {hidden ? <Button variant="outline" size="icon" className="pointer-events-auto h-11 w-11 bg-background/95 shadow-sm"
      aria-label="Show current hint" onClick={() => setDismissed(keys => {
        const next = new Set(keys); next.delete(hintKey); return next;
      })}><Lightbulb className="h-4 w-4" aria-hidden /></Button> :
      <div key={hintKey} role="status" className="workflow-hint pointer-events-auto flex w-full touch-none select-none items-center gap-2 rounded-md border border-sky-500/50 bg-sky-50 pl-3 text-sm font-medium leading-snug text-sky-950 dark:bg-sky-950 dark:text-sky-100"
        onPointerDown={event => {
          event.stopPropagation();
          if ((event.target as Element).closest("button") || event.button !== 0) return;
          start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={event => event.stopPropagation()}
        onPointerUp={event => { event.stopPropagation(); finishSwipe(event); }}
        onPointerCancel={() => { start.current = null; }}>
        <Lightbulb aria-hidden className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 py-2">{children}</span>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-inherit" aria-label="Dismiss hint" onClick={dismiss}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>}
  </div>;
}
