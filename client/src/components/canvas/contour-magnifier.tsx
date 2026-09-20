import type { Point } from "@shared/geometry/types";

/** Reuses the rendered SVG scene, so photo, contour and zoom stay registered. */
export function ContourMagnifier({ sceneId, point, canvasWidth }: {
  sceneId: string; point: Point | null; canvasWidth: number;
}) {
  if (!point) return null;
  return <div data-testid="contour-magnifier" aria-hidden="true"
    className={`pointer-events-none absolute top-16 z-40 overflow-hidden rounded-lg border-2 border-primary bg-background shadow-lg ${point.x > canvasWidth / 2 ? "left-2" : "right-2"}`}>
    <svg width="120" height="120" viewBox={`${point.x - 20} ${point.y - 20} 40 40`}>
      <use href={`#${sceneId}`} />
      <circle cx={point.x} cy={point.y} r="2.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </svg>
    <div className="absolute bottom-0 inset-x-0 bg-background/90 text-center text-[10px]">3× precision view</div>
  </div>;
}
