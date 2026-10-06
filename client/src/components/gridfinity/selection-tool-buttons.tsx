import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlignHorizontalDistributeCenter, ChevronDown, Link2, Move3D, Rotate3D, MousePointer2 } from "lucide-react";
import { AddPocketMenu } from "./add-pocket-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { useBin } from "@/state/bin-store";
import { useSelectionInspector } from "./selection-inspector-context";
import { useObjectToolbar } from "./object-toolbar-context";

const tools = [
  { tool: "properties", Icon: MousePointer2, label: "Select objects", text: "Select", minimum: 0 },
  { tool: "translate", Icon: Move3D, label: "Move selected objects", text: "Move", minimum: 1 },
  { tool: "rotate", Icon: Rotate3D, label: "Rotate selected objects", text: "Rotate", minimum: 1 },
  { tool: "arrange", Icon: AlignHorizontalDistributeCenter, label: "Arrange selected objects", text: "Arrange", minimum: 2 },
  { tool: "links", Icon: Link2, label: "Link and unlink selected objects", text: "Link", minimum: 2 },
] as const;

/** Tools respond to their available space, including collapsed side panels. */
export function SelectionToolButtons({ count, onActivate, inactive = false, panning = false }: {
  count: number; onActivate: () => void; inactive?: boolean; panning?: boolean;
}): JSX.Element | null {
  const selectionInspector = useSelectionInspector();
  const objectToolbar = useObjectToolbar();
  const inspector = selectionInspector ?? objectToolbar;
  const { enabled } = useExperimentalFeatures();
  const { editorMode, selectedSurfaceTextId, dispatch } = useBin();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const target = inspector?.toolbar;
    if (!target) return;
    const update = () => setWide((target.getBoundingClientRect().width || (window.innerWidth >= 1100 ? window.innerWidth - 620 : window.innerWidth)) >= 540);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [inspector?.toolbar]);
  if (!inspector?.toolbar) return null;
  const textSelected = enabled && !!selectedSurfaceTextId;
  const available = tools.filter(item => item.tool !== "links" || enabled && !textSelected);
  const disabled = (item: typeof tools[number]) => panning || (textSelected ? item.tool === "arrange" || item.tool === "links" : count < item.minimum);
  const activate = (tool: typeof tools[number]["tool"]) => {
    if (textSelected && (tool === "translate" || tool === "rotate")) dispatch({ type: "SET_TEXT_TOOL", tool });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" }); onActivate(); inspector.setTool(tool);
  };
  const modeLabel = editorMode.startsWith("draw-") ? `Draw ${editorMode.slice(5)}` : editorMode === "contour" ? "Edit contour" : editorMode === "footprint" ? "Edit footprint" : editorMode === "split" ? "Split pocket" : "Choose label edge";
  if (editorMode !== "placement") return createPortal(<div className="flex min-w-0 flex-1 items-center justify-between gap-2 text-xs" role="status">
    <span className="truncate">{modeLabel}</span>
    <Button size="sm" className="min-h-11" aria-label={editorMode.startsWith("draw-") ? "Cancel drawing" : "Finish canvas editing"} onClick={() => activate("properties")}>{editorMode.startsWith("draw-") ? "Cancel" : "Done"}</Button>
  </div>, inspector.toolbar);
  return createPortal(<>
    <div className="shrink-0" role="group" aria-label="Add layout objects"><AddPocketMenu label="Add" includeFingerAccess onStart={onActivate} testId="toolbar-add-object" /></div>
    {available.filter(item => wide || item.tool === "properties").map(item => <Button key={item.tool} size="sm"
      variant={!inactive && !panning && inspector.tool === item.tool ? "secondary" : "ghost"}
      className="min-h-11 shrink-0 gap-1 px-2" disabled={disabled(item)} aria-label={item.label}
      title={textSelected && item.tool === "arrange" ? "Arrange applies to pockets and finger access. Text can move and rotate independently." : item.label}
      aria-pressed={!inactive && !panning && inspector.tool === item.tool} onClick={() => activate(item.tool)}><item.Icon className="h-4 w-4" />{item.text}</Button>)}
    {!wide && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="min-h-11 min-w-0 gap-1 px-2" aria-label="Tools">
      <span className="truncate">{inspector.tool === "properties" ? "Tools" : tools.find(item => item.tool === inspector.tool)?.text}</span><ChevronDown className="h-4 w-4 shrink-0" />
    </Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      {available.filter(item => item.tool !== "properties").map(item => <DropdownMenuItem key={item.tool} aria-label={item.label} className="min-h-11 gap-2" disabled={disabled(item)} onSelect={() => activate(item.tool)}><item.Icon className="h-4 w-4" />{item.text}</DropdownMenuItem>)}
      {textSelected && <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">Text moves and rotates independently. Arrange and Link apply to pockets and finger access.</p>}
    </DropdownMenuContent></DropdownMenu>}
  </>, inspector.toolbar);
}
