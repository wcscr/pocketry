import { curveFitRange, validateFittedContour } from "./curve-fit";
import { simplifyOpen } from "./contour-simplification";
import { curveControls, curveRing, evaluateCurve, sampleCurveRing, splitCurve, type CurveAnchor, type CurveOutline, type CurveRing } from "./curves";
import { distanceToSegment, ringArea, traceRingKey } from "./rings";
import type { Point, RingRef } from "./types";

interface Attachment extends RingRef { position: number; distance: number; point: Point }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Find the closest point along an edge, including the middle of a long straight or cubic span. */
export function findBrushJoin(source: CurveOutline, p: Point, radius: number, visible?: (point: Point) => boolean): Attachment | undefined {
  const reach = radius * 2;
  let best: Attachment | undefined;
  for (const [shapeIndex, shape] of source.entries()) {
    for (const [r, ring] of [shape.outer, ...shape.holes].entries()) {
      for (let i = 0; i < ring.length; i++) {
        const cubic = curveControls(ring, i);
        if (cubic.every(q => q.x < p.x - reach) || cubic.every(q => q.x > p.x + reach) ||
            cubic.every(q => q.y < p.y - reach) || cubic.every(q => q.y > p.y + reach)) continue;
        const curved = ring[i].out || ring[(i + 1) % ring.length].in;
        const steps = curved ? 32 : 1;
        let a = cubic[0];
        for (let j = 1; j <= steps; j++) {
          const b = curved ? evaluateCurve(cubic, j / steps) : cubic[3];
          const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
          const u = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
          const t = (j - 1 + u) / steps;
          const point = evaluateCurve(cubic, t);
          const d = distance(p, point);
          if (d <= reach && (!best || d < best.distance) && (!visible || visible(point))) best = { shapeIndex, ringIndex: r - 1, position: (i + t) % ring.length, distance: d, point };
          a = b;
        }
      }
    }
  }
  return best;
}

/** Both ends must join distinct places on the same contour, within one brush diameter. */
export function redrawAttachments(source: CurveOutline, stroke: Point[], scale: number, radius: number, visible?: (point: Point) => boolean) {
  if (stroke.length < 2) return;
  const a = stroke[0], b = stroke[stroke.length - 1], span = distance(a, b);
  // Ignore click jitter, but let a deliberate long recess join even at a subpixel opening.
  if (span * scale < 3 && !stroke.some(point => distance(a, point) * scale >= 3)) return;
  const start = findBrushJoin(source, a, radius, visible), end = findBrushJoin(source, b, radius, visible);
  if (!start || !end || start.shapeIndex !== end.shapeIndex ||
      start.ringIndex !== end.ringIndex || distance(start.point, end.point) * scale < 1e-6) return;
  return { start, end };
}

/** Insert an anchor on a private copy of the ring. Splitting a cubic preserves both outside handles. */
function splitAt(ring: CurveRing, position: number): number {
  const i = Math.floor(position), t = position - i;
  if (t === 0) return i;
  const next = (i + 1) % ring.length;
  const [left, right] = splitCurve(curveControls(ring, i), t);
  const anchor: CurveAnchor = { point: left[3] };
  if (ring[i].out || ring[next].in) {
    ring[i].out = left[1]; ring[next].in = right[2];
    anchor.in = left[2]; anchor.out = right[1];
  }
  ring.splice(i + 1, 0, anchor);
  return i + 1;
}

/** Return the valid sides of a redraw in preview order. Only the chosen ring (including
 * other references to a shared hole) changes. Committing a preview is the caller's decision. */
export function redrawEdgeOptions(source: CurveOutline, stroke: Point[], scale: number, radius: number,
  ends = redrawAttachments(source, stroke, scale, radius)): CurveOutline[] {
  if (!ends) throw new Error("Start and finish near two different places on the same edge.");
  const { start, end } = ends;
  const ring = curveRing(source, start)!.map(a => ({ ...a }));
  const lo = Math.min(start.position, end.position), hi = Math.max(start.position, end.position);
  let highIndex = splitAt(ring, hi);
  const edge = Math.floor(lo);
  const adjusted = edge === Math.floor(hi) ? edge + (lo - edge) / (hi - edge) : lo;
  const lowIndex = splitAt(ring, adjusted);
  if (!Number.isInteger(adjusted)) highIndex++;
  const first = start.position === lo ? lowIndex : highIndex;
  const last = start.position === lo ? highIndex : lowIndex;
  const arcPoints = (from: number, to: number) => {
    const points = [ring[from].point];
    for (let i = from; i !== to; i = (i + 1) % ring.length) {
      const next = ring[(i + 1) % ring.length];
      if (ring[i].out || next.in) {
        const cubic = curveControls(ring, i);
        for (let j = 1; j < 16; j++) points.push(evaluateCurve(cubic, j / 16));
      }
      points.push(next.point);
    }
    return points;
  };
  const tolerance = .35 / scale;
  let work = 0;
  const budget = () => { if (++work > 2_000_000) throw new Error("Draw a shorter section of the edge."); };
  const line = simplifyOpen(stroke, tolerance, budget).points;
  const reverse = [...line].reverse();
  const forwardArc = arcPoints(first, last), backwardArc = arcPoints(last, first);
  // A stroke joining the same straight edge traces a recess, even when it spans most of the tool.
  const straight = (arc: Point[]) => arc.every(p => distanceToSegment(p, arc[0], arc[arc.length - 1]) <= tolerance);
  const forwardStraight = straight(forwardArc), backwardStraight = straight(backwardArc);
  const preferForward = forwardStraight !== backwardStraight ? forwardStraight
    : ringArea(forwardArc.concat(reverse)) <= ringArea(backwardArc.concat(line));
  const precision = Math.min(tolerance / 16, .01);
  const holeKey = (hole: CurveRing) => traceRingKey(sampleCurveRing(hole, precision));
  const sharedKey = start.ringIndex < 0 ? undefined : holeKey(curveRing(source, start)!);
  const replace = (from: number, to: number, strokePoints: Point[]) => {
    const a = { ...ring[from], smooth: false }, b = { ...ring[to], smooth: false };
    delete a.out; delete b.in;
    const middle = strokePoints.slice(
      distance(a.point, strokePoints[0]) < 1.5 / scale ? 1 : 0,
      distance(b.point, strokePoints[strokePoints.length - 1]) < 1.5 / scale ? -1 : undefined);
    const retained = curveFitRange(ring.length, to, from).slice(1, -1).map(i => ring[i]);
    const replacement = [a, ...middle.map(point => ({ point })), b, ...retained];
    const result = source.map((shape, i) => {
      if (sharedKey === undefined) return i === start.shapeIndex ? { ...shape, outer: replacement } : shape;
      const holes = shape.holes.map(hole => holeKey(hole) === sharedKey ? replacement : hole);
      return holes.some((hole, j) => hole !== shape.holes[j]) ? { ...shape, holes } : shape;
    });
    validateFittedContour(source, result, start, tolerance, budget, 0);
    return result;
  };
  const options: CurveOutline[] = [];
  let failure: unknown;
  for (const forward of [preferForward, !preferForward]) {
    try { options.push(forward ? replace(first, last, line) : replace(last, first, reverse)); }
    catch (error) { failure ??= error; }
  }
  if (options.length) return options;
  if (failure instanceof Error && /budget|complex|detailed|shorter/.test(failure.message)) {
    throw new Error("This contour is too detailed for this stroke. Try a shorter section or simplify the contour.");
  }
  throw new Error("That stroke would cross or collapse a contour. Trace a shorter section and rejoin the outline.");
}
