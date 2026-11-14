import { curvesFromOutline } from "@shared/geometry/curves";
import { validateFittedContour } from "@shared/geometry/curve-fit";
import { continueBoundary, sampleBoundaryBridge, visibleTangent } from "@shared/geometry/outline-repair";
import { distanceToSegment, pointInRing } from "@shared/geometry/rings";
import type { Outline, Point, Ring, RingRef } from "@shared/geometry/types";

/** Local continuation for ONE short missing run. All observed vertices remain
 * untouched. Multiple crossings, weak tangents, long gaps or invalid topology
 * keep the score-field estimate and its existing review highlight instead.
 */
export function repairOccludedOutline(source: Outline, footprints: readonly Ring[], resolution: number): Outline {
  if (!Number.isFinite(resolution) || resolution <= 0) return source;
  let result = source, work = 0;
  for (const footprint of footprints) {
    if (footprint.length < 3 || footprint.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
    const candidates = result.flatMap((shape, shapeIndex) => [shape.outer, ...shape.holes].flatMap((ring, i) => {
      if (ring.length > 6000) return [];
      const inside = ring.map(p => pointInRing(footprint, p));
      const starts = inside.flatMap((value, j) => value && !inside[(j + ring.length - 1) % ring.length] ? [j] : []);
      return starts.map(start => ({ ring, inside, start, ref: { shapeIndex, ringIndex: i - 1 } as RingRef }));
    }));
    if (candidates.length !== 1) continue;
    const { ring, inside, start, ref } = candidates[0], n = ring.length;
    const first = (start + n - 1) % n; let last = start, hiddenLength = 0;
    while (inside[last]) {
      const next = (last + 1) % n;
      hiddenLength += Math.hypot(ring[last].x - ring[next].x, ring[last].y - ring[next].y); last = next;
    }
    const a = ring[first], b = ring[last], span = Math.hypot(b.x - a.x, b.y - a.y);
    const perimeter = ring.reduce((sum, p, i) => sum + Math.hypot(p.x - ring[(i + 1) % n].x, p.y - ring[(i + 1) % n].y), 0);
    if (span < resolution * 4 || hiddenLength > perimeter * .12 || hiddenLength > span * 1.8) continue;
    const context = (index: number, direction: -1 | 1): Point[] => {
      const points = [ring[index]]; let travelled = 0;
      const reach = Math.max(resolution * 8, span * .65);
      for (let step = 1; step < n / 3 && travelled < reach; step++) {
        const j = (index + direction * step + n) % n;
        if (inside[j]) break;
        const previous = points.at(-1)!, p = ring[j], distance = Math.hypot(p.x - previous.x, p.y - previous.y);
        if (distance < 1e-12) continue;
        const used = Math.min(distance, reach - travelled);
        points.push({ x: previous.x + (p.x - previous.x) * used / distance, y: previous.y + (p.y - previous.y) * used / distance }); travelled += used;
      }
      return points;
    };
    const before = visibleTangent(context(first, -1), resolution), after = visibleTangent(context(last, 1), resolution);
    if (!before || !after) continue;
    const bridge = continueBoundary(a, b, { x: -before.x, y: -before.y }, after);
    if (!bridge) continue;
    const points = sampleBoundaryBridge(bridge, resolution * .2);
    // The entire curve lies in the unknown patch (apart from a two-sample
    // interpolation fringe), and no more than a quarter-chord from its chord.
    if (points.some(p => !pointInRing(footprint, p) && !footprint.some((q, i) => distanceToSegment(p, q, footprint[(i + 1) % footprint.length]) <= resolution * 2)) ||
      points.some(p => distanceToSegment(p, a, b) > span * .25)) continue;
    const remaining: Point[] = [];
    for (let i = (last + 1) % n; i !== first; i = (i + 1) % n) remaining.push(ring[i]);
    const replacement = [...points, ...remaining];
    const next = result.map((s, i) => i !== ref.shapeIndex ? s : ref.ringIndex === -1 ? { ...s, outer: replacement }
      : { ...s, holes: s.holes.map((r, j) => j === ref.ringIndex ? replacement : r) });
    try {
      validateFittedContour(curvesFromOutline(result), curvesFromOutline(next), ref, resolution,
        () => { if (++work > 2_000_000) throw new Error("Occlusion repair budget exceeded"); });
      result = next;
    } catch { /* Keep the local score estimate and review marker. */ }
  }
  return result;
}
