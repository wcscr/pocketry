import type { Point, Ring } from "@shared/geometry/types";

/**
 * Synthetic shapes used by the geometry tests.
 *
 * These are generated rather than stored so they stay readable and can be
 * re-parameterised; the assertions compare against analytic values, not golden
 * output.
 */

/** Axis-aligned rectangle, wound so its signed area is positive (a shell). */
export function rectRing(
  x: number,
  y: number,
  width: number,
  height: number,
): Ring {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

/** Circle approximated by `segments` points, positive signed area. */
export function circleRing(
  cx: number,
  cy: number,
  radius: number,
  segments = 64,
): Ring {
  const ring: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return ring;
}

/**
 * A "C" — a square with a deep rectangular bay cut into its right edge.
 * The bay centre is outside the filled region, which is what the concavity
 * regression test asserts survives simplification and smoothing.
 */
export function cShapeRing(): Ring {
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 30 },
    { x: 40, y: 30 },
    { x: 40, y: 70 },
    { x: 100, y: 70 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
}

/** A point well inside the C-shape's bay, i.e. outside the shape. */
export const C_SHAPE_BAY_CENTRE: Point = { x: 80, y: 50 };

/** A point solidly inside the C-shape's material. */
export const C_SHAPE_SOLID_POINT: Point = { x: 20, y: 50 };

/**
 * Predicate for an annulus, for building scalar fields:
 * a disc of `outerR` with a concentric hole of `innerR`.
 */
export function annulusPredicate(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
): (x: number, y: number) => boolean {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d <= outerR && d >= innerR;
  };
}

/** Predicate for an axis-aligned rectangle, inclusive of its bounds. */
export function rectPredicate(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): (x: number, y: number) => boolean {
  return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** Union of several predicates. */
export function anyOf(
  ...predicates: Array<(x: number, y: number) => boolean>
): (x: number, y: number) => boolean {
  return (x, y) => predicates.some((p) => p(x, y));
}

/** `a` minus `b`. */
export function without(
  a: (x: number, y: number) => boolean,
  b: (x: number, y: number) => boolean,
): (x: number, y: number) => boolean {
  return (x, y) => a(x, y) && !b(x, y);
}

/**
 * Convex hull (monotone chain), used only by tests to assert that a
 * simplification result is genuinely *not* convex. Production code must never
 * take a hull — that is the bug this whole phase exists to remove.
 */
export function convexHullForTest(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (input: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const p of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0
      ) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

/** Shoelace area of a point list, unsigned. */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(sum / 2);
}
