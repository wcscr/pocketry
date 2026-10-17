import { signedArea } from "./rings";
import type { Outline, Point, RingRef } from "./types";

/** Handles are absolute coordinates in the same frame as their anchor. */
export interface CurveAnchor {
  point: Point;
  in?: Point;
  out?: Point;
  smooth?: boolean;
}
export type CurveRing = CurveAnchor[];
export type CurveOutline = { outer: CurveRing; holes: CurveRing[] }[];
export const CURVE_TOLERANCE_MM = 0.025;
const MAX_SAMPLES = 100_000;
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Point, b: Point, t: number): Point => add(mul(a, 1 - t), mul(b, t));
const magnitude = (a: Point) => Math.hypot(a.x, a.y);
export type Cubic = [Point, Point, Point, Point];

export function curveRing(outline: CurveOutline, ref: RingRef): CurveRing | undefined {
  return ref.ringIndex === -1 ? outline[ref.shapeIndex]?.outer : outline[ref.shapeIndex]?.holes[ref.ringIndex];
}

export function curvesFromOutline(outline: Outline): CurveOutline {
  const ring = (points: Point[]) => points.map(point => ({ point: { ...point } }));
  return outline.map(shape => ({ outer: ring(shape.outer), holes: shape.holes.map(ring) }));
}

/** Copies the whole source so a gesture can never mutate history or library data. */
export function mapCurves(outline: CurveOutline, transform: (p: Point) => Point): CurveOutline {
  const ring = (anchors: CurveRing) => anchors.map(a => ({ ...a, point: transform(a.point),
    ...(a.in ? { in: transform(a.in) } : {}), ...(a.out ? { out: transform(a.out) } : {}) }));
  return outline.map(shape => ({ outer: ring(shape.outer), holes: shape.holes.map(ring) }));
}

export function curveControls(ring: CurveRing, i: number): Cubic {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  return [a.point, a.out ?? lerp(a.point, b.point, 1 / 3), b.in ?? lerp(a.point, b.point, 2 / 3), b.point];
}

export function evaluateCurve(c: Cubic, t: number): Point {
  const s = 1 - t;
  return add(add(mul(c[0], s ** 3), mul(c[1], 3 * s * s * t)), add(mul(c[2], 3 * s * t * t), mul(c[3], t ** 3)));
}

export function splitCurve(c: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(c[0], c[1], t), b = lerp(c[1], c[2], t), d = lerp(c[2], c[3], t);
  const e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t);
  return [[c[0], a, e, g], [g, f, d, c[3]]];
}

function chordDistance(p: Point, a: Point, b: Point): number {
  const v = sub(b, a), length2 = v.x * v.x + v.y * v.y;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / length2)) : 0;
  return magnitude(sub(p, lerp(a, b, t)));
}

/** The control hull bounds distance to each finite chord, including loops.
 * Budget exhaustion fails explicitly rather than silently violating tolerance. */
export function sampleCurveRing(ring: CurveRing, tolerance: number): Point[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("Curve tolerance must be positive.");
  if (ring.length < 3) throw new Error("A closed contour needs at least three anchors.");
  const points: Point[] = [{ ...ring[0].point }];
  const append = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("Curve coordinates must be finite.");
    if (points.length >= MAX_SAMPLES) throw new Error("Curve exceeds the geometry budget.");
    points.push({ ...p });
  };
  const flatten = (c: Cubic, depth = 0): void => {
    if (!c.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error("Curve coordinates must be finite.");
    if (Math.max(chordDistance(c[1], c[0], c[3]), chordDistance(c[2], c[0], c[3])) <= tolerance) { append(c[3]); return; }
    if (depth >= 24) throw new Error("Curve cannot be sampled at this tolerance.");
    const [left, right] = splitCurve(c, 0.5); flatten(left, depth + 1); flatten(right, depth + 1);
  };
  ring.forEach((a, i) => a.out || ring[(i + 1) % ring.length].in ? flatten(curveControls(ring, i)) : append(ring[(i + 1) % ring.length].point));
  points.pop();
  return points;
}

export function sampleCurves(curves: CurveOutline, tolerance = CURVE_TOLERANCE_MM): Outline {
  return curves.map(shape => ({ outer: sampleCurveRing(shape.outer, tolerance), holes: shape.holes.map(ring => sampleCurveRing(ring, tolerance)) }));
}

