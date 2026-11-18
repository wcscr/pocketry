import { distanceToSegment } from "./rings";
import type { Point, Ring } from "./types";

/** Fit finite chords to an ordered open chain. Test the original samples even
 * when only a subset of them may become endpoints (e.g. after point thinning). */
export function simplifyOpen(points: Ring, tolerance: number, budget: () => void, endpoints?: ReadonlySet<Point>): {
  points: Ring; maxDeviation: number;
} {
  let maxDeviation = 0;
  const fit = (first: number, last: number, depth: number): Ring => {
    budget();
    const a = points[first], b = points[last];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let error = 0, split = first, progress = 0, reversal = 0;
    for (let i = first + 1; i < last; i++) {
      budget();
      const p = points[i], distance = distanceToSegment(p, a, b);
      if (distance > error) { error = distance; split = i; }
      const along = length ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length : 0;
      reversal = Math.max(reversal, progress - along);
      progress = Math.max(progress, along);
    }
    if (error <= tolerance && reversal <= tolerance) {
      maxDeviation = Math.max(maxDeviation, error);
      return [a, b];
    }
    if (depth >= 24) return points.slice(first, last + 1);
    if (split === first || reversal > tolerance) split = first + Math.floor((last - first + 1) / 2);
    if (endpoints && !endpoints.has(points[split])) {
      let left = split - 1, right = split + 1;
      while (left > first || right < last) {
        budget();
        if (left > first && endpoints.has(points[left])) { split = left; break; }
        if (right < last && endpoints.has(points[right])) { split = right; break; }
        left--; right++;
      }
      // No eligible split can certify this span. Return its original samples
      // so the caller can fall back to the previously accepted outline.
      if (!endpoints.has(points[split])) return points.slice(first, last + 1);
    }
    return [...fit(first, split, depth + 1).slice(0, -1), ...fit(split, last, depth + 1)];
  };
  return { points: fit(0, points.length - 1, 0), maxDeviation };
}
