import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MobileCanvasOverlayContext } from "./mobile-canvas-overlay";
import { useWorkspaceViewport } from "@/hooks/use-workspace-viewport";
import { MobileWorkspaceActionsContext } from "./mobile-workspace-actions";

/** Objects and properties have stable homes. Mobile sheets are siblings of the
 * canvas: resizing or opening a sheet never remounts or transforms the canvas. */
export function InspectorWorkspace({ panel, canvas, inspector, panelOpen, onPanelOpenChange, inspectorRequest, header, toolbar, canvasEditingMode, panelTitle = "Workflow", mobileActions, onOverlayRoot }: {
  panel: ReactNode; canvas: ReactNode; inspector: ReactNode; header?: ReactNode; toolbar?: ReactNode;
  panelOpen: boolean; onPanelOpenChange: (open: boolean) => void;
  panelTitle?: string;
  inspectorRequest: number; canvasEditingMode?: string;
  mobileActions?: ReactNode; onOverlayRoot?: (element: HTMLDivElement | null) => void;
}): JSX.Element {
  const { width, height, availableHeight, phone } = useWorkspaceViewport();
  const compact = width < 1100;
  const landscapeSide = phone && width >= 560 && width > height;
  const [compactPane, setCompactPane] = useState<"objects" | "properties" | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => { onOverlayRoot?.(overlayRoot); }, [overlayRoot, onOverlayRoot]);
  const previousPanelOpen = useRef(panelOpen);
  useEffect(() => {
    if (previousPanelOpen.current !== panelOpen) setCompactPane(pane => panelOpen ? "objects" : pane === "objects" ? null : pane);
    previousPanelOpen.current = panelOpen;
  }, [panelOpen]);
  useEffect(() => { if (inspectorRequest) { setRightOpen(true); setCompactPane("properties"); } }, [inspectorRequest]);
  useEffect(() => { if (canvasEditingMode && canvasEditingMode !== "placement") setCompactPane(null); }, [canvasEditingMode]);
  const leftVisible = compact ? compactPane === "objects" : panelOpen;
  const rightVisible = compact ? compactPane === "properties" : rightOpen;
  useEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('[hidden], [inert]')) focused.blur();
  }, [leftVisible, rightVisible, phone]);
  const showLeftRestore = !compact && !leftVisible;
  const showRightRestore = !compact && !rightVisible;
  const toggleLeft = () => { if (compact) setCompactPane(leftVisible ? null : "objects"); else onPanelOpenChange(!panelOpen); };
  const toggleRight = () => { if (compact) setCompactPane(rightVisible ? null : "properties"); else setRightOpen(!rightOpen); };
  const collapseClass = "absolute right-1 top-1 z-40 h-11 w-11";
  // Match the collapse icon's vertical center, including larger touch controls.
  const restoreClass = "row-start-1 h-full w-full items-start rounded-none bg-muted/30 p-0 pt-3.5 text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:pt-[18px]";
  return <MobileCanvasOverlayContext.Provider value={overlayRoot}>
    <div className={cn("flex h-full min-h-0 flex-col", phone && "compact-canvas")} style={{ maxHeight: Math.max(120, availableHeight - 56) }} data-testid="inspector-workspace">
      {header && <div className="shrink-0 border-b bg-background max-md:hidden">{header}</div>}
      <div className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns: `${!phone && leftVisible ? "min(280px, max(0px, calc(100% - 480px)))" : showLeftRestore ? "24px" : "0px"} minmax(0,1fr) ${!phone && rightVisible ? "min(340px, max(0px, calc(100% - 480px)))" : showRightRestore ? "24px" : "0px"}` }}>
        <div id="workflow-panel" hidden={!leftVisible} data-testid="desktop-workspace-controls" aria-label={`Design ${panelTitle.toLowerCase()}`}
          className={cn("relative min-h-0 min-w-0 overflow-hidden border-r bg-background", phone && "absolute inset-y-0 left-0 z-40 w-[min(320px,calc(100%-48px))] shadow-xl")}>
          {panel}
          <Button variant="ghost" size="icon" className={collapseClass} aria-label={`Collapse ${panelTitle.toLowerCase()} panel`} aria-controls="workflow-panel" onClick={toggleLeft}><PanelLeftClose /></Button>
        </div>
        {showLeftRestore && <Button variant="ghost" className={cn(restoreClass, "col-start-1 border-r")}
          data-testid="left-panel-restore-rail" aria-label={`Expand ${panelTitle.toLowerCase()} panel`} title={`Show ${panelTitle.toLowerCase()} panel`} aria-controls="workflow-panel" aria-expanded={false} onClick={toggleLeft}><PanelLeftOpen className="h-4 w-4" /></Button>}
        <div className="col-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden">
          {toolbar && <div className="flex min-h-11 shrink-0 items-center gap-1 border-b bg-background px-1" aria-label="Editing tools">
            {toolbar}
          </div>}
          <div className={cn("flex min-h-0 flex-1", landscapeSide ? "flex-row" : "flex-col")}>
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="inspector-workspace-canvas">
            {canvas}<div ref={setOverlayRoot} className="pointer-events-none absolute inset-0 z-30" />
          </div>
          {phone && mobileActions && <div className={cn("mobile-workspace-actions shrink-0 overflow-y-auto border-t bg-background p-2", landscapeSide && "w-60 border-l border-t-0")} data-testid="mobile-workspace-actions"><MobileWorkspaceActionsContext.Provider value={{ toggleWorkflow: toggleLeft, showCanvas: () => setCompactPane(null) }}>{mobileActions}</MobileWorkspaceActionsContext.Provider></div>}
          </div>
        </div>
        <div id="objects-panel" hidden={!rightVisible} className={cn("relative min-h-0 min-w-0 overflow-hidden border-l bg-background", phone ? "absolute inset-x-0 bottom-0 top-0 z-40 rounded-t-xl border-t shadow-xl" : "col-start-3")}>
          {inspector}
          <Button variant="ghost" size="icon" className={collapseClass} aria-label="Collapse properties panel" aria-controls="objects-panel" onClick={toggleRight}><PanelRightClose /></Button>
        </div>
        {showRightRestore && <Button variant="ghost" className={cn(restoreClass, "col-start-3 border-l")}
          data-testid="right-panel-restore-rail" aria-label="Expand properties panel" title="Show properties panel" aria-controls="objects-panel" aria-expanded={false} onClick={toggleRight}><PanelRightOpen className="h-4 w-4" /></Button>}
      </div>
      {compact && (!phone || !mobileActions) && <nav className="flex shrink-0 border-t bg-background px-2 pb-[env(safe-area-inset-bottom)]" aria-label="Editor panels">
        <Button variant={leftVisible ? "secondary" : "ghost"} className="h-11 flex-1 gap-2" aria-expanded={leftVisible} aria-controls="workflow-panel" onClick={toggleLeft}><PanelLeftOpen className="h-4 w-4" />{panelTitle}</Button>
        <Button variant={rightVisible ? "secondary" : "ghost"} className="h-11 flex-1 gap-2" aria-expanded={rightVisible} aria-controls="objects-panel" onClick={toggleRight}><PanelRightOpen className="h-4 w-4" />All properties</Button>
      </nav>}
    </div>
  </MobileCanvasOverlayContext.Provider>;
}
