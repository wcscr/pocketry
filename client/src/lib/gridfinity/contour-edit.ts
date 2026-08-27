import type { TracedShape } from "@shared/gridfinity/cutout";
import { ensureOrientation } from "@shared/geometry/rings";
import {
  HOLE_ORIENTATION,
  OUTER_ORIENTATION,
  OUTER_RING,
  type Outline,
  type Point,
  type Ring,
  type RingRef,
} from "@shared/geometry/types";

export function contourRing(outline: Outline, ref: RingRef): Ring | null {
  const shape = outline[ref.shapeIndex];
  if (!shape) return null;
  return ref.ringIndex === OUTER_RING
    ? shape.outer
    : (shape.holes[ref.ringIndex] ?? null);
}

export function replaceContourRing(
  outline: Outline,
  ref: RingRef,
  ring: Ring,
): Outline {
  return outline.map((shape, shapeIndex) => {
    if (shapeIndex !== ref.shapeIndex) return shape;
    if (ref.ringIndex === OUTER_RING) return { ...shape, outer: ring };
    return {
      ...shape,
      holes: shape.holes.map((hole, holeIndex) =>
        holeIndex === ref.ringIndex ? ring : hole,
      ),
    };
  });
}

export function moveContourPoint(
  outline: Outline,
  ref: RingRef,
  index: number,
  point: Point,
): Outline {
  const ring = contourRing(outline, ref);
  if (!ring || !ring[index]) return outline;
  return replaceContourRing(
    outline,
    ref,
    ring.map((candidate, candidateIndex) =>
      candidateIndex === index ? point : candidate,
    ),
  );
}

export function insertContourPoint(
  outline: Outline,
  ref: RingRef,
  afterIndex: number,
  point: Point,
): Outline {
  const ring = contourRing(outline, ref);
  if (!ring || afterIndex < 0 || afterIndex >= ring.length) return outline;
  const next = ring.slice();
  next.splice(afterIndex + 1, 0, point);
  return replaceContourRing(outline, ref, next);
}

export function removeContourPoint(
  outline: Outline,
  ref: RingRef,
  index: number,
): Outline {
  const ring = contourRing(outline, ref);
  if (!ring || ring.length <= 3 || !ring[index]) return outline;
  return replaceContourRing(
    outline,
    ref,
    ring.filter((_, candidateIndex) => candidateIndex !== index),
  );
}

/**
 * Creates an immutable shape revision for one committed contour gesture.
 * A fresh id is important: the geometry worker keys shape inputs by identity,
 * so reusing an id could leave a same-point-count vertex move cached.
 */
export function reviseTracedShape(
  source: TracedShape,
  outline: Outline,
  id: string,
): TracedShape {
  const normalized = outline.map((shape) => ({
    outer: ensureOrientation(shape.outer, OUTER_ORIENTATION),
    holes: shape.holes.map((hole) => ensureOrientation(hole, HOLE_ORIENTATION)),
  }));
  const points = normalized.flatMap((shape) => [shape.outer, ...shape.holes]).flat();
  if (points.length < 3) return source;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    ...source,
    id,
    outlineMm: normalized,
    bboxMm: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    pointCount: points.length,
  };
}
