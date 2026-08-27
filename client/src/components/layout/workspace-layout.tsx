import * as React from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";

export interface WorkspaceLayoutProps {
  /** Controls column. Compose it from `PanelSection` / `PanelBody`. */
  panel: React.ReactNode;
  /** Fills all remaining space; rendered inside a relative, clipped box. */
  canvas: React.ReactNode;
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
  autoSaveId,
  panelSide = "left",
  defaultPanelSize = 26,
  minPanelSize = 18,
  maxPanelSize = 40,
  panelOpen,
  onPanelOpenChange,
  panelTitle = "Controls",
}: WorkspaceLayoutProps): JSX.Element {
  const isMobile = useIsMobile();
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
    if (isMobile) {
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
  }, [panelOpen, isMobile, collapsed]);

  if (isMobile) {
    return (
      <div className="relative h-full w-full overflow-hidden">
        {/*
          The canvas stays outside the drawer. vaul animates its content with
          CSS transforms, and the canvas relies on getScreenCTM() to map pointer
          events into image space — that matrix composes every ancestor
          transform, so a canvas inside the drawer would mis-hit for the whole
          animation and stay wrong under `shouldScaleBackground`.
        */}
        {canvas}
        <Drawer open={panelOpen} onOpenChange={onPanelOpenChange}>
          {/* aria-describedby={undefined} opts out of Radix's description
              warning: this drawer is a controls tray, not a prose dialog. */}
          <DrawerContent
            className="max-h-[85dvh]"
            aria-describedby={undefined}
          >
            <DrawerHeader className="shrink-0 pb-2">
              <DrawerTitle>{panelTitle}</DrawerTitle>
            </DrawerHeader>
            {/* The composed panel owns its scrolling through PanelBody. Keeping
                this wrapper non-scrolling lets panel-level navigation and the
                PanelFooter remain pinned in the mobile drawer too. */}
            <div className="min-h-0 flex-1 overflow-hidden">{panel}</div>
          </DrawerContent>
        </Drawer>
      </div>
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
      defaultSize={defaultPanelSize}
      minSize={minPanelSize}
      maxSize={maxPanelSize}
      onCollapse={() => reportCollapsed(true)}
      onExpand={() => reportCollapsed(false)}
      className="min-w-0"
    >
      {panel}
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
      defaultSize={100 - defaultPanelSize}
      className="min-w-0"
    >
      {/* relative + overflow-hidden anchors CanvasToolbar and clips anything
          the canvas pans outside its box. */}
      <div className="relative h-full w-full overflow-hidden">{canvas}</div>
    </ResizablePanel>
  );

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={autoSaveId}
      className="h-full"
    >
      {panelSide === "left" ? controls : stage}
      <ResizableHandle withHandle />
      {panelSide === "left" ? stage : controls}
    </ResizablePanelGroup>
  );
}
