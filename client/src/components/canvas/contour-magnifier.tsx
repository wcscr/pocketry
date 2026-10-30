import { useEffect, useState, type CSSProperties } from "react";
import type { Point } from "@shared/geometry/types";

/** Reuses the rendered SVG scene, so photo, contour and zoom stay registered. */
export function ContourMagnifier({ sceneId, point, canvasWidth, canvasHeight, compact }: {
  sceneId: string; point: Point | null; canvasWidth: number; canvasHeight: number; compact: boolean;
}) {
  if (!point) return null;
  return <ActiveContourMagnifier sceneId={sceneId} point={point} canvasWidth={canvasWidth} canvasHeight={canvasHeight} compact={compact} />;
}

/** Stay steady until the finger approaches the lens; only touch views relocate. */
function ActiveContourMagnifier({ sceneId, point, canvasWidth, canvasHeight, compact }: {
  sceneId: string; point: Point; canvasWidth: number; canvasHeight: number; compact: boolean;
}) {
  const [corner, setCorner] = useState(() => ({
    right: point.x < canvasWidth / 2,
    bottom: point.y < canvasHeight / 2,
  }));
  // 204² is approximately twice the mobile area; both retain 3× magnification.
  const size = compact ? 144 : 204;
  const viewSize = size / 3;
  const outerSize = size + 4;
  const maxTop = Math.max(8, canvasHeight - outerSize - 8);
  useEffect(() => {
    if (!compact) return;
    const bounds = (candidate: typeof corner) => ({
      x: candidate.right ? Math.max(8, canvasWidth - outerSize - 8) : 8,
      y: candidate.bottom ? Math.max(8, canvasHeight - outerSize - 64) : Math.min(64, maxTop),
    });
    const clearance = (candidate: typeof corner) => {
      const { x, y } = bounds(candidate);
      return Math.hypot(Math.max(x - point.x, 0, point.x - x - outerSize),
        Math.max(y - point.y, 0, point.y - y - outerSize));
    };
    const current = clearance(corner);
    if (current > 80) return;
    let best = corner;
    let distance = current;
    for (const right of [false, true]) for (const bottom of [false, true]) {
      const candidate = { right, bottom };
      const next = clearance(candidate);
      // The extra 40px is hysteresis: avoid oscillation in a small canvas.
      if (next > distance + 40) { best = candidate; distance = next; }
    }
    if (best !== corner) setCorner(best);
  }, [compact, point.x, point.y, canvasWidth, canvasHeight, outerSize, maxTop, corner]);
  return <div data-testid="contour-magnifier" aria-hidden="true"
    className="pointer-events-none absolute z-40 overflow-hidden rounded-lg border-2 border-primary bg-background shadow-lg"
    style={{ left: corner.right ? Math.max(8, canvasWidth - outerSize - 8) : 8,
      top: corner.bottom ? Math.max(8, canvasHeight - outerSize - 64) : Math.min(64, maxTop) }}>
    <svg width={size} height={size} viewBox={`${point.x - viewSize / 2} ${point.y - viewSize / 2} ${viewSize} ${viewSize}`}
      style={{ "--contour-handle-visibility": "hidden" } as CSSProperties}>
      <use href={`#${sceneId}`} />
      {/* Hide the scene's enlarged hit handles, then mark the exact point with
          a 6px hollow ring and separated crosshair arms at fixed lens size. */}
      <g transform={`translate(${point.x} ${point.y})`} fill="none" data-testid="magnifier-reticle">
        {[{ color: "white", width: 1 }, { color: "#18181b", width: 1 / 3 }].map(({ color, width }) => (
          <g key={color} stroke={color} strokeWidth={width}>
            <circle r="1" />
            <path d="M-4 0H-2 M2 0H4 M0-4V-2 M0 2V4" />
          </g>
        ))}
      </g>
    </svg>
    <div className="absolute bottom-0 inset-x-0 bg-background/90 text-center text-[10px]">3× precision view</div>
  </div>;
}
