import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MobileCanvasOverlayContext } from "./mobile-canvas-overlay";

/** Independent workflow and object panels. Compact windows retain explicit
 * handles for both; overlays never transform or remount the editing canvas. */
export function InspectorWorkspace({ panel, canvas, inspector, panelOpen, onPanelOpenChange, inspectorRequest, controlsRequest }: {
  panel: ReactNode; canvas: ReactNode; inspector: ReactNode;
  panelOpen: boolean; onPanelOpenChange: (open: boolean) => void;
  inspectorRequest: number; controlsRequest?: unknown;
}): JSX.Element {
  const [width, setWidth] = useState(() => window.innerWidth);
  const compact = width < 1100;
  const overlay = width < 700;
  const [compactPane, setCompactPane] = useState<"workflow" | "inspector" | null>("workflow");
  const [rightOpen, setRightOpen] = useState(true);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const previousPanelOpen = useRef(panelOpen);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (previousPanelOpen.current !== panelOpen) setCompactPane(pane => panelOpen ? "workflow" : pane === "workflow" ? null : pane);
    previousPanelOpen.current = panelOpen;
  }, [panelOpen]);
  useEffect(() => { if (inspectorRequest) { setRightOpen(true); setCompactPane("inspector"); } }, [inspectorRequest]);
  useEffect(() => { if (controlsRequest) setCompactPane("workflow"); }, [controlsRequest]);
  const leftVisible = compact ? compactPane === "workflow" : panelOpen;
  const rightVisible = compact ? compactPane === "inspector" : rightOpen;
  const LeftIcon = leftVisible ? PanelLeftClose : PanelLeftOpen;
  const RightIcon = rightVisible ? PanelRightClose : PanelRightOpen;
  return <MobileCanvasOverlayContext.Provider value={overlayRoot}>
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector-workspace">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b bg-background px-2" role="group" aria-label="Workspace panels">
        <Button variant="ghost" size="sm" className="min-h-11 gap-2 px-2 text-xs" title={leftVisible ? "Collapse workflow panel" : "Expand workflow panel"}
          aria-label={leftVisible ? "Collapse workflow panel" : "Expand workflow panel"} aria-expanded={leftVisible} aria-controls="workflow-panel"
          onClick={() => { if (compact) setCompactPane(leftVisible ? null : "workflow"); else onPanelOpenChange(!panelOpen); }}><LeftIcon />Workflow</Button>
        <Button variant="ghost" size="sm" className="min-h-11 gap-2 px-2 text-xs" title={rightVisible ? "Collapse objects panel" : "Expand objects panel"}
          aria-label={rightVisible ? "Collapse objects panel" : "Expand objects panel"} aria-expanded={rightVisible} aria-controls="objects-panel"
          onClick={() => { if (compact) setCompactPane(rightVisible ? null : "inspector"); else setRightOpen(!rightOpen); }}>Objects &amp; properties<RightIcon /></Button>
      </div>
      <div className={cn("relative min-h-0 flex-1", !overlay && "grid")} style={!overlay ? { gridTemplateColumns: `${leftVisible ? compact ? 280 : 320 : 0}px minmax(0,1fr) ${rightVisible ? 340 : 0}px` } : undefined}>
        <div id="workflow-panel" hidden={!leftVisible} data-testid="desktop-workspace-controls" aria-label="Design workflow"
          className={cn("min-h-0 min-w-0 overflow-hidden border-r bg-background", overlay && "absolute inset-y-0 left-0 z-40 w-[min(340px,calc(100%-24px))] shadow-xl")}>
          {panel}
        </div>
        <div className={cn("relative min-h-0 min-w-0 overflow-hidden", overlay ? "h-full" : "col-start-2")} data-testid="inspector-workspace-canvas">
          {canvas}<div ref={setOverlayRoot} className="pointer-events-none absolute inset-0 z-30" />
        </div>
        <div id="objects-panel" hidden={!rightVisible} className={cn("min-h-0 min-w-0 overflow-hidden border-l bg-background", overlay ? "absolute inset-y-0 right-0 z-40 w-[min(360px,calc(100%-24px))] shadow-xl" : "col-start-3")}>
          {inspector}
        </div>
      </div>
    </div>
  </MobileCanvasOverlayContext.Provider>;
}
