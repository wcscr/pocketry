import { dedupeRing } from "@shared/geometry/rings";
import type { Point, Ring } from "@shared/geometry/types";

/** A scalar field sampled on a regular grid, one value per pixel. */
export type ScalarField = Uint8Array | Uint8ClampedArray | Float32Array | number[];

export interface TraceOptions {
  /** Samples with value >= iso are inside the shape. */
  iso: number;
  /** Interpolate crossings along cell edges for sub-pixel accuracy. */
  interpolate?: boolean;
  /**
   * How to resolve the ambiguous saddle case (two diagonally opposite inside
   * corners). `"separate"` keeps diagonally touching blobs apart; `"connect"`
   * merges them. Must be deterministic — an inconsistent choice produces
   * self-touching rings that break offsetting and triangulation downstream.
   */
  ambiguity?: "separate" | "connect";
}

/**
 * Extracts closed iso-contours from a scalar field by marching squares.
 *
 * Coordinates are returned in **sample space**, where integer coordinates are
 * pixel centres — so a crossing halfway between pixels 3 and 4 comes back as
 * 3.5, not 3.
 *
 * The field is virtually padded with one cell of background on every side. That
 * is not an optimisation: without it, an object touching the image or ROI edge
 * produces an *open* contour rather than a ring, which happens for essentially
 * every cropped region.
 *
 * Rings come back with the same sign convention as the rest of the model:
 * shells have positive signed area, holes negative.
 */
export function traceIsoRings(
  field: ScalarField,
  width: number,
  height: number,
  options: TraceOptions,
): Ring[] {
  const { iso, interpolate = true, ambiguity = "separate" } = options;
  if (width <= 0 || height <= 0) return [];

  // Padded sampling: index -1..width and -1..height read as background.
  const sample = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return iso - 1;
    return field[y * width + x];
  };

  const inside = (x: number, y: number): boolean => sample(x, y) >= iso;

  // Grid of cells spanning the padded field. Cell (cx, cy) has corners at
  // sample coordinates (cx-1, cy-1) .. (cx, cy).
  const cellsX = width + 1;
  const cellsY = height + 1;

  /**
   * Directed boundary segments, keyed by their start point. Marching squares
   * emits each segment so the inside stays on a consistent side, which means
   * following `start -> end` links walks a complete ring.
   */
  const segments = new Map<string, Point[]>();

  const key = (p: Point) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;

  const addSegment = (from: Point, to: Point) => {
    const k = key(from);
    const existing = segments.get(k);
    if (existing) existing.push(to);
    else segments.set(k, [to]);
  };

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      // Corner sample coordinates.
      const x0 = cx - 1;
      const y0 = cy - 1;
      const x1 = cx;
      const y1 = cy;

      const tl = inside(x0, y0);
      const tr = inside(x1, y0);
      const br = inside(x1, y1);
      const bl = inside(x0, y1);

      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;

      // Crossing points on each cell edge, interpolated by value.
      const top = (): Point => ({
        x: interpolate ? x0 + crossFraction(sample(x0, y0), sample(x1, y0), iso) : x0 + 0.5,
        y: y0,
      });
      const bottom = (): Point => ({
        x: interpolate ? x0 + crossFraction(sample(x0, y1), sample(x1, y1), iso) : x0 + 0.5,
        y: y1,
      });
      const left = (): Point => ({
        x: x0,
        y: interpolate ? y0 + crossFraction(sample(x0, y0), sample(x0, y1), iso) : y0 + 0.5,
      });
      const right = (): Point => ({
        x: x1,
        y: interpolate ? y0 + crossFraction(sample(x1, y0), sample(x1, y1), iso) : y0 + 0.5,
      });

      // Segments are emitted with the **inside on the right** of travel.
      // In a y-down frame that traverses an object's boundary clockwise on
      // screen, which is the model's positive/outer orientation — so shells
      // come out positive and holes negative with no post-hoc fixing.
      //
      // Each case only ever names edges that actually carry a crossing: an
      // edge has one exactly when its two corner samples differ.
      switch (code) {
        case 1: addSegment(left(), bottom()); break;   // bl
        case 2: addSegment(bottom(), right()); break;  // br
        case 3: addSegment(left(), right()); break;    // bl+br  (object below)
        case 4: addSegment(right(), top()); break;     // tr
        case 6: addSegment(bottom(), top()); break;    // tr+br  (object right)
        case 7: addSegment(left(), top()); break;      // all but tl
        case 8: addSegment(top(), left()); break;      // tl
        case 9: addSegment(top(), bottom()); break;    // tl+bl  (object left)
        case 11: addSegment(top(), right()); break;    // all but tr
        case 12: addSegment(right(), left()); break;   // tl+tr  (object above)
        case 13: addSegment(right(), bottom()); break; // all but br
        case 14: addSegment(bottom(), left()); break;  // all but bl

        // Saddles: the inside corners are diagonally opposite, so the cell
        // carries two segments and the pairing is genuinely ambiguous.
        case 5: // tr and bl inside
          if (ambiguity === "separate") {
            addSegment(right(), top());
            addSegment(left(), bottom());
          } else {
            addSegment(left(), top());
            addSegment(right(), bottom());
          }
          break;
        case 10: // tl and br inside
          if (ambiguity === "separate") {
            addSegment(top(), left());
            addSegment(bottom(), right());
          } else {
            addSegment(top(), right());
            addSegment(bottom(), left());
          }
          break;
      }
    }
  }

  return assembleRings(segments, key);
}

