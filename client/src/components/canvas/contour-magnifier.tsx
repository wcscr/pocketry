import type { Point } from "@shared/geometry/types";

/** Reuses the rendered SVG scene, so photo, contour and zoom stay registered. */
export function ContourMagnifier({ sceneId, point, canvasWidth, canvasHeight }: {
  sceneId: string; point: Point | null; canvasWidth: number; canvasHeight: number;
}) {
  if (!point) return null;
  return <div data-testid="contour-magnifier" aria-hidden="true"
    className="pointer-events-none absolute z-40 overflow-hidden rounded-lg border-2 border-primary bg-background shadow-lg"
    style={{ left: Math.max(8, Math.min(canvasWidth - 132, point.x - 60)),
      top: Math.max(8, Math.min(canvasHeight - 132, point.y > 168 ? point.y - 160 : point.y + 48)) }}>
    <svg width="120" height="120" viewBox={`${point.x - 20} ${point.y - 20} 40 40`}>
      <use href={`#${sceneId}`} />
      <circle cx={point.x} cy={point.y} r="2.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </svg>
    <div className="absolute bottom-0 inset-x-0 bg-background/90 text-center text-[10px]">3× precision view</div>
  </div>;
}
