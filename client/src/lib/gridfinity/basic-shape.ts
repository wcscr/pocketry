import type { Point } from "@shared/geometry/types";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { normalizeOutline, outlineBounds, outlinePointCount } from "@/lib/geometry/outline";

export type BasicPocketShape = "rectangle" | "square" | "circle";
export const BASIC_POCKET_LABELS: Record<BasicPocketShape, string> = {
  rectangle: "Rectangle", square: "Square", circle: "Circle",
};

/** Opposite-corner rectangles/squares; circles are drawn from centre to edge. */
export function basicPocketDimensions(kind: BasicPocketShape, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const diameter = 2 * Math.hypot(dx, dy);
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const width = kind === "circle" ? diameter : kind === "square" ? side : Math.abs(dx);
  const length = kind === "circle" ? diameter : kind === "square" ? side : Math.abs(dy);
  return {
    width, length,
    position: kind === "circle" ? { ...start } : {
      x: start.x + (dx < 0 ? -1 : 1) * width / 2,
      y: start.y + (dy < 0 ? -1 : 1) * length / 2,
    },
  };
}

/** Creates ordinary pocket data in mm. It never places other objects or grows the bin. */
export function createBasicPocket(kind: BasicPocketShape, start: Point, end: Point, id: string) {
  const { width, length, position } = basicPocketDimensions(kind, start, end);
  if (![width, length, position.x, position.y].every(Number.isFinite) || width < 1 || length < 1) return null;
  const halfWidth = width / 2;
  const halfLength = length / 2;
  // <= 0.02 mm chord error; multiples of four preserve exact cardinal dimensions.
  const segments = Math.max(32, 4 * Math.ceil(Math.PI / Math.acos(1 - 0.02 / halfWidth) / 4));
  const outer = kind === "circle"
    ? Array.from({ length: segments }, (_, index) => ({
      x: halfWidth * Math.cos(index * 2 * Math.PI / segments),
      y: halfWidth * Math.sin(index * 2 * Math.PI / segments),
    }))
    : [{ x: -halfWidth, y: -halfLength }, { x: halfWidth, y: -halfLength },
      { x: halfWidth, y: halfLength }, { x: -halfWidth, y: halfLength }];
  const outlineMm = normalizeOutline([{ outer, holes: [] }]);
  const shape: TracedShape = {
    id, name: `${BASIC_POCKET_LABELS[kind]} pocket`, outlineMm,
    bboxMm: outlineBounds(outlineMm)!, pointCount: outlinePointCount(outlineMm),
    source: "basic-shape", sourceMmPerPx: null,
  };
  const cutout = parseCutoutPlacement({
    id: `cutout-${id}`, shapeId: id, position,
    aspectRatioLocked: kind !== "rectangle",
    // Preserve the drawn dimensions and sharp corners until explicitly edited.
    clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0,
  });
  return { shape, cutout };
}
