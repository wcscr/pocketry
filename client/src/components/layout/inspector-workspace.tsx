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
  const toggleLeft = () => { if (compact) setCompactPane(leftVisible ? null : "workflow"); else onPanelOpenChange(!panelOpen); };
  const toggleRight = () => { if (compact) setCompactPane(rightVisible ? null : "inspector"); else setRightOpen(!rightOpen); };
  const collapseClass = "absolute right-1 top-1 z-50 h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";
  const expandClass = "absolute top-1/2 z-50 h-9 w-9 -translate-y-1/2 border bg-background/95 shadow-sm [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";
  return <MobileCanvasOverlayContext.Provider value={overlayRoot}>
    <div className="h-full min-h-0" data-testid="inspector-workspace">
      <div className={cn("relative h-full min-h-0", !overlay && "grid")} style={!overlay ? { gridTemplateColumns: `${leftVisible ? compact ? 280 : 320 : 0}px minmax(0,1fr) ${rightVisible ? 340 : 0}px` } : undefined}>
        <div id="workflow-panel" hidden={!leftVisible} data-testid="desktop-workspace-controls" aria-label="Design workflow"
          className={cn("relative min-h-0 min-w-0 overflow-hidden border-r bg-background", overlay && "absolute inset-y-0 left-0 z-40 w-[min(340px,calc(100%-48px))] shadow-xl")}>
          {panel}
          <Button variant="ghost" size="icon" className={collapseClass} title="Collapse workflow panel"
            aria-label="Collapse workflow panel" aria-expanded={leftVisible} aria-controls="workflow-panel" onClick={toggleLeft}><PanelLeftClose /></Button>
        </div>
        <div className={cn("relative min-h-0 min-w-0 overflow-hidden", overlay ? "h-full" : "col-start-2")} data-testid="inspector-workspace-canvas">
          {canvas}<div ref={setOverlayRoot} className="pointer-events-none absolute inset-0 z-30" />
          {!leftVisible && <Button variant="outline" size="icon" className={cn(expandClass, "left-1")} title="Expand workflow panel"
            aria-label="Expand workflow panel" aria-expanded={false} aria-controls="workflow-panel" onClick={toggleLeft}><PanelLeftOpen /></Button>}
          {!rightVisible && <Button variant="outline" size="icon" className={cn(expandClass, "right-1")} title="Expand objects panel"
            aria-label="Expand objects panel" aria-expanded={false} aria-controls="objects-panel" onClick={toggleRight}><PanelRightOpen /></Button>}
        </div>
        <div id="objects-panel" hidden={!rightVisible} className={cn("relative min-h-0 min-w-0 overflow-hidden border-l bg-background", overlay ? "absolute inset-y-0 right-0 z-40 w-[min(360px,calc(100%-48px))] shadow-xl" : "col-start-3")}>
          {inspector}
          <Button variant="ghost" size="icon" className={collapseClass} title="Collapse objects panel"
            aria-label="Collapse objects panel" aria-expanded={rightVisible} aria-controls="objects-panel" onClick={toggleRight}><PanelRightClose /></Button>
        </div>
      </div>
    </div>
  </MobileCanvasOverlayContext.Provider>;
}
