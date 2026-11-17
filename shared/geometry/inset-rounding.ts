import {
  distanceToChain,
  elementLength,
  leftNormal,
  pointAlong,
  startTangent,
  endTangent,
  type ArcChain,
  type ChainElement,
} from "./arc-chain";
import type { Point } from "./types";

/**
 * Pocketry's floor rounding, stated once for every consumer.
 *
 * A pocket of section S with floor rounding `radius` is not a filleted prism.
 * At height `h` above the floor its cross-section is S inset by
 * {@link roundingInset}: full radius at the floor, nothing from `h = radius`
 * up. Parts of S narrower than twice the inset simply vanish near the floor,
 * and corners tighter than the radius leave a crease. The print path samples
 * this rule in bands (`bottomFilletCutter`); the CAD path builds it exactly.
 */

/**
 * How far the pocket wall stands in from the section boundary at `height`
 * above the floor: the sag of a quarter circle of `radius` that is tangent to
 * the floor and to the wall.
 */
export function roundingInset(radius: number, height: number): number {
  if (height >= radius) return 0;
  const h = Math.max(0, height);
  return radius - Math.sqrt(radius * radius - (radius - h) * (radius - h));
}

/** A point that must lie exactly on the rounded pocket surface. */
export interface SurfaceWitness {
  /** Index of the boundary ring in the list given to {@link roundingWitnesses}. */
  ring: number;
  /** Index of the element within that ring whose band this point belongs to. */
  element: number;
  /** True when the point belongs to the band around the inside corner that ends `element`. */
  corner: boolean;
  /** Plan position. */
  point: Point;
  /** Height above the pocket floor. */
  height: number;
}

export interface WitnessOptions {
  /** Heights as fractions of the radius. Mid-band values keep clear of the floor and wall. */
  heightFractions?: readonly number[];
  /** Roughly one witness per this much boundary length, at least one per element. */
  spacingMm?: number;
  /** At most this many positions along one element. */
  maxPerElement?: number;
}

/** Fractions along an element at which to place witnesses. */
function witnessFractions(element: ChainElement, spacingMm: number, maxCount: number): number[] {
  const count = Math.max(1, Math.min(maxCount, Math.round(elementLength(element) / spacingMm)));
  return Array.from({ length: count }, (_, index) => (index + 0.5) / count);
}

/** Unit direction of travel a fraction `t` along the element. */
function tangentAlong(element: ChainElement, t: number): Point {
  if (element.kind === "line") return startTangent(element);
  const here = pointAlong(element, t);
  const turn = Math.sign(element.sweep) / element.radius;
  return {
    x: -(here.y - element.center.y) * turn,
    y: (here.x - element.center.x) * turn,
  };
}

/**
 * Points on the rounded surface that the boundary alone determines.
 *
 * For a boundary point x with inward normal n, the point x + n·inset(h) at
 * height h lies on the rounded surface exactly when no other part of the
 * boundary is closer to it than x is. Those points are returned; the others,
 * which fall where bands from different elements overlap, are left out. Every
 * element contributes unless its whole band is covered by its neighbors.
 *
 * `rings` holds every boundary of one section region (outer first, then
 * holes), each with the region on its left. `corners` lists the sharp inside
 * corners that carry a band of their own, per ring; by default those are the
 * corners of each ring taken as a closed loop.
 */
export function roundingWitnesses(
  rings: readonly ArcChain[],
  radius: number,
  options: WitnessOptions = {},
  corners: readonly (readonly InsideCorner[])[] = rings.map((chain) => insideCorners(chain)),
): SurfaceWitness[] {
  const heightFractions = options.heightFractions ?? [0.3, 0.7];
  const spacingMm = options.spacingMm ?? 5;
  const maxPerElement = options.maxPerElement ?? 4;
  const witnesses: SurfaceWitness[] = [];
  rings.forEach((chain, ring) => {
    chain.forEach((element, index) => {
      for (const t of witnessFractions(element, spacingMm, maxPerElement)) {
        const on = pointAlong(element, t);
        const inward = leftNormal(tangentAlong(element, t));
        for (const fraction of heightFractions) {
          const height = radius * fraction;
          const inset = roundingInset(radius, height);
          const point = { x: on.x + inward.x * inset, y: on.y + inward.y * inset };
          // Nothing else may be nearer than the boundary point this came from.
          let nearest = Infinity;
          for (const other of rings) nearest = Math.min(nearest, distanceToChain(point, other));
          if (nearest >= inset - 1e-9) {
            witnesses.push({ ring, element: index, corner: false, point, height });
          }
        }
      }
    });
    // The band around a sharp inside corner fans between the two wall normals.
    for (const corner of corners[ring] ?? []) {
      const from = leftNormal(corner.arriving);
      const half = corner.turn / 2;
      const direction = {
        x: from.x * Math.cos(half) - from.y * Math.sin(half),
        y: from.x * Math.sin(half) + from.y * Math.cos(half),
      };
      for (const fraction of heightFractions) {
        const height = radius * fraction;
        const inset = roundingInset(radius, height);
        const point = {
          x: corner.vertex.x + direction.x * inset,
          y: corner.vertex.y + direction.y * inset,
        };
        let nearest = Infinity;
        for (const other of rings) nearest = Math.min(nearest, distanceToChain(point, other));
        if (nearest >= inset - 1e-9) {
          witnesses.push({ ring, element: corner.element, corner: true, point, height });
        }
      }
    }
  });
  return witnesses;
}

/**
 * Inside corners of a chain: where the boundary turns sharply away from the
 * enclosed region. The rounded surface around such a corner is a band of its
 * own, centered on the corner point.
 */
export interface InsideCorner {
  /** Index of the element that ends at the corner. */
  element: number;
  vertex: Point;
  /** Unit direction of travel arriving at the corner. */
  arriving: Point;
  /** Signed turn in radians; negative for an inside corner. */
  turn: number;
}

/** Smooth joins and convex corners need no band of their own; these do. */
export function insideCorners(chain: ArcChain, minimumTurn = 1e-7): InsideCorner[] {
  const corners: InsideCorner[] = [];
  chain.forEach((element, index) => {
    const arriving = endTangent(element);
    const leaving = startTangent(chain[(index + 1) % chain.length]);
    const turn = Math.atan2(
      arriving.x * leaving.y - arriving.y * leaving.x,
      arriving.x * leaving.x + arriving.y * leaving.y,
    );
    if (turn < -minimumTurn) corners.push({ element: index, vertex: element.b, arriving, turn });
  });
  return corners;
}
