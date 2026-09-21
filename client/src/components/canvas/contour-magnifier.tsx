import { useState } from "react";
import type { Point } from "@shared/geometry/types";

/** Reuses the rendered SVG scene, so photo, contour and zoom stay registered. */
export function ContourMagnifier({ sceneId, point, canvasWidth, canvasHeight, compact }: {
  sceneId: string; point: Point | null; canvasWidth: number; canvasHeight: number; compact: boolean;
}) {
  if (!point) return null;
  return <ActiveContourMagnifier sceneId={sceneId} point={point} canvasWidth={canvasWidth} canvasHeight={canvasHeight} compact={compact} />;
}

/** Mounting starts a new drag; its initial point chooses a corner for the whole gesture. */
function ActiveContourMagnifier({ sceneId, point, canvasWidth, canvasHeight, compact }: {
  sceneId: string; point: Point; canvasWidth: number; canvasHeight: number; compact: boolean;
}) {
  const [corner] = useState(() => ({
    right: point.x < canvasWidth / 2,
    bottom: point.y < canvasHeight / 2,
  }));
  // 204² is approximately twice the mobile area; both retain 3× magnification.
  const size = compact ? 144 : 204;
  const viewSize = size / 3;
  const outerSize = size + 4;
  const maxTop = Math.max(8, canvasHeight - outerSize - 8);
  return <div data-testid="contour-magnifier" aria-hidden="true"
    className="pointer-events-none absolute z-40 overflow-hidden rounded-lg border-2 border-primary bg-background shadow-lg"
    style={{ left: corner.right ? Math.max(8, canvasWidth - outerSize - 8) : 8,
      top: corner.bottom ? Math.max(8, canvasHeight - outerSize - 64) : Math.min(64, maxTop) }}>
    <svg width={size} height={size} viewBox={`${point.x - viewSize / 2} ${point.y - viewSize / 2} ${viewSize} ${viewSize}`}>
      <use href={`#${sceneId}`} />
      <circle cx={point.x} cy={point.y} r="2.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </svg>
    <div className="absolute bottom-0 inset-x-0 bg-background/90 text-center text-[10px]">3× precision view</div>
  </div>;
}
