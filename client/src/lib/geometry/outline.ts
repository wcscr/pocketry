import {
  boundsContain,
  dedupeRing,
  doubleSignedArea,
  ensureOrientation,
  isValidRing,
  pointInRing,
  ringArea,
  ringBounds,
} from "@shared/geometry/rings";
import {
  HOLE_ORIENTATION,
  OUTER_ORIENTATION,
  OUTER_RING,
  type Bounds,
  type Outline,
  type Point,
  type Ring,
  type RingRef,
  type Shape,
} from "@shared/geometry/types";

/**
 * Groups unordered rings into shapes by containment depth.
 *
 * Rings produced by a contour tracer never cross, so a ring is either wholly
 * inside another or wholly outside it — one point-in-ring test per candidate
 * pair suffices, after a bounding-box pre-filter.
 *
 * Even depth is a shell, odd depth is a hole of the nearest enclosing shell.
 * An island sitting inside a hole (depth 2) therefore becomes its own shape,
 * which is why this handles arbitrary nesting rather than assuming the two
 * levels that `RETR_CCOMP` would give.
 */
export function buildOutline(rings: readonly Ring[]): Outline {
  const usable = rings.filter(isValidRing);
  if (usable.length === 0) return [];

  const entries = usable.map((ring, index) => ({
    index,
    ring,
    bounds: ringBounds(ring) as Bounds,
    area: ringArea(ring),
    depth: 0,
    parent: -1,
  }));

  // Largest first, so the first enclosing ring found walking outward is also
  // the *nearest* enclosing ring.
  const bySize = [...entries].sort((a, b) => b.area - a.area);

  for (const entry of entries) {
    const probe = representativePoint(entry.ring);
    let depth = 0;
    let parent = -1;
    let parentArea = Infinity;

    for (const candidate of bySize) {
      if (candidate.index === entry.index) continue;
      if (candidate.area <= entry.area) continue; // A container is strictly larger.
      if (!boundsContain(candidate.bounds, entry.bounds)) continue;
      if (!pointInRing(candidate.ring, probe)) continue;

      depth++;
      if (candidate.area < parentArea) {
        parentArea = candidate.area;
        parent = candidate.index;
      }
    }

    entry.depth = depth;
    entry.parent = parent;
  }

  const shapes = new Map<number, Shape>();
  for (const entry of entries) {
    if (entry.depth % 2 === 0) {
      shapes.set(entry.index, {
        outer: ensureOrientation(entry.ring, OUTER_ORIENTATION),
        holes: [],
      });
    }
  }
  for (const entry of entries) {
    if (entry.depth % 2 === 0) continue;
    const shape = shapes.get(entry.parent);
    // A hole whose parent was filtered out is dropped rather than promoted.
    if (shape) shape.holes.push(ensureOrientation(entry.ring, HOLE_ORIENTATION));
  }

  return [...shapes.values()].sort(
    (a, b) => ringArea(b.outer) - ringArea(a.outer),
  );
}

/**
 * A point guaranteed to lie strictly inside the ring, for containment tests.
 *
 * A vertex will not do — a shared vertex between nested rings makes the test
 * ambiguous. The centroid will not do either, since it can fall outside a
 * concave ring, which is precisely the geometry this app produces. Instead this
 * casts a horizontal ray at a y between two distinct vertices and takes the
 * midpoint of the first interior span.
 */
export function representativePoint(ring: Ring): Point {
  const n = ring.length;
  const bounds = ringBounds(ring);
  if (!bounds || n < 3) return ring[0] ?? { x: 0, y: 0 };

  // Scan a few candidate heights; a single one can miss on pathological rings.
  const candidates = [0.5, 0.25, 0.75, 0.1, 0.9];
  for (const t of candidates) {
    const y = bounds.minY + (bounds.maxY - bounds.minY) * t;
    const crossings: number[] = [];

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[j];
      const b = ring[i];
      if (a.y > y === b.y > y) continue;
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }

    if (crossings.length >= 2) {
      crossings.sort((p, q) => p - q);
      // Interior spans are the even-indexed pairs after sorting.
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const mid = (crossings[i] + crossings[i + 1]) / 2;
        if (crossings[i + 1] - crossings[i] > 1e-9) return { x: mid, y };
      }
    }
  }

  // Degenerate ring (zero height, collinear): any vertex is as good as any.
  return ring[0];
}

