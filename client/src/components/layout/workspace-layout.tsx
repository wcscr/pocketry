import * as React from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { useElementSize } from "@/hooks/use-element-size";
import { useIsMobile } from "@/hooks/use-mobile";
import { InspectorWorkspace } from "./inspector-workspace";
import { MobileCanvasOverlayContext } from "./mobile-canvas-overlay";

export interface WorkspaceLayoutProps {
  /** Controls column. Compose it from `PanelSection` / `PanelBody`. */
  panel: React.ReactNode;
  /** Fills all remaining space; rendered inside a relative, clipped box. */
  canvas: React.ReactNode;
  /** Optional selection inspector with its own scroll position. */
  inspector?: React.ReactNode;
  inspectorPanelTitle?: string;
  inspectorHeader?: React.ReactNode;
  inspectorToolbar?: React.ReactNode;
  canvasEditingMode?: string;
  inspectorRequest?: number;
  controlsRequest?: unknown;
  /**
   * localStorage key for the persisted split, e.g. "tooltrace:trace".
   *
   * Because the split survives reloads, a user who drags the panel shut finds
   * it still shut on their next visit. Callers must therefore give them a way
   * back — a header toggle wired to `panelOpen` / `onPanelOpenChange` — or the
   * controls are simply gone.
   */
  autoSaveId: string;
  panelSide?: "left" | "right";
  /** Percentages of the group's width. */
  defaultPanelSize?: number;
  minPanelSize?: number;
  maxPanelSize?: number;
  /**
   * Expanded on desktop / drawer open on mobile.
   *
   * Two-way, not a command that only flows inward: dragging the panel shut
   * reports `false` back out, and a persisted layout that restores collapsed
   * does the same on mount — so a caller who starts at `true` may be corrected
   * to `false` on the first commit. Hold it in state, never derive it.
   */
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /** Drawer heading on mobile, where the panel has no visible column header. */
  panelTitle?: string;
  /** Persistent next-step actions below the mobile canvas. */
  mobileActions?: React.ReactNode;
  /** Dense step controls can move beside the canvas on short landscape phones. */
  mobileActionsLayout?: "bottom" | "landscape-side";
}

/**
 * Two-region workspace: a resizable controls panel beside a canvas that takes
 * everything else.
 *
 * On desktop the two are a `react-resizable-panels` group, so the canvas resizes
 * on drag as well as on window resize. On mobile the panel moves into a drawer
 * and the canvas goes full-bleed — there is no width to split at that size.
 */
