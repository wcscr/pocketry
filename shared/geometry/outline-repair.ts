import { curveControls, curveRing, curvesFromOutline, evaluateCurve, mapCurves, sampleCurveRing, type Cubic, type CurveOutline, type CurveRing } from "./curves";
import { curveFitRange, validateFittedContour } from "./curve-fit";
import type { Point, RingRef } from "./types";

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const length = (p: Point) => Math.hypot(p.x, p.y);
const unit = (p: Point): Point => { const n = length(p); return { x: p.x / n, y: p.y / n }; };

/** Endpoint tangent from visible context, independent of raster orientation.
 * A local quadratic regression removes the secant bias on curved edges. The
 * residual guard rejects corners, noisy evidence and backwards-running spans.
 */
export function visibleTangent(points: Point[], resolution: number): Point | undefined {
  if (points.length < 4) return;
  const origin = points[0], delta = sub(points.at(-1)!, origin), span = length(delta);
  if (span < resolution * 4) return;
  const axis = unit(delta), normal = { x: -axis.y, y: axis.x };
  let aa = 0, ab = 0, bb = 0, av = 0, bv = 0;
  const samples = points.map(p => { const d = sub(p, origin); return { u: dot(d, axis) / span, v: dot(d, normal) / span }; });
  if (samples.some(p => p.u < -resolution / span)) return;
  for (const { u, v } of samples) { aa += u * u; ab += u ** 3; bb += u ** 4; av += u * v; bv += u * u * v; }
  const determinant = aa * bb - ab * ab;
  if (determinant < 1e-10) return;
  const slope = (av * bb - bv * ab) / determinant, bend = (bv * aa - av * ab) / determinant;
  const error = Math.sqrt(samples.reduce((sum, p) => sum + (p.v - slope * p.u - bend * p.u * p.u) ** 2, 0) / samples.length) * span;
  if (error > Math.max(resolution, span * .035) || Math.abs(slope) > 1) return;
  return unit(add(axis, normal, slope));
}

/** Short, monotone continuation supported by BOTH visible endpoint tangents.
 * A quadratic (represented as a cubic) follows the tangent intersection. It
 * must turn consistently, stay in the forward half-plane and avoid large arcs.
 * Undefined means insufficient evidence, never permission to invent a shape.
 */
export function continueBoundary(a: Point, b: Point, incoming: Point, outgoing: Point): Cubic | undefined {
  if (![a, b, incoming, outgoing].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) || length(incoming) < 1e-12 || length(outgoing) < 1e-12) return;
  const d = sub(b, a), span = length(d); if (span < 1e-9) return;
  const chord = unit(d), u = unit(incoming), v = unit(outgoing);
  if (dot(u, chord) < .65 || dot(v, chord) < .65 || dot(u, v) < .2) return;
  const su = cross(u, chord), sv = cross(chord, v);
  if (Math.abs(su) < .075 && Math.abs(sv) < .075) return [a, add(a, d, 1 / 3), add(a, d, 2 / 3), b];
  if (su * sv <= 0) return;
  const determinant = cross(u, v); if (Math.abs(determinant) < .05) return;
  const first = cross(d, v) / determinant, last = cross(u, d) / determinant;
  if (Math.min(first, last) < span * .15 || Math.max(first, last) > span * 1.5) return;
  return [a, add(a, u, first * 2 / 3), add(b, v, -last * 2 / 3), b];
}

/** Visible context on the unselected side of an endpoint. */
export function sectionTangent(ring: CurveRing, index: number, direction: -1 | 1, excluded: Set<number>, reach: number, resolution: number): Point | undefined {
  const points = [ring[index].point]; let travel = 0;
  for (let step = 0; step < ring.length - 1 && travel < reach; step++) {
    const edge = (index + (direction === 1 ? step : -step - 1) + ring.length) % ring.length;
    const next = (index + direction * (step + 1) + ring.length) % ring.length;
    if (excluded.has(next)) break;
    const controls = curveControls(ring, edge);
    const count = ring[edge].out || ring[(edge + 1) % ring.length].in ? 12 : 1;
    for (let j = 1; j <= count && travel < reach; j++) {
      const p = evaluateCurve(controls, direction === 1 ? j / count : 1 - j / count);
      const previous = points.at(-1)!, distance = length(sub(p, previous));
      if (distance < 1e-12) continue;
      const used = Math.min(distance, reach - travel);
      points.push(add(previous, sub(p, previous), used / distance)); travel += used;
    }
  }
  // Sparse manual contours still supply a direction; automatic raster repair
  // calls visibleTangent directly and requires stronger photographic support.
  const tangent = visibleTangent(points, resolution) ?? (points.length >= 2 ? unit(sub(points.at(-1)!, points[0])) : undefined);
  return tangent && (direction === -1 ? { x: -tangent.x, y: -tangent.y } : tangent);
}

