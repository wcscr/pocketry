import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CanvasToolbarPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const POSITION_CLASSES: Record<CanvasToolbarPosition, string> = {
  "top-left": "left-2 top-2",
  "top-right": "right-2 top-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-2 right-2",
};

export interface CanvasToolbarProps {
  position?: CanvasToolbarPosition;
  className?: string;
  children: ReactNode;
}

/**
 * A small cluster of controls floating over the canvas.
 *
 * Floating rather than stacking above the canvas is the point: a toolbar in the
 * flow would take a fixed slice of height off a region whose whole job is to be
 * as large as possible, and it would do so permanently — even when the user is
 * only panning. Overlaying costs zero vertical space, and the translucent
 * backdrop keeps whatever is underneath readable.
 *
 * Requires an `overflow-hidden position: relative` ancestor; `WorkspaceLayout`
 * gives the canvas slot exactly that.
 */
export function CanvasToolbar({
  position = "top-left",
  className,
  children,
}: CanvasToolbarProps): JSX.Element {
  return (
    <div
      className={cn(
        // max-w + flex-wrap so a crowded toolbar wraps onto a second row
        // instead of running off the edge of a narrow canvas.
        "absolute z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur",
        POSITION_CLASSES[position],
        className,
      )}
    >
      {children}
    </div>
  );
}