export interface NormalizeOptions {
  /** Drop shells smaller than this fraction of the largest shell. */
  minShellAreaFrac?: number;
  /** Drop holes smaller than this fraction of their parent shell. */
  minHoleAreaFrac?: number;
  /** Collapse points closer together than this. */
  dedupeEpsilon?: number;
}

/**
 * Enforces the model's invariants: deduped rings, correct winding, no
 * degenerate rings, and speckles removed.
 *
 * Speckle removal happens here in polygon space rather than by tuning
 * morphology kernels in pixel space — it is predictable and unit-testable.
 */
export function normalizeOutline(
  outline: Outline,
  options: NormalizeOptions = {},
): Outline {
  const {
    minShellAreaFrac = 0,
    minHoleAreaFrac = 0,
    dedupeEpsilon = 1e-9,
  } = options;

  const shapes: Shape[] = [];
  for (const shape of outline) {
    const outer = dedupeRing(shape.outer, dedupeEpsilon);
    if (!isValidRing(outer)) continue;
    shapes.push({
      outer: ensureOrientation(outer, OUTER_ORIENTATION),
      holes: shape.holes
        .map((hole) => dedupeRing(hole, dedupeEpsilon))
        .filter(isValidRing)
        .map((hole) => ensureOrientation(hole, HOLE_ORIENTATION)),
    });
  }
  if (shapes.length === 0) return [];

  const largest = Math.max(...shapes.map((s) => ringArea(s.outer)));
  const shellFloor = largest * minShellAreaFrac;

  return shapes
    .filter((shape) => ringArea(shape.outer) >= shellFloor)
    .map((shape) => {
      const parentArea = ringArea(shape.outer);
      const holeFloor = parentArea * minHoleAreaFrac;
      return {
        outer: shape.outer,
        holes: shape.holes.filter((hole) => ringArea(hole) >= holeFloor),
      };
    })
    .sort((a, b) => ringArea(b.outer) - ringArea(a.outer));
}

/** Every ring in an outline, shells and holes alike. */
export function outlineRings(outline: Outline): Ring[] {
  return outline.flatMap((shape) => [shape.outer, ...shape.holes]);
}

/** Iterates rings alongside the reference that identifies them. */
export function* iterateRings(
  outline: Outline,
): Generator<{ ref: RingRef; ring: Ring }> {
  for (let shapeIndex = 0; shapeIndex < outline.length; shapeIndex++) {
    const shape = outline[shapeIndex];
    yield { ref: { shapeIndex, ringIndex: OUTER_RING }, ring: shape.outer };
    for (let ringIndex = 0; ringIndex < shape.holes.length; ringIndex++) {
      yield { ref: { shapeIndex, ringIndex }, ring: shape.holes[ringIndex] };
    }
  }
}

/** Resolves a {@link RingRef} against an outline, or `null` if out of range. */
export function getRing(outline: Outline, ref: RingRef): Ring | null {
  const shape = outline[ref.shapeIndex];
  if (!shape) return null;
  if (ref.ringIndex === OUTER_RING) return shape.outer;
  return shape.holes[ref.ringIndex] ?? null;
}

/** Replaces the ring at `ref`, returning a new outline. */
export function setRing(outline: Outline, ref: RingRef, ring: Ring): Outline {
  return outline.map((shape, shapeIndex) => {
    if (shapeIndex !== ref.shapeIndex) return shape;
    if (ref.ringIndex === OUTER_RING) return { ...shape, outer: ring };
    return {
      ...shape,
      holes: shape.holes.map((hole, i) => (i === ref.ringIndex ? ring : hole)),
    };
  });
}

/**
 * Removes the ring at `ref`. Deleting a shell removes its holes with it, since
 * holes without an enclosing shell have no meaning.
 */
export function removeRing(outline: Outline, ref: RingRef): Outline {
  if (ref.ringIndex === OUTER_RING) {
    return outline.filter((_, index) => index !== ref.shapeIndex);
  }
  return outline.map((shape, shapeIndex) => {
    if (shapeIndex !== ref.shapeIndex) return shape;
    return {
      ...shape,
      holes: shape.holes.filter((_, i) => i !== ref.ringIndex),
    };
  });
}