export interface SectionRepairOptions { mode: "line" | "curve"; bend?: number; editableCurves: boolean; tolerance: number }
export interface SectionRepairResult { curves: CurveOutline; bend: number; changed: boolean }

export function sampleBoundaryBridge(cubic: Cubic, tolerance: number): Point[] {
  // Only the first edge is curved; drop the synthetic third (closing) anchor.
  return sampleCurveRing([{ point: cubic[0], out: cubic[1] }, { point: cubic[3], in: cubic[2] },
    { point: add(cubic[0], sub(cubic[3], cubic[0]), .5) }], tolerance).slice(0, -1);
}

/** Deliberate replacement, not fitting: no deviation claim against the faulty
 * selected section. Endpoints, outside handles, holes and other shapes survive.
 */
export function repairCurveSection(source: CurveOutline, ref: RingRef, start: number, end: number, options: SectionRepairOptions): SectionRepairResult {
  const ring = curveRing(source, ref), { tolerance, mode } = options;
  if (!ring || ring.length > 6000 || !Number.isFinite(tolerance) || tolerance <= 0) throw new Error("Choose a smaller section on a valid outline.");
  const indices = curveFitRange(ring.length, start, end);
  if (indices.length < 2 || ring.length - indices.length < 1) throw new Error("Keep at least one outline point outside the repaired section.");
  const a = ring[start].point, b = ring[end].point, d = sub(b, a), span = length(d);
  if (!Number.isFinite(span) || span < 1e-9) throw new Error("Choose two different endpoints.");
  const normal = { x: -d.y / span, y: d.x / span };
  const excluded = new Set(indices.slice(1, -1));
  const incoming = sectionTangent(ring, start, -1, excluded, span * .6, tolerance);
  const outgoing = sectionTangent(ring, end, 1, excluded, span * .6, tolerance);
  let cubic = incoming && outgoing ? continueBoundary(a, b, incoming, outgoing) : undefined;
  let bend = cubic ? dot(sub(evaluateCurve(cubic, .5), add(a, d, .5)), normal) : span * .1;
  if (options.bend !== undefined && mode === "curve") bend = options.bend;
  if (mode === "line") bend = 0;
  if (!Number.isFinite(bend) || Math.abs(bend) > span) throw new Error("Keep the curve bend within the distance between the endpoints.");
  if (!cubic || options.bend !== undefined) cubic = [a, add(add(a, d, 1 / 3), normal, bend * 4 / 3), add(add(a, d, 2 / 3), normal, bend * 4 / 3), b];
  const result = mapCurves(source, p => ({ ...p }));
  const first = { ...curveRing(result, ref)![start] }, last = { ...curveRing(result, ref)![end] };
  delete first.out; delete last.in; first.smooth = false; last.smooth = false;
  let replacement: CurveRing = [first, last];
  if (mode === "curve") {
    first.out = cubic[1]; last.in = cubic[2];
    if (!options.editableCurves) {
      const sampled = sampleBoundaryBridge(cubic, tolerance);
      replacement = [...curvesFromOutline([{ outer: sampled, holes: [] }])[0].outer.slice(0, -1), last];
      replacement[0] = { ...first }; delete replacement[0].out;
    }
  }
  const remaining = Array.from({ length: ring.length - indices.length }, (_, i) => curveRing(result, ref)![(end + 1 + i) % ring.length]);
  const repaired = [...replacement, ...remaining];
  if (ref.ringIndex === -1) result[ref.shapeIndex].outer = repaired; else result[ref.shapeIndex].holes[ref.ringIndex] = repaired;
  let work = 0;
  validateFittedContour(source, result, ref, tolerance, () => { if (++work > 2_000_000) throw new Error("Choose a shorter section to repair."); });
  return { curves: result, bend: mode === "curve" ? bend : 0, changed: JSON.stringify(source) !== JSON.stringify(result) };
}
