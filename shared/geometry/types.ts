/**
 * The geometry model shared by the tracing pipeline, the exporters, and (later)
 * the Gridfinity bin generator.
 *
 * These types are deliberately dependency-free so they can be imported by the
 * server and by Node tests without pulling in OpenCV or manifold.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * A closed ring of points.
 *
 * The edge from the last point back to the first is **implicit** — never repeat
 * the first point at the end. A valid ring has at least 3 points.
 */
export type Ring = Point[];

/** One connected component: an outer boundary plus zero or more holes. */
export interface Shape {
  outer: Ring;
  holes: Ring[];
}

/** A complete detection result: zero or more disjoint shapes. */
export type Outline = Shape[];

/** An axis-aligned bounding box. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** An axis-aligned rectangle, as used for regions of interest. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Identifies one ring inside an {@link Outline}. `ringIndex === OUTER_RING`
 * refers to the shape's outer boundary; otherwise it indexes into `holes`.
 */
export interface RingRef {
  shapeIndex: number;
  ringIndex: number;
}

/** Sentinel `ringIndex` meaning "the outer ring". */
export const OUTER_RING = -1;

/**
 * Orientation convention, stated once and enforced by `normalizeOutline`:
 *
 * Signed area uses the shoelace sum `A = ½ Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)`.
 *
 * - **Outer rings have positive signed area.**
 * - **Holes have negative signed area.**
 *
 * The tracing domain is y-down (image pixels), where a positive shoelace reads
 * as clockwise on screen. The export domain is y-up (millimetres), where the
 * same sign reads as counter-clockwise — which is exactly what manifold's
 * `CrossSection` expects under its default `Positive` fill rule.
 *
 * Because the sign convention is identical in both frames, `flipOutlineY` must
 * reverse each ring as well as negating y; see its documentation.
 */
export type OrientationSign = 1 | -1;

export const OUTER_ORIENTATION: OrientationSign = 1;
export const HOLE_ORIENTATION: OrientationSign = -1;
