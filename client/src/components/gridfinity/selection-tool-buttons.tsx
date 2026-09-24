import { AlignHorizontalDistributeCenter, Move3D, Rotate3D } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSelectionInspector } from "./selection-inspector-context";

/** The canvas toolbar selects a tool and opens its inspector in either view. */
export function SelectionToolButtons({ count, onActivate, inactive = false }: {
  count: number; onActivate: () => void; inactive?: boolean;
}): JSX.Element | null {
  const inspector = useSelectionInspector();
  if (!inspector) return null;
  return <>{([
    { tool: "translate", Icon: Move3D, label: "Move selected objects", hint: "Move (W)" },
    { tool: "rotate", Icon: Rotate3D, label: "Rotate selected objects", hint: "Rotate (E)" },
    ...(count > 1 ? [{ tool: "arrange", Icon: AlignHorizontalDistributeCenter, label: "Arrange selected objects", hint: "Align and distribute" }] : []),
  ] as const).map(({ tool, Icon, label, hint }) => <Button key={tool} size="icon" variant="ghost"
    className={cn("h-9 w-9 rounded-none border-t [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11", !inactive && inspector.tool === tool && "bg-accent text-accent-foreground")}
    disabled={!count} aria-label={label} title={hint} aria-pressed={!inactive && inspector.tool === tool}
    onClick={() => { onActivate(); inspector.setTool(tool as "translate" | "rotate" | "arrange"); }}><Icon className="h-4 w-4" /></Button>)}</>;
}
