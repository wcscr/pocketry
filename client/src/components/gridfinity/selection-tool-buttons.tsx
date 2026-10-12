import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlignHorizontalDistributeCenter, ArrowLeft, ChevronDown, History, Link2, MoreHorizontal, Move3D, Rotate3D, MousePointer2, Redo2, Undo2 } from "lucide-react";
import { AddPocketMenu } from "./add-pocket-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { useBin } from "@/state/bin-store";
import { useSelectionInspector } from "./selection-inspector-context";
import { useObjectToolbar } from "./object-toolbar-context";
import { useMobileObjectTools } from "./mobile-object-tools-context";

const tools = [
  { tool: "properties", Icon: MousePointer2, label: "Select objects", text: "Select", minimum: 0 },
  { tool: "translate", Icon: Move3D, label: "Move selected objects", text: "Move", minimum: 1 },
  { tool: "rotate", Icon: Rotate3D, label: "Rotate selected objects", text: "Rotate", minimum: 1 },
  { tool: "arrange", Icon: AlignHorizontalDistributeCenter, label: "Arrange selected objects", text: "Arrange", minimum: 2 },
  { tool: "links", Icon: Link2, label: "Link and unlink selected objects", text: "Link", minimum: 2 },
] as const;

/** Tools respond to their available space, including collapsed side panels. */
export function SelectionToolButtons({ count, onActivate, inactive = false, panning = false, ruler, navigation = [] }: {
  count: number; onActivate: () => void; inactive?: boolean; panning?: boolean;
  ruler?: ReactNode;
  navigation?: { label: string; onSelect: () => void; disabled?: boolean; testId?: string }[];
}): JSX.Element | null {
  const selectionInspector = useSelectionInspector();
  const objectToolbar = useObjectToolbar();
  const mobile = useMobileObjectTools();
  const inspector = selectionInspector ?? objectToolbar;
  const { enabled } = useExperimentalFeatures();
  const { editorMode, selectedSurfaceTextId, dispatch, canUndo, canRedo, history } = useBin();
  const [wide, setWide] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // The focused item is replaced when moving between the two menu pages.
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
  }, [showHistory]);
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
  const textSelected = !!selectedSurfaceTextId;
  const available = tools.filter(item => item.tool !== "links" || enabled && !textSelected);
  const primary = (item: typeof tools[number]) => !mobile && wide || item.tool === "properties" || !!mobile && (item.tool === "translate" || item.tool === "rotate");
  const disabled = (item: typeof tools[number]) => panning || (textSelected ? item.tool === "arrange" || item.tool === "links" : count < item.minimum);
  const activate = (tool: typeof tools[number]["tool"]) => {
    if (textSelected && (tool === "translate" || tool === "rotate")) dispatch({ type: "SET_TEXT_TOOL", tool });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" }); onActivate(); inspector.setTool(tool);
  };
  const modeLabel = editorMode.startsWith("draw-") ? `Draw ${editorMode.slice(5)}` : editorMode === "contour" ? "Edit contour" : editorMode === "footprint" ? "Edit footprint" : editorMode === "split" ? "Split pocket" : "Choose label edge";
  const editingStatus = <div className="flex min-w-0 flex-1 items-center justify-between gap-2 text-xs" role="status">
    <span className="truncate">{modeLabel}</span>
    <Button size="sm" className="min-h-11" aria-label={editorMode.startsWith("draw-") ? "Cancel drawing" : "Finish canvas editing"} onClick={() => activate("properties")}>{editorMode.startsWith("draw-") ? "Cancel" : "Done"}</Button>
  </div>;
  if (!mobile && editorMode !== "placement") return createPortal(editingStatus, inspector.toolbar);
  return createPortal(<>
    {editorMode !== "placement" ? editingStatus : <>
    <div className="shrink-0" role="group" aria-label="Add layout objects"><AddPocketMenu label="Add" iconOnly={!!mobile} className={mobile ? "h-11 w-11 justify-center px-0" : undefined} includeFingerAccess onStart={onActivate} testId="toolbar-add-object" /></div>
    {available.filter(primary).map(item => <Button key={item.tool} size="sm"
      variant={!inactive && !panning && inspector.tool === item.tool ? "secondary" : "ghost"}
      className={mobile ? "h-11 w-11 shrink-0 p-0" : "min-h-11 shrink-0 gap-1 px-2"} disabled={disabled(item)} aria-label={item.label}
      title={textSelected && item.tool === "arrange" ? "Arrange applies to pockets and finger access. Text can move and rotate independently." : item.label}
      aria-pressed={!inactive && !panning && inspector.tool === item.tool} onClick={() => activate(item.tool)}><item.Icon className="h-4 w-4" /><span className={mobile ? "sr-only" : undefined}>{item.text}</span></Button>)}
    </>}
    {mobile && <><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={!canUndo}
      aria-label={canUndo ? `Undo ${history.stack[history.index].label}` : "Undo"} title="Undo" data-testid="button-bin-undo" onClick={() => dispatch({ type: "UNDO" })}><Undo2 /></Button>{ruler}</>}
    {(mobile || !wide) && <DropdownMenu onOpenChange={open => { if (!open) setShowHistory(false); }}><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className={mobile ? "h-11 w-11 shrink-0 p-0" : "min-h-11 min-w-0 gap-1 px-2"} aria-label="Tools" title="More tools and history">
      <span className={mobile ? "sr-only" : "truncate"}>{inspector.tool === "properties" ? "Tools" : tools.find(item => item.tool === inspector.tool)?.text}</span>{mobile ? <MoreHorizontal className="h-4 w-4" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
    </Button></DropdownMenuTrigger><DropdownMenuContent ref={menu} align="end"
      className={`max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[calc(100vw-1rem)] ${showHistory ? "flex w-72 flex-col overflow-hidden" : "overflow-y-auto"}`}>
      {mobile && showHistory ? <>
        <DropdownMenuItem className="min-h-11 shrink-0 gap-2" aria-label="Back to tools" onSelect={event => { event.preventDefault(); setShowHistory(false); }}><ArrowLeft className="h-4 w-4" />Edit history</DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="min-h-0 max-h-72 overflow-y-auto" role="group" aria-label="Edit history" data-testid="button-bin-history-menu">
          {history.stack.map(({ label }, index) => <DropdownMenuItem key={index} className="min-h-11" aria-current={index === history.index ? "step" : undefined} data-testid={`history-step-${index}`} onSelect={() => dispatch({ type: "JUMP_TO_HISTORY", index })}>
            <span className="min-w-0 [overflow-wrap:anywhere]">{index + 1}. {label.replace(/\bfinger[ -]holes?\b/gi, term => term.startsWith("F") ? "Finger access" : "finger access")}{index === history.index ? " · Current" : ""}</span>
          </DropdownMenuItem>).reverse()}
        </div>
      </> : <>
      {mobile && <>
        <DropdownMenuItem asChild disabled={!canRedo} onSelect={() => dispatch({ type: "REDO" })}><Button variant="ghost" className="min-h-11 w-full justify-start px-2" disabled={!canRedo} data-testid="button-bin-redo" aria-label={canRedo ? `Redo ${history.stack[history.index + 1].label}` : "Redo"}><Redo2 />Redo</Button></DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 gap-2" aria-label="Show edit history" data-testid="button-bin-history" onSelect={event => { event.preventDefault(); setShowHistory(true); }}><History className="h-4 w-4" />Edit history</DropdownMenuItem>
        <DropdownMenuSeparator />
        {navigation.map(action => <DropdownMenuItem key={action.label} className="min-h-11" aria-label={action.label} disabled={action.disabled} data-testid={action.testId} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>)}
      </>}
      {available.filter(item => !primary(item)).map(item => <DropdownMenuItem key={item.tool} aria-label={item.label} className="min-h-11 gap-2" disabled={disabled(item)} onSelect={() => activate(item.tool)}><item.Icon className="h-4 w-4" />{item.text}</DropdownMenuItem>)}
      {textSelected && <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">Text moves and rotates independently. Arrange and Link apply to pockets and finger access.</p>}
      </>}
    </DropdownMenuContent></DropdownMenu>}
  </>, inspector.toolbar);
}
