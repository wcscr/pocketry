import { distanceToSegment } from "./rings";
import type { Outline, Ring } from "./types";

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
  const cornerCos = Math.cos(Math.PI / 6);
  const pinned = ring.map((p, i) => {
    const a = ring[previous[i]], b = ring[next[i]];
    const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
    return ux * vx + uy * vy < cornerCos * Math.hypot(ux, uy) * Math.hypot(vx, vy);
  });
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
