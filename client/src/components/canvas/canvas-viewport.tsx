import * as React from "react";

import { useElementSize, type Size } from "@/hooks/use-element-size";
import { cn } from "@/lib/utils";

const EMPTY_SIZE: Size = { width: 0, height: 0 };

const CanvasViewportSizeContext = React.createContext<Size>(EMPTY_SIZE);

/**
 * Measured size of the enclosing `CanvasViewport`, in CSS pixels.
 *
 * Feed it to `useViewportTransform` as `containerWidth` / `containerHeight`.
 * Outside a viewport it reports 0 x 0, which every consumer already has to
 * handle: the real size is also 0 x 0 on the first render, before layout.
 */
export function useCanvasViewportSize(): Size {
  return React.useContext(CanvasViewportSizeContext);
}

export interface CanvasViewportProps {
  /** The scene: an `<svg>`, a 2D `<canvas>`, or a WebGL surface. */
  children: React.ReactNode;
  /** Floating chrome — `CanvasToolbar` clusters, status pills. */
  overlays?: React.ReactNode;
  className?: string;
}

/**
 * The stage: a box that claims all the space its parent gives it, publishes how
 * big that turned out to be, and clips whatever is drawn inside.
 *
 * It is deliberately content-agnostic — no image, SVG or transform props. The
 * scene owns its own rendering and reads the size from context, which is what
 * lets a later phase drop a three.js `<canvas>` in here unchanged for the
 * Gridfinity bin designer without this component learning anything about 3D.
 *
 * Sizing comes from `useElementSize` rather than a window resize listener: the
 * viewport lives inside a `ResizablePanel`, and dragging that handle fires no
 * window resize at all. That is the concrete reason the previous canvas only
 * used part of the working area — it measured once, against a box that had been
 * sized from the image rather than from the pane.
 */
export function CanvasViewport({
  children,
  overlays,
  className,
}: CanvasViewportProps): JSX.Element {
  const [ref, size] = useElementSize<HTMLDivElement>();

  return (
    <CanvasViewportSizeContext.Provider value={size}>
      <div
        ref={ref}
        className={cn(
          // h-full w-full + overflow-hidden: fill the pane exactly and clip the
          // parts of the scene panned outside it. touch-none stops the browser
          // treating a drag as a page scroll, so pointer events survive on a
          // tablet — the old container asked for that without ever handling
          // touch, leaving the canvas neither pannable nor scrollable.
          "relative h-full w-full touch-none overflow-hidden bg-muted/30",
          className,
        )}
      >
        {/* An own layer for the scene: absolute inset-0 gives it a definite box
            to fill regardless of its intrinsic size, and keeps it out of the
            flow so the overlays below always paint on top. */}
        <div className="absolute inset-0">{children}</div>
        {/* Overlays are rendered as direct children on purpose. They position
            themselves against this box (CanvasToolbar is `absolute` with corner
            offsets); an intermediate wrapper would be a zero-height flow box and
            every bottom-anchored toolbar would hang off the top edge. */}
        {overlays}
      </div>
    </CanvasViewportSizeContext.Provider>
  );
}
