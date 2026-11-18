import { simplifyOpen } from "./chord-simplification";
import { distanceToSegment } from "./rings";
import type { Outline, Point, Ring } from "./types";

const CORNER_COS = Math.cos(Math.PI / 6);

function sharpCorner(ring: Ring, i: number): boolean {
  const a = ring[(i + ring.length - 1) % ring.length], p = ring[i], b = ring[(i + 1) % ring.length];
  const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
  return ux * vx + uy * vy < CORNER_COS * Math.hypot(ux, uy) * Math.hypot(vx, vy);
}

/** Remove redundant editing points on a closed polygon. Spacing is a target:
 * a corner or a curve that needs closer points to meet the error limit wins. */
export function thinEditingRing(ring: Ring, spacing: number, tolerance: number): Ring {
  const n = ring.length;
  if (n <= 3 || !(spacing > 0 && tolerance > 0)) return ring;
  const previous = ring.map((_, i) => (i + n - 1) % n);
  const next = ring.map((_, i) => (i + 1) % n);
  const removed = new Uint8Array(n);
  // Error already spent on each outgoing chord, relative to the original run.
  const error = new Float64Array(n);
  const queue = ring.map((_, i) => i);
  const pinned = ring.map((_, i) => sharpCorner(ring, i));
  let count = n;
  for (let k = 0; k < queue.length && count > 3; k++) {
    const i = queue[k];
    if (removed[i] || pinned[i]) continue;
    const left = previous[i], right = next[i];
    const a = ring[left], p = ring[i], b = ring[right];
    const deviation = distanceToSegment(p, a, b);
    const bound = deviation + Math.max(error[left], error[i]);
    if (bound > tolerance) continue;
    // An exactly straight run needs only its endpoints, even if they are far apart.
    if (deviation > 1e-9 && Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(b.x - p.x, b.y - p.y)) >= spacing) continue;
    removed[i] = 1;
    count--;
    next[left] = right;
    previous[right] = left;
    error[left] = bound;
    queue.push(left, right);
  }
  return count === n ? ring : ring.filter((_, i) => !removed[i]);
}

/** Return the original outline by identity when no edit points can be removed. */
export function thinEditingOutline(outline: Outline, spacing: number, tolerance: number): Outline {
  let changed = false;
  const result = outline.map(shape => {
    const outer = thinEditingRing(shape.outer, spacing, tolerance);
    const holes = shape.holes.map(r => thinEditingRing(r, spacing, tolerance));
    changed ||= outer !== shape.outer || holes.some((r, i) => r !== shape.holes[i]);
    return { outer, holes };
  });
  return changed ? result : outline;
}

// Subdivide at the existing sharp corners. A smooth closed ring (or a teardrop
// with one corner) needs two well-separated starting points for the open chains.
function collapseRing(source: Ring, spaced: Ring, tolerance: number, budget: () => void): Ring {
  if (spaced.length <= 3) return spaced;
  const eligible = new Set(spaced);
  const corners: number[] = [];
  let leftmost = -1;
  source.forEach((p, i) => {
    if (!eligible.has(p)) return;
    if (sharpCorner(source, i)) corners.push(i);
    if (leftmost < 0 || p.x < source[leftmost].x || (p.x === source[leftmost].x && p.y < source[leftmost].y)) leftmost = i;
  });
  if (corners.length < 2) {
    const first = corners[0] ?? leftmost;
    let farthest = first, distance = 0;
    source.forEach((p, i) => {
      if (!eligible.has(p)) return;
      const d = (p.x - source[first].x) ** 2 + (p.y - source[first].y) ** 2;
      if (d > distance) { farthest = i; distance = d; }
    });
    if (first === farthest) return spaced;
    corners.splice(0, corners.length, Math.min(first, farthest), Math.max(first, farthest));
  }
  const kept = new Set<Point>();
  for (let i = 0; i < corners.length; i++) {
    const start = corners[i], end = corners[(i + 1) % corners.length];
    const chain = end > start ? source.slice(start, end + 1) : source.slice(start).concat(source.slice(0, end + 1));
    const result = simplifyOpen(chain, tolerance, budget, eligible);
    for (const p of result.points) {
      if (!eligible.has(p)) return spaced;
      kept.add(p);
    }
  }
  return kept.size >= 3 && kept.size < spaced.length ? spaced.filter(p => kept.has(p)) : spaced;
}

/** Check every pre-spacing vertex on each proposed edge. In particular, the
 * straight-run tolerance and the spacing tolerance do not add together. */
export function collapseStraightRuns(source: Outline, spaced: Outline, tolerance: number): Outline {
  if (!(tolerance > 0 && Number.isFinite(tolerance))) return spaced;
  let work = 0;
  const limit = Symbol();
  const budget = () => { if (++work > 500_000) throw limit; };
  try {
    let changed = false;
    const next = spaced.map((shape, i) => {
      const outer = collapseRing(source[i].outer, shape.outer, tolerance, budget);
      const holes = shape.holes.map((r, j) => collapseRing(source[i].holes[j], r, tolerance, budget));
      changed ||= outer !== shape.outer || holes.some((r, j) => r !== shape.holes[j]);
      return { outer, holes };
    });
    return changed ? next : spaced;
  } catch (error) {
    if (error === limit) return spaced;
    throw error;
  }
}