export function WorkspaceLayout({
  panel,
  canvas,
  inspector,
  inspectorPanelTitle,
  inspectorHeader,
  inspectorToolbar,
  canvasEditingMode,
  inspectorRequest = 0,
  controlsRequest,
  autoSaveId,
  panelSide = "left",
  defaultPanelSize = 26,
  minPanelSize = 18,
  maxPanelSize = 40,
  panelOpen,
  onPanelOpenChange,
  panelTitle = "Controls",
  mobileActions,
  mobileActionsLayout = "bottom",
}: WorkspaceLayoutProps): JSX.Element {
  const isMobile = useIsMobile();
  const [overlayRoot, setOverlayRoot] = React.useState<HTMLDivElement | null>(null);
  const [workspaceRef, workspaceSize] = useElementSize<HTMLDivElement>();
  // Percentage-only limits make tablet controls narrower than their fields.
  // Keep a usable column while retaining collapse and the caller's maximum.
  const effectiveMinPanelSize = workspaceSize.width > 0
    ? Math.min(maxPanelSize, Math.max(minPanelSize, 280 / workspaceSize.width * 100))
    : minPanelSize;
  const effectiveDefaultPanelSize = Math.max(defaultPanelSize, effectiveMinPanelSize);
  const panelRef = React.useRef<ImperativePanelHandle>(null);
  // What the group last reported, or null before it has reported anything.
  //
  // Deliberately not read back via `panelRef.current.isCollapsed()`: every one
  // of the imperative accessors asserts on an existing layout and *throws*
  // ("Panel size not found for panel ...") when the group has not computed one
  // yet. State rather than a ref so the first report re-runs the sync effect
  // below even if it has already run and bailed.
  const [collapsed, setCollapsed] = React.useState<boolean | null>(null);

  /**
   * Record a collapse state the group reported and mirror it outward.
   *
   * The group reports its restored state once on mount. A collapsed restore has
   * to reach the caller — their toggle is the only way back to a panel that is
   * not on screen — but an expanded one is swallowed, because it is merely the
   * default and echoing it would force `panelOpen` true. On a phone that is
   * ruinous: `useIsMobile()` resolves in a passive effect, one tick *after* the
   * desktop panel group has already mounted and reported, so the drawer would
   * spring open on every page load.
   */
  const reportCollapsed = (next: boolean) => {
    const isFirstReport = collapsed === null;
    setCollapsed(next);
    if (!isFirstReport || next) onPanelOpenChange(!next);
  };

  // Drive the panel from the `panelOpen` prop. The collapse state lives inside
  // the panel group (and its persisted layout), so it has to be pushed in
  // imperatively; reportCollapsed carries drag-initiated changes back out. The
  // guard no-ops when the group is already in the requested state, so the two
  // directions cannot ping-pong.
  React.useEffect(() => {
    if (isMobile || inspector) {
      // The group is unmounted on the drawer path; forget its state so a stale
      // value cannot drive the first sync after switching back to desktop.
      setCollapsed(null);
      return;
    }
    const handle = panelRef.current;
    if (!handle || collapsed === null) return;
    if (panelOpen === !collapsed) return;
    if (panelOpen) handle.expand();
    else handle.collapse();
  }, [panelOpen, isMobile, collapsed, !!inspector]);

  if (inspector) return <InspectorWorkspace panel={panel} canvas={canvas} inspector={inspector}
    panelOpen={panelOpen} onPanelOpenChange={onPanelOpenChange} panelTitle={inspectorPanelTitle}
    inspectorRequest={inspectorRequest} header={inspectorHeader} toolbar={inspectorToolbar} canvasEditingMode={canvasEditingMode} />;

  if (isMobile) {
    return (
      <MobileCanvasOverlayContext.Provider value={overlayRoot}>
      <div ref={workspaceRef} data-landscape-actions={mobileActionsLayout === "landscape-side" || undefined}
        className="mobile-workspace relative flex h-full w-full flex-col overflow-hidden">
        {/*
          The canvas stays outside the drawer. vaul animates its content with
          CSS transforms, and the canvas relies on getScreenCTM() to map pointer
          events into image space — that matrix composes every ancestor
          transform, so a canvas inside the drawer would mis-hit for the whole
          animation and stay wrong under `shouldScaleBackground`.
        */}
        <div className="relative min-h-0 min-w-0 flex-1" data-testid="mobile-workspace-canvas">{canvas}<div ref={setOverlayRoot} className="pointer-events-none absolute inset-0 z-30" /></div>
        <div className="mobile-workspace-actions max-h-[50dvh] shrink-0 overflow-y-auto border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="mobile-workspace-actions">
          {mobileActions ?? (
            <Button className="min-h-11 w-full" onClick={() => onPanelOpenChange(true)}>
              {panelTitle} controls
            </Button>
          )}
        </div>
        <Drawer open={panelOpen} onOpenChange={onPanelOpenChange} shouldScaleBackground={false}>
          {/* aria-describedby={undefined} opts out of Radix's description
              warning: this drawer is a controls tray, not a prose dialog. */}
          <DrawerContent
            className="h-[85dvh] max-h-[85dvh] pb-[env(safe-area-inset-bottom)]"
            aria-describedby={undefined}
          >
            <DrawerHeader className="flex shrink-0 items-center justify-between py-2">
              <DrawerTitle>{panelTitle}</DrawerTitle>
              <DrawerClose asChild>
                <Button variant="outline" className="min-h-11">Back to canvas</Button>
              </DrawerClose>
            </DrawerHeader>
            {/* The drawer has a definite height so the panel's h-full and
                flex scroller can shrink within it. PanelBody owns scrolling;
                this wrapper keeps panel-level navigation and the
                PanelFooter remain pinned in the mobile drawer too. */}
            <div className="min-h-0 flex-1 overflow-hidden" data-vaul-no-drag>{panel}</div>
          </DrawerContent>
        </Drawer>
      </div>
      </MobileCanvasOverlayContext.Provider>
    );
  }

  // min-w-0 on both panels: a flex item's default `min-width: auto` refuses to
  // shrink below its content's min-content width, so a long label or a wide
  // button row inside the panel would set a floor that the drag handle simply
  // stops at, well above minPanelSize.
  const controls = (
    <ResizablePanel
      key="panel"
      id="workspace-panel"
      order={panelSide === "left" ? 1 : 2}
      ref={panelRef}
      collapsible
      collapsedSize={0}
      defaultSize={effectiveDefaultPanelSize}
      minSize={effectiveMinPanelSize}
      maxSize={maxPanelSize}
      onCollapse={() => reportCollapsed(true)}
      onExpand={() => reportCollapsed(false)}
      className="min-w-0"
    >
      {/* A collapsed panel stays mounted to retain its settings. Native inert
          excludes its descendants from focus and interaction, while aria-hidden
          keeps the invisible controls out of the accessibility tree. */}
      <div id="workspace-controls" className="flex h-full flex-col" aria-hidden={panelOpen ? undefined : true}
        {...(!panelOpen ? { inert: "" } : {})} data-testid="desktop-workspace-controls">
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
          <h2 className="text-xs font-semibold">{panelTitle}</h2>
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Hide controls ([)" aria-label="Hide controls" aria-controls="workspace-controls" aria-expanded={panelOpen} onClick={() => onPanelOpenChange(false)}>
            {panelSide === "left" ? <PanelLeftClose className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{panel}</div>
      </div>
    </ResizablePanel>
  );

  const stage = (
    <ResizablePanel
      key="canvas"
      id="workspace-canvas"
      order={panelSide === "left" ? 2 : 1}
      // Spelled out rather than left to the group: without it the library warns
      // about layout shift and the canvas renders once at the wrong width,
      // which costs a full re-render of whatever it draws.
      defaultSize={100 - effectiveDefaultPanelSize}
      className="min-w-0"
    >
      {/* relative + overflow-hidden anchors CanvasToolbar and clips anything
          the canvas pans outside its box. */}
      <div className="relative flex h-full w-full overflow-hidden">
        <div className="relative min-w-0 flex-1 overflow-hidden">{canvas}</div>
        {!panelOpen && <Button variant="ghost" className={`h-full w-6 shrink-0 rounded-none bg-muted/30 p-0 text-muted-foreground hover:bg-accent hover:text-foreground ${panelSide === "left" ? "order-first border-r" : "border-l"}`}
          data-testid="controls-restore-rail" title="Show controls ([)" aria-label="Show controls" aria-controls="workspace-controls" aria-expanded={false} onClick={() => onPanelOpenChange(true)}>
          {panelSide === "left" ? <PanelLeftOpen className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>}
      </div>
    </ResizablePanel>
  );

  return (
    <div ref={workspaceRef} className="h-full">
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={autoSaveId}
      className="h-full"
    >
      {panelSide === "left" ? controls : stage}
      <ResizableHandle withHandle />
      {panelSide === "left" ? stage : controls}
    </ResizablePanelGroup>
    </div>
  );
}
