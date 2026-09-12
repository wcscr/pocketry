import { ensureOrientation, pointInRing, signedArea } from "../geometry/rings";
import type { Outline, Point, Ring } from "../geometry/types";

const EPS = 1e-6;
const MIN_SECTION_AREA_MM2 = 0.25;

/** Projection used for edge snapping, in whichever frame the caller supplies. */
export function nearestPocketEdge(outline: Outline, point: Point): Point | null {
  let best: Point | null = null;
  let distance = Infinity;
  for (const { outer } of outline) {
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
      const candidate = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (d < distance) { best = candidate; distance = d; }
    }
  }
  return best;
}

export function splitSide(boundary: readonly Point[], point: Point): number {
  const [a, b] = boundary;
  return ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) /
    Math.hypot(b.x - a.x, b.y - a.y);
}

/** Match a redrawn path's direction to the old one so starting from the other
 * edge does not exchange Section A/B. Endpoints determine correspondence;
 * reversing the whole path also retains any future intermediate vertices.
 */
export function orientRedrawnPocketSplit(boundary: Point[], previous: readonly Point[]): Point[] {
  const a = boundary[0], b = boundary.at(-1)!;
  const oldA = previous[0], oldB = previous.at(-1)!;
  const alignment = (b.x - a.x) * (oldB.x - oldA.x) + (b.y - a.y) * (oldB.y - oldA.y);
  // Perpendicular paths have no preferred correspondence. Use a stable tie
  // break so reversing the input still produces the same section assignments.
  const reverse = alignment < 0 || (alignment === 0 && (a.x > b.x || (a.x === b.x && a.y > b.y)));
  return reverse ? [...boundary].reverse() : boundary;
}

/** Half-plane clipping is only used after proving the line cuts the perimeter
 * exactly twice, so each result is a single ring, even for concave outlines.
 * Shared by canvas/validation; solid clipping stays in the Manifold kernel.
 */
function clipRing(ring: Ring, boundary: readonly Point[], side: number): Ring {
  const result: Point[] = [];
  const append = (p: Point) => {
    const last = result.at(-1);
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > EPS) result.push(p);
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const da = splitSide(boundary, a) * side, db = splitSide(boundary, b) * side;
    if (da >= -EPS) append(a);
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const t = da / (da - db);
      append({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  if (result.length > 1 && Math.hypot(result[0].x - result.at(-1)!.x, result[0].y - result.at(-1)!.y) <= EPS) result.pop();
  return ensureOrientation(result, 1);
}

export type ResolvedPocketSplit = { regions: [Outline, Outline]; boundary: [Point, Point]; error?: never } |
  { regions?: never; boundary?: never; error: string };

/** Reject ambiguous/tangent/multipart splits instead of silently losing pieces.
 * The authored points define a fixed line. Its visible ends are intersections
 * with the current outline, so contour edits cannot move its position or angle.
 */
export function resolvePocketSplit(outline: Outline, boundary: readonly Point[]): ResolvedPocketSplit {
  if (boundary.length !== 2 || boundary.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { error: "Use a straight split with two edge points." };
  }
  const [a, b] = boundary;
  if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) return { error: "Choose two different edge points." };
  if (outline.length !== 1) return { error: "Split needs one connected tool outline." };
  const { outer, holes } = outline[0];
  const intersections: Point[] = [];
  const addIntersection = (p: Point) => {
    if (!intersections.some(q => Math.hypot(q.x - p.x, q.y - p.y) <= EPS)) intersections.push(p);
  };
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i], q = outer[(i + 1) % outer.length];
    const dp = splitSide(boundary, p), dq = splitSide(boundary, q);
    if (Math.abs(dp) <= EPS && Math.abs(dq) <= EPS) return { error: "Draw across the pocket, not along its edge." };
    if (Math.abs(dp) <= EPS) addIntersection(p);
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const t = dp / (dp - dq);
      addIntersection({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  if (intersections.length !== 2) {
    return { error: "Choose a line that divides the outline into two connected sections." };
  }
  // Retain the authored direction: sorting in ring order could swap A/B.
  const dx = b.x - a.x, dy = b.y - a.y;
  intersections.sort((p, q) => (p.x - q.x) * dx + (p.y - q.y) * dy);
  const [start, end] = intersections;
  if (!pointInRing(outer, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })) {
    return { error: "Choose a line that divides the outline into two connected sections." };
  }
  for (const hole of holes) {
    const distances = hole.map(p => splitSide(boundary, p));
    if (Math.min(...distances) <= EPS && Math.max(...distances) >= -EPS) {
      return { error: "The split cannot cross or touch an interior hole." };
    }
  }
  const regions = [1, -1].map(side => [{
    outer: clipRing(outer, boundary, side),
    holes: holes.filter(hole => splitSide(boundary, hole[0]) * side > EPS),
  }]) as [Outline, Outline];
  if (regions.some(region => Math.abs(signedArea(region[0].outer)) - region[0].holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0) < MIN_SECTION_AREA_MM2)) {
    return { error: "Move the split inward to leave two usable sections." };
  }
  return { regions, boundary: [start, end] };
}
