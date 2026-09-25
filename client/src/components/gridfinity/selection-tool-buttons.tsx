import { createPortal } from "react-dom";
import { AlignHorizontalDistributeCenter, Link2, Move3D, Rotate3D, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBin } from "@/state/bin-store";
import { useSelectionInspector } from "./selection-inspector-context";

/** Stable, labeled tools share the same selection in either canvas view. */
export function SelectionToolButtons({ count, onActivate, inactive = false, panning = false }: {
  count: number; onActivate: () => void; inactive?: boolean; panning?: boolean;
}): JSX.Element | null {
  const inspector = useSelectionInspector();
  const { editorMode, dispatch } = useBin();
  if (!inspector?.toolbar) return null;
  const modeLabel = editorMode.startsWith("draw-") ? `Draw ${editorMode.slice(5)}` : editorMode === "contour" ? "Edit contour" : editorMode === "footprint" ? "Edit footprint" : editorMode === "split" ? "Split pocket" : "Choose label edge";
  return createPortal(<>
    {editorMode !== "placement" && <div className="flex shrink-0 items-center gap-2 border-r pr-2 text-xs" role="status"><span>{modeLabel}</span><Button size="sm" className="h-9" aria-label="Finish canvas editing" onClick={() => { dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" }); inspector.setTool("properties"); }}>Done</Button></div>}
    {([
    { tool: "properties", Icon: MousePointer2, label: "Select objects", text: "Select", minimum: 0 },
    { tool: "translate", Icon: Move3D, label: "Move selected objects", text: "Move", minimum: 1 },
    { tool: "rotate", Icon: Rotate3D, label: "Rotate selected objects", text: "Rotate", minimum: 1 },
    { tool: "arrange", Icon: AlignHorizontalDistributeCenter, label: "Arrange selected objects", text: "Arrange", minimum: 2 },
    { tool: "links", Icon: Link2, label: "Link and unlink selected objects", text: "Link", minimum: 2 },
  ] as const).map(({ tool, Icon, label, text, minimum }) => <Button key={tool} size="sm"
    variant={!inactive && !panning && editorMode === "placement" && inspector.tool === tool ? "secondary" : "ghost"}
    className="h-10 shrink-0 gap-1.5 px-2 text-xs [@media(pointer:coarse)]:min-h-11"
    disabled={panning || count < minimum} aria-label={label} title={panning ? `Turn off Pan to ${text.toLowerCase()}` : label} aria-pressed={!inactive && !panning && editorMode === "placement" && inspector.tool === tool}
    onClick={() => { dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" }); onActivate(); inspector.setTool(tool); }}><Icon className="h-4 w-4" />{text}</Button>)}</>, inspector.toolbar);
}