/** Reversing a ring also swaps its incoming/outgoing handles. */
export function reverseCurveRing(ring: CurveRing): CurveRing {
  return ring.slice().reverse().map(({ in: incoming, out, ...a }) => ({ ...a,
    ...(out ? { in: out } : {}), ...(incoming ? { out: incoming } : {}) }));
}

export function normalizeCurves(curves: CurveOutline, tolerance = CURVE_TOLERANCE_MM): CurveOutline {
  const orient = (ring: CurveRing, positive: boolean) => (signedArea(sampleCurveRing(ring, tolerance)) > 0) === positive ? ring : reverseCurveRing(ring);
  return curves.map(s => ({ outer: orient(s.outer, true), holes: s.holes.map(r => orient(r, false)) }));
}

export function curvePath(ring: CurveRing, transform: (p: Point) => Point = p => p): string {
  const xy = (p: Point) => { const q = transform(p); return `${q.x},${q.y}`; };
  return `M${xy(ring[0].point)} ` + ring.map((a, i) => {
    const c = curveControls(ring, i);
    return a.out || ring[(i + 1) % ring.length].in ? `C${xy(c[1])} ${xy(c[2])} ${xy(c[3])}` : `L${xy(c[3])}`;
  }).join(" ") + " Z";
}

export type CurveEdit =
  | { kind: "move"; index: number; point: Point }
  | { kind: "handle"; index: number; side: "in" | "out"; point: Point }
  | { kind: "bend"; index: number; t: number; delta: Point }
  | { kind: "split"; index: number; t: number }
  | { kind: "straight" | "curve" | "smooth" | "corner" | "delete"; index: number };

/** Pure manual edits used identically by Trace and Bin. */
export function editCurves(source: CurveOutline, ref: RingRef, edit: CurveEdit): CurveOutline {
  const result = mapCurves(source, p => ({ ...p })), ring = curveRing(result, ref);
  if (!ring || !ring[edit.index]) return source;
  const i = edit.index, next = (i + 1) % ring.length, prev = (i + ring.length - 1) % ring.length;
  const a = ring[i], b = ring[next];
  const ensureCurve = (j: number) => { const c = curveControls(ring, j); ring[j].out = c[1]; ring[(j + 1) % ring.length].in = c[2]; };
  const align = (j: number, side: "in" | "out") => {
    const n = ring[j], other = side === "in" ? "out" : "in";
    if (!n.smooth || !n[side] || !n[other]) return;
    const v = sub(n[side]!, n.point), d = magnitude(v);
    if (d > 1e-12) n[other] = add(n.point, mul(v, -magnitude(sub(n[other]!, n.point)) / d));
  };
  switch (edit.kind) {
    case "move": { const delta = sub(edit.point, a.point); a.point = edit.point; if (a.in) a.in = add(a.in, delta); if (a.out) a.out = add(a.out, delta); break; }
    case "handle": a[edit.side] = edit.point; align(i, edit.side); break;
    case "curve": ensureCurve(i); break;
    case "straight": delete a.out; delete b.in; a.smooth = false; b.smooth = false; break;
    case "corner": a.smooth = false; break;
    case "smooth": {
      ensureCurve(prev); ensureCurve(i); a.smooth = true;
      const v = sub(a.out!, a.in!), d = magnitude(v);
      if (d > 1e-12) { a.out = add(a.point, mul(v, magnitude(sub(a.out!, a.point)) / d)); align(i, "out"); }
      break;
    }
    case "delete": if (ring.length <= 3) return source; ring[prev].smooth = false; b.smooth = false; ring.splice(i, 1); break;
    case "split": {
      const [left, right] = splitCurve(curveControls(ring, i), Math.max(0.001, Math.min(0.999, edit.t)));
      const curved = !!(a.out || b.in);
      if (curved) { a.out = left[1]; b.in = right[2]; }
      ring.splice(i + 1, 0, { point: left[3], ...(curved ? { in: left[2], out: right[1], smooth: true } : {}) });
      break;
    }
    case "bend": {
      ensureCurve(i); const t = Math.max(0.08, Math.min(0.92, edit.t)), u = 3 * (1 - t) ** 2 * t, v = 3 * (1 - t) * t * t, denominator = u * u + v * v;
      a.out = add(a.out!, mul(edit.delta, u / denominator)); b.in = add(b.in!, mul(edit.delta, v / denominator)); align(i, "out"); align(next, "in"); break;
    }
  }
  return result;
}