/** True when both refs point at the same ring. */
export function sameRingRef(a: RingRef | null, b: RingRef | null): boolean {
  if (!a || !b) return a === b;
  return a.shapeIndex === b.shapeIndex && a.ringIndex === b.ringIndex;
}

/** Total signed area: shells minus holes. */
export function outlineArea(outline: Outline): number {
  let total = 0;
  for (const shape of outline) {
    total += doubleSignedArea(shape.outer) / 2;
    for (const hole of shape.holes) total += doubleSignedArea(hole) / 2;
  }
  return total;
}

/** Bounds enclosing every shell in the outline. */
export function outlineBounds(outline: Outline): Bounds | null {
  let result: Bounds | null = null;
  for (const shape of outline) {
    const bounds = ringBounds(shape.outer);
    if (!bounds) continue;
    result = result
      ? {
          minX: Math.min(result.minX, bounds.minX),
          minY: Math.min(result.minY, bounds.minY),
          maxX: Math.max(result.maxX, bounds.maxX),
          maxY: Math.max(result.maxY, bounds.maxY),
        }
      : bounds;
  }
  return result;
}

/** Total number of points across every ring. */
export function outlinePointCount(outline: Outline): number {
  let total = 0;
  for (const shape of outline) {
    total += shape.outer.length;
    for (const hole of shape.holes) total += hole.length;
  }
  return total;
}

/** Applies `fn` to every point of every ring, preserving structure. */
export function mapOutline(outline: Outline, fn: (point: Point) => Point): Outline {
  return outline.map((shape) => ({
    outer: shape.outer.map(fn),
    holes: shape.holes.map((hole) => hole.map(fn)),
  }));
}

/** Translates an outline. */
export function translateOutline(outline: Outline, dx: number, dy: number): Outline {
  return mapOutline(outline, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Uniformly scales an outline about the origin. */
export function scaleOutline(outline: Outline, factor: number): Outline {
  return mapOutline(outline, (p) => ({ x: p.x * factor, y: p.y * factor }));
}

/**
 * Converts between the y-down image frame and a y-up model frame.
 *
 * Negating y alone would invert every ring's signed area and turn shells into
 * holes, so each ring is also **reversed**. The orientation invariant
 * (shells positive, holes negative) therefore holds in both frames, and this is
 * the only place the flip happens — the DXF and STL writers share it instead of
 * each negating y on their own, which is how they previously disagreed and
 * shipped mirrored STLs.
 */
export function flipOutlineY(outline: Outline, height: number): Outline {
  const flipRing = (ring: Ring): Ring => {
    const flipped: Point[] = new Array(ring.length);
    // Reverse while mapping, so winding is preserved in one pass.
    for (let i = 0; i < ring.length; i++) {
      const source = ring[ring.length - 1 - i];
      flipped[i] = { x: source.x, y: height - source.y };
    }
    return flipped;
  };
  return outline.map((shape) => ({
    outer: flipRing(shape.outer),
    holes: shape.holes.map(flipRing),
  }));
}

/**
 * Backward-compatibility bridge to the old flat `Point[]` model: the outer ring
 * of the largest shape. Lossy by definition — holes and additional shapes are
 * discarded — so it exists only for call sites not yet migrated.
 */
export function flattenOutline(outline: Outline): Point[] {
  if (outline.length === 0) return [];
  let best = outline[0];
  let bestArea = ringArea(best.outer);
  for (const shape of outline) {
    const area = ringArea(shape.outer);
    if (area > bestArea) {
      best = shape;
      bestArea = area;
    }
  }
  return best.outer;
}

/** Wraps a flat point list as a single-shape outline. */
export function outlineFromPoints(points: readonly Point[]): Outline {
  if (points.length < 3) return [];
  return [{ outer: ensureOrientation([...points], OUTER_ORIENTATION), holes: [] }];
}

/** True when `point` is inside the filled region (shells minus holes). */
export function pointInOutline(outline: Outline, point: Point): boolean {
  for (const shape of outline) {
    if (!pointInRing(shape.outer, point)) continue;
    if (shape.holes.some((hole) => pointInRing(hole, point))) continue;
    return true;
  }
  return false;
}
