import { useState } from "react";
import type { Point } from "@shared/geometry/types";

/** Reuses the rendered SVG scene, so photo, contour and zoom stay registered. */
export function ContourMagnifier({ sceneId, point, canvasWidth, canvasHeight }: {
  sceneId: string; point: Point | null; canvasWidth: number; canvasHeight: number;
}) {
  if (!point) return null;
  return <ActiveContourMagnifier sceneId={sceneId} point={point} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />;
}

/** Mounting starts a new drag; its initial point chooses a corner for the whole gesture. */
function ActiveContourMagnifier({ sceneId, point, canvasWidth, canvasHeight }: {
  sceneId: string; point: Point; canvasWidth: number; canvasHeight: number;
}) {
  const [corner] = useState(() => ({
    right: point.x < canvasWidth / 2,
    bottom: point.y < canvasHeight / 2,
  }));
  const size = 144;
  const outerSize = size + 4;
  const maxTop = Math.max(8, canvasHeight - outerSize - 8);
  return <div data-testid="contour-magnifier" aria-hidden="true"
    className="pointer-events-none absolute z-40 overflow-hidden rounded-lg border-2 border-primary bg-background shadow-lg"
    style={{ left: corner.right ? Math.max(8, canvasWidth - outerSize - 8) : 8,
      top: corner.bottom ? Math.max(8, canvasHeight - outerSize - 64) : Math.min(64, maxTop) }}>
    <svg width={size} height={size} viewBox={`${point.x - 24} ${point.y - 24} 48 48`}>
      <use href={`#${sceneId}`} />
      <circle cx={point.x} cy={point.y} r="2.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </svg>
    <div className="absolute bottom-0 inset-x-0 bg-background/90 text-center text-[10px]">3× precision view</div>
  </div>;
}
