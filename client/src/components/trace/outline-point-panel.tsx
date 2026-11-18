import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";

export type OutlinePointTool = "edit" | "select" | "erase";

interface Props {
  tool: OutlinePointTool;
  contour?: string;
  mobile: boolean;
  canErase: boolean;
  onToolChange: (tool: OutlinePointTool) => void;
  onDone: () => void;
  advanced: ReactNode;
  children: ReactNode;
}

/** Direct manipulation is the default. Closing More tools returns to those gestures. */
export function OutlinePointPanel({ tool, contour, mobile, canErase, onToolChange, onDone, advanced, children }: Props) {
  const [expanded, setExpanded] = useState(tool !== "edit");
  const instructions: Record<OutlinePointTool, string> = {
    edit: mobile ? "Tap the outline to add a point. Drag to move it. Tap a point, then choose Delete point."
      : "Click the outline to add a point. Drag a point to move it. Right-click a point to delete it.",
    select: mobile ? "Tap points to select them. Drag a selected point to move the group."
      : "Click points or drag a box to select them. Drag a selected point to move the group.",
    erase: "Click a point to remove it. Undo restores it.",
  };
  const toggleTool = (value: OutlinePointTool) => onToolChange(tool === value ? "edit" : value);
  return (
    <section aria-label="Outline editing controls" className="border-b bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background px-3 pt-1">
        <h2 className="text-sm font-semibold">Edit outline</h2>
        {contour && <span className="text-xs text-muted-foreground">{contour}</span>}
        <Button size="sm" variant="outline" className="ml-auto" onClick={onDone}>Done</Button>
      </header>
      <div className="px-3 pb-1">
        <p className="py-1 text-xs leading-relaxed text-muted-foreground">{instructions[tool]}</p>
        <div className="flex flex-wrap items-center gap-1.5 empty:hidden">{children}</div>
        <button type="button" aria-expanded={expanded}
          className="flex min-h-8 items-center gap-1 rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"
          onClick={() => {
            if (expanded && tool !== "edit") onToolChange("edit");
            setExpanded(!expanded);
          }}>
          <span>More tools</span><ChevronDown aria-hidden="true" className={expanded ? "size-3.5 rotate-180" : "size-3.5"} />
        </button>
        {expanded && <div role="group" aria-label="More outline tools" className="flex flex-wrap items-center gap-1.5 border-t py-2">
          <Button size="sm" variant={tool === "select" ? "default" : "outline"} aria-pressed={tool === "select"}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); toggleTool("select"); }}>Select points</Button>
          {canErase && <Button size="sm" variant={tool === "erase" ? "default" : "outline"} aria-pressed={tool === "erase"}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); toggleTool("erase"); }}>Erase points</Button>}
          {advanced}
        </div>}
      </div>
    </section>
  );
}
