import { curveFitRange, validateFittedContour } from "./curve-fit";
import { simplifyOpen } from "./contour-simplification";
import { curveControls, curveRing, evaluateCurve, splitCurve, type CurveAnchor, type CurveOutline, type CurveRing } from "./curves";
import { ringArea } from "./rings";
import type { Point, RingRef } from "./types";

interface Attachment extends RingRef { position: number; distance: number; point: Point }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Find the closest point along an edge, including the middle of a long straight or cubic span. */
export function findBrushJoin(source: CurveOutline, p: Point, radius: number): Attachment | undefined {
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
          if (d <= reach && (!best || d < best.distance)) best = { shapeIndex, ringIndex: r - 1, position: (i + t) % ring.length, distance: d, point };
          a = b;
        }
      }
    }
  }
  return best;
}

/** Both ends must join distinct places on the same contour, within one brush diameter. */
export function redrawAttachments(source: CurveOutline, stroke: Point[], scale: number, radius: number) {
  if (stroke.length < 2) return;
  const a = stroke[0], b = stroke[stroke.length - 1], span = distance(a, b);
  if (span * scale < 3) return;
  const start = findBrushJoin(source, a, radius), end = findBrushJoin(source, b, radius);
  if (!start || !end || start.shapeIndex !== end.shapeIndex ||
      start.ringIndex !== end.ringIndex || distance(start.point, end.point) * scale < 2) return;
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

/** Replace a local arc with the drawn line. All geometry outside the two joins stays on its original path. */
export function redrawEdge(source: CurveOutline, stroke: Point[], scale: number, radius: number): CurveOutline {
  const ends = redrawAttachments(source, stroke, scale, radius);
  if (!ends) throw new Error("Start and finish near two different places on the same edge.");
  const { start, end } = ends;
  const ring = curveRing(source, start)!.map(a => ({ ...a }));
  const lo = Math.min(start.position, end.position), hi = Math.max(start.position, end.position);
  let highIndex = splitAt(ring, hi);
  const edge = Math.floor(lo);
  const adjusted = edge === Math.floor(hi) ? edge + (lo - edge) / (hi - edge) : lo;
  const lowIndex = splitAt(ring, adjusted);
  if (!Number.isInteger(adjusted)) highIndex++;
  let first = start.position === lo ? lowIndex : highIndex;
  let last = start.position === lo ? highIndex : lowIndex;
  // Choose the side with the smaller area between the old edge and the stroke.
  // A long U-shaped recess can be the right side even when the opposite perimeter is shorter.
  const replacedArea = (from: number, to: number, returnPath: Point[]) => {
    const points = [ring[from].point];
    for (let i = from; i !== to; i = (i + 1) % ring.length) {
      const next = ring[(i + 1) % ring.length];
      if (ring[i].out || next.in) {
        const cubic = curveControls(ring, i);
        for (let j = 1; j < 16; j++) points.push(evaluateCurve(cubic, j / 16));
      }
      points.push(next.point);
    }
    return ringArea(points.concat(returnPath));
  };
  let work = 0;
  const budget = () => { if (++work > 2_000_000) throw new Error("Draw a shorter section of the edge."); };
  const line = [...simplifyOpen(stroke, .35 / scale, budget).points];
  if (replacedArea(first, last, [...line].reverse()) > replacedArea(last, first, line)) {
    [first, last] = [last, first]; line.reverse();
  }
  const a = ring[first], b = ring[last];
  delete a.out; delete b.in; a.smooth = false; b.smooth = false;
  if (distance(a.point, line[0]) < 1.5 / scale) line.shift();
  if (line.length && distance(b.point, line[line.length - 1]) < 1.5 / scale) line.pop();
  const retained = curveFitRange(ring.length, last, first).slice(1, -1).map(i => ring[i]);
  const replacement = [a, ...line.map(point => ({ point })), b, ...retained];
  const result = source.map((s, i) => i !== start.shapeIndex ? s : start.ringIndex < 0 ?
    { ...s, outer: replacement } : { ...s, holes: s.holes.map((hole, j) => j === start.ringIndex ? replacement : hole) });
  try {
    validateFittedContour(source, result, start, .35 / scale, budget);
  } catch (error) {
    if (error instanceof Error && /budget|complex|detailed|shorter/.test(error.message)) {
      throw new Error("This contour is too detailed for this stroke. Try a shorter section or simplify the contour.");
    }
    throw new Error("That stroke would cross or collapse a contour. Trace a shorter section and rejoin the outline.");
  }
  return result;
}