/** Where along a–b the iso level is crossed, as a 0..1 fraction. */
function crossFraction(a: number, b: number, iso: number): number {
  const delta = b - a;
  if (delta === 0) return 0.5;
  const t = (iso - a) / delta;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Follows the directed segment graph, emitting one ring per closed walk. */
function assembleRings(
  segments: Map<string, Point[]>,
  key: (p: Point) => string,
): Ring[] {
  const rings: Ring[] = [];

  // Each start key may hold several outgoing segments (saddle cells); consume
  // them one at a time so every segment is used exactly once.
  const takeNext = (from: Point): Point | null => {
    const k = key(from);
    const list = segments.get(k);
    if (!list || list.length === 0) return null;
    const next = list.pop()!;
    if (list.length === 0) segments.delete(k);
    return next;
  };

  // Every segment must be consumed, so the walk length is bounded by the
  // total segment count.
  let remaining = 0;
  for (const list of segments.values()) remaining += list.length;

  while (segments.size > 0) {
    const startKey = segments.keys().next().value as string;
    const firstList = segments.get(startKey);
    if (!firstList || firstList.length === 0) {
      segments.delete(startKey);
      continue;
    }

    const [sx, sy] = startKey.split(",").map(Number);
    const start: Point = { x: sx, y: sy };

    const ring: Point[] = [start];
    let current = start;
    let closed = false;

    for (let step = 0; step <= remaining; step++) {
      const next = takeNext(current);
      if (!next) break; // Dead end: the walk did not close.
      if (key(next) === startKey) {
        closed = true;
        break;
      }
      ring.push(next);
      current = next;
    }

    // An unclosed walk means the segment table is inconsistent, which would
    // otherwise surface as a silently truncated outline (a sliver along one
    // edge) rather than an error. Because the field is virtually padded with
    // background, every contour is closed by construction.
    if (!closed) {
      throw new Error(
        `traceIsoRings: contour did not close after ${ring.length} points ` +
          `(starting at ${startKey}). This indicates an inconsistent segment table.`,
      );
    }

    const cleaned = dedupeRing(ring, 1e-6);
    if (cleaned.length >= 3) rings.push(cleaned);
  }

  return rings;
}

/**
 * Builds a scalar field from a predicate, for tests and synthetic fixtures.
 * Inside samples get 255, outside 0.
 */
export function fieldFromPredicate(
  width: number,
  height: number,
  isInside: (x: number, y: number) => boolean,
): Uint8Array {
  const field = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field[y * width + x] = isInside(x, y) ? 255 : 0;
    }
  }
  return field;
}
