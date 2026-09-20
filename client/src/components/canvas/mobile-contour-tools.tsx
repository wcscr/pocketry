import { Check, Move, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ContourTool } from "@/hooks/use-mobile-contour-editor";

/** Explicit operations prevent a missed point from silently adding a new one. */
export function MobileContourTools({ tool, onChange, onDone }: {
  tool: ContourTool; onChange: (tool: ContourTool) => void; onDone: () => void;
}) {
  return <div role="group" aria-label="Contour editing tools" className="flex rounded-md border bg-background/95 p-1 shadow-sm">
    {([{ value: "move", label: "Move", icon: Move }, { value: "add", label: "Add", icon: Plus },
      { value: "remove", label: "Remove", icon: Minus }] as const).map(item =>
      <Button key={item.value} className="h-11 gap-1 px-2 text-xs" variant={tool === item.value ? (item.value === "remove" ? "destructive" : "secondary") : "ghost"}
        aria-label={`${item.label} contour points`} aria-pressed={tool === item.value} onClick={() => onChange(item.value)}>
        <item.icon className="h-4 w-4" aria-hidden />{item.label}
      </Button>)}
    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Finish contour editing" onClick={onDone}><Check className="h-4 w-4" /></Button>
  </div>;
}
