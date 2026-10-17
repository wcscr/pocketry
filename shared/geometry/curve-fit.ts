import { curveControls, curveRing, mapCurves, sampleCurveRing, splitCurve,
  type Cubic, type CurveOutline, type CurveRing } from "./curves";
import { distanceToSegment, pointInRing, signedArea } from "./rings";
import type { Point, RingRef } from "./types";

export type CurveFitRequest = { kind: "auto" } | { kind: "range"; start: number; end: number };
export interface CurveFitResult {
  curves: CurveOutline;
  before: number;
  after: number;
  /** Conservative continuous bound against the selected, current polygon. */
  maxDeviation: number;
  changed: boolean;
}
type Span = { first: number; last: number; cubic?: Cubic; error: number };
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (p: Point, t: number): Point => ({ x: p.x * t, y: p.y * t });
const mix = (a: Point, b: Point, t: number) => add(a, mul(sub(b, a), t));
const norm = (p: Point) => Math.hypot(p.x, p.y);
const line = (a: Point, b: Point): Cubic => [a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b];

/** Inclusive, directed selection. Wrapping across the closing edge is explicit. */
export function curveFitRange(length: number, start: number, end: number): number[] {
  if (![start, end].every(i => Number.isInteger(i) && i >= 0 && i < length)) return [];
  return Array.from({ length: (end - start + length) % length + 1 }, (_, i) => (start + i) % length);
}

function corner(ring: CurveRing, i: number): boolean {
  const a = ring[(i + ring.length - 1) % ring.length].point, b = ring[i].point, c = ring[(i + 1) % ring.length].point;
  const u = sub(b, a), v = sub(c, b), length = norm(u) * norm(v);
  return ring[i].smooth === false || length < 1e-16 || (u.x * v.x + u.y * v.y) / length < Math.SQRT1_2;
}

/** Fitting is explicit and pure. It never runs as part of detection or parsing.
 * Original implementation: endpoint-constrained least squares in Bernstein form,
 * followed by a continuous control-hull error bound and recursive span splitting.
 * No external fitting code or geometry dependency is used.
 */
export function fitContour(source: CurveOutline, ref: RingRef, request: CurveFitRequest, tolerance: number): CurveFitResult {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("Enter a positive maximum deviation.");
  const ring = curveRing(source, ref);
  if (!ring || ring.length < 3) throw new Error("Choose a contour with at least three points.");
  if (ring.length > 6000) throw new Error("This contour is too detailed to fit at once. Simplify it first.");
  if (!ring.every(a => [a.point, a.in, a.out].every(p => !p || Number.isFinite(p.x) && Number.isFinite(p.y)))) {
    throw new Error("Contour coordinates must be finite.");
  }
  let work = 0;
  const budget = () => { if (++work > 1_000_000) throw new Error("Fitting is too complex at this deviation. Choose a shorter section or a larger deviation."); };

  // A cubic difference from the original linear edge is itself a cubic. Its
  // control hull bounds error at EVERY parameter, not only at detected vertices.
  const bound = (delta: Cubic, depth = 0): number => {
    budget();
    const upper = Math.max(...delta.map(norm));
    if (upper <= tolerance) return upper;
    if (norm(delta[0]) > tolerance || norm(delta[3]) > tolerance || depth === 12) return Infinity;
    const [left, right] = splitCurve(delta, 0.5);
    return Math.max(bound(left, depth + 1), bound(right, depth + 1));
  };
  const fitOpen = (indices: number[], depth = 0): Span[] => {
    budget();
    const first = indices[0], last = indices[indices.length - 1];
    if (indices.length === 2) return [{ first, last, error: 0 }];
    if (depth > 24) return indices.slice(1).map((last, i) => ({ first: indices[i], last, error: 0 }));
    const points = indices.map(i => ring[i].point), a = points[0], b = points[points.length - 1];
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + norm(sub(points[i], points[i - 1])));
    const total = lengths[lengths.length - 1];
    if (total < 1e-12) throw new Error("Remove duplicate points before fitting this section.");
    const times = lengths.map(d => d / total);
    // Solve the two-by-two normal equations for the two free control points.
    // Work relative to the first point to avoid cancellation on translated data.
    let uu = 0, uv = 0, vv = 0, ur = { x: 0, y: 0 }, vr = { x: 0, y: 0 };
    for (let i = 1; i < points.length - 1; i++) {
      budget();
      const t = times[i], s = 1 - t, u = 3 * s * s * t, v = 3 * s * t * t;
      const residual = sub(sub(points[i], a), mul(sub(b, a), t ** 3));
      uu += u * u; uv += u * v; vv += v * v;
      ur = add(ur, mul(residual, u)); vr = add(vr, mul(residual, v));
    }
    const determinant = uu * vv - uv * uv;
    let cubic: Cubic;
    if (determinant > 1e-12) {
      cubic = [a, add(a, mul(sub(mul(ur, vv), mul(vr, uv)), 1 / determinant)),
        add(a, mul(sub(mul(vr, uu), mul(ur, uv)), 1 / determinant)), b];
    } else {
      // Three points: interpolate the middle point with a quadratic, represented
      // exactly as a cubic. Degenerate parameter intervals fall back to lines.
      const t = times[1], denominator = 2 * t * (1 - t);
      if (denominator < 1e-12) return indices.slice(1).map((last, i) => ({ first: indices[i], last, error: 0 }));
      const q = add(a, mul(sub(sub(points[1], a), mul(sub(b, a), t * t)), 1 / denominator));
      cubic = [a, mix(a, q, 2 / 3), mix(b, q, 2 / 3), b];
    }
    const verify = (candidate: Cubic): { error: number; split: number } => {
      let error = 0;
      // Balanced subdivision avoids peeling off single vertices when a failed
      // cubic first exceeds the bound near an endpoint.
      const split = Math.floor(indices.length / 2);
      for (let i = 0; i < points.length - 1; i++) {
        budget();
        const end = times[i + 1];
        const prefix = splitCurve(candidate, end)[0];
        const piece = end > 0 ? splitCurve(prefix, times[i] / end)[1] : prefix;
        const original = line(points[i], points[i + 1]);
        const deviation = bound(piece.map((p, j) => sub(p, original[j])) as Cubic);
        error = Math.max(error, deviation);
        if (!Number.isFinite(error)) break;
      }
      return { error, split };
    };
    // Only collapse a straight run when it is numerically collinear: a loose
    // user tolerance must not erase a shallow, intentional curve or recess.
    if (points.every(p => distanceToSegment(p, a, b) < Math.min(tolerance * 0.001, total * 1e-9))) {
      const checked = verify(line(a, b));
      if (checked.error <= tolerance) return [{ first, last, error: checked.error }];
    }
    const checked = verify(cubic);
    if (checked.error <= tolerance) return [{ first, last, cubic, error: checked.error }];
    return [...fitOpen(indices.slice(0, checked.split + 1), depth + 1), ...fitOpen(indices.slice(checked.split), depth + 1)];
  };

  const curved = (i: number) => !!(ring[i].out || ring[(i + 1) % ring.length].in);
  const range = request.kind === "range" ? curveFitRange(ring.length, request.start, request.end) : [];
  if (request.kind === "range" && range.length < 3) throw new Error("Select at least three adjacent points.");
  if (range.slice(0, -1).some(curved)) throw new Error("This section already contains curves. Select a section of straight edges.");
  const breaks = new Set<number>();
  ring.forEach((_, i) => { if (corner(ring, i) || curved(i) || curved((i + ring.length - 1) % ring.length)) breaks.add(i); });
  if (request.kind === "auto" && breaks.size < 3) {
    [0, Math.floor(ring.length / 3), Math.floor(2 * ring.length / 3)].forEach(i => breaks.add(i));
  }
  const indices = request.kind === "range" ? range : curveFitRange(ring.length, Math.min(...breaks), (Math.min(...breaks) + ring.length - 1) % ring.length);
  if (request.kind === "auto") indices.push(indices[0]);
  const spans: Span[] = [];
  let start = 0;
  for (let j = 1; j < indices.length; j++) {
    if (j !== indices.length - 1 && !breaks.has(indices[j])) continue;
    const section = indices.slice(start, j + 1);
    if (section.length === 2 && curved(section[0])) spans.push({ first: section[0], last: section[1], cubic: curveControls(ring, section[0]), error: 0 });
    else spans.push(...fitOpen(section));
    start = j;
  }
  const result = mapCurves(source, p => ({ ...p }));
  const copy = curveRing(result, ref)!;
  const fitted: CurveRing = [{ ...copy[spans[0].first] }];
  for (const span of spans) {
    const previous = fitted[fitted.length - 1], next = { ...copy[span.last] };
    delete previous.out; delete next.in;
    if (span.cubic) { previous.out = { ...span.cubic[1] }; next.in = { ...span.cubic[2] }; }
    fitted.push(next);
  }
  if (request.kind === "auto") {
    fitted[0].in = fitted.pop()!.in;
  } else {
    // Preserve the complement and both outward-facing endpoint handles exactly.
    for (let i = (range[range.length - 1] + 1) % ring.length; i !== range[0]; i = (i + 1) % ring.length) fitted.push(copy[i]);
  }
  // The contour representation requires three anchors, even for a two-arc loop.
  if (fitted.length < 3) {
    const [left, right] = splitCurve(curveControls(fitted, 0), 0.5);
    const isCurve = !!(fitted[0].out || fitted[1].in);
    if (isCurve) { fitted[0].out = left[1]; fitted[1].in = right[2]; }
    fitted.splice(1, 0, { point: left[3], ...(isCurve ? { in: left[2], out: right[1], smooth: true } : {}) });
  }
  // Preserve ring indexing whenever point zero survives, including wrapped fits.
  const zero = fitted.findIndex(a => a.point.x === ring[0].point.x && a.point.y === ring[0].point.y);
  const ordered = zero > 0 ? [...fitted.slice(zero), ...fitted.slice(0, zero)] : fitted;
  // Existing smooth flags cannot promise aligned handles after replacing a span.
  for (const a of ordered) if (a.smooth && a.in && a.out) {
    const u = sub(a.in, a.point), v = sub(a.out, a.point);
    if (u.x * v.x + u.y * v.y > -0.999999 * norm(u) * norm(v)) a.smooth = false;
  }
  if (ref.ringIndex === -1) result[ref.shapeIndex].outer = ordered;
  else result[ref.shapeIndex].holes[ref.ringIndex] = ordered;
  // Ignore absent vs undefined handles; repeating an already-fitted contour is
  // a no-op and must not create another shape revision/history entry.
  const samePoint = (a: Point | undefined, b: Point | undefined) => a === b || !!a && !!b && a.x === b.x && a.y === b.y;
  const changed = ring.length !== ordered.length || ring.some((a, i) => {
    const b = ordered[i];
    return !b || !samePoint(a.point, b.point) || !samePoint(a.in, b.in) || !samePoint(a.out, b.out) || a.smooth !== b.smooth;
  });
  if (changed) validateFittedContour(source, result, ref, tolerance, budget);
  return { curves: changed ? result : source, before: ring.length, after: ordered.length,
    maxDeviation: Math.max(0, ...spans.map(s => s.error)), changed };
}

/** Topology guard on fine adaptive samples. Fitting's deviation bound above is
 * continuous; intersection/containment checks use these polygon approximations.
 */
function validateFittedContour(before: CurveOutline, after: CurveOutline, ref: RingRef, tolerance: number, budget: () => void): void {
  const flat = (outline: CurveOutline) => outline.flatMap((s, shapeIndex) => [
    { ring: s.outer, shapeIndex, ringIndex: -1 }, ...s.holes.map((ring, ringIndex) => ({ ring, shapeIndex, ringIndex }))]);
  const sources = flat(before), target = sources.findIndex(r => r.shapeIndex === ref.shapeIndex && r.ringIndex === ref.ringIndex);
  const precision = Math.min(tolerance / 16, 0.01);
  const originals = sources.map(r => sampleCurveRing(r.ring, precision));
  const candidate = sampleCurveRing(curveRing(after, ref)!, precision);
  if (candidate.length + originals.reduce((n, r) => n + r.length, 0) > 16_000) {
    throw new Error("This contour is too detailed to validate. Choose a shorter section or simplify it first.");
  }
  if (Math.abs(signedArea(candidate)) < 1e-12 || Math.sign(signedArea(candidate)) !== Math.sign(signedArea(originals[target]))) {
    throw new Error("The fit would collapse or reverse the contour. Try a smaller deviation.");
  }
  const rings = originals.map((r, i) => i === target ? candidate : r);
  const edges = rings.flatMap((r, ring) => r.map((a, i) => {
    const b = r[(i + 1) % r.length];
    return { a, b, ring, i, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  })).sort((a, b) => a.minX - b.minX);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length && edges[j].minX <= edges[i].maxX + 1e-9; j++) {
    budget();
    const a = edges[i], b = edges[j];
    if (a.ring !== target && b.ring !== target || a.maxY < b.minY || b.maxY < a.minY) continue;
    if (a.ring === b.ring && (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === rings[a.ring].length - 1)) continue;
    const crossing = cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) < 0 && cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) < 0;
    if (crossing || [distanceToSegment(a.a, b.a, b.b), distanceToSegment(a.b, b.a, b.b), distanceToSegment(b.a, a.a, a.b), distanceToSegment(b.b, a.a, a.b)].some(d => d < 1e-9)) {
      throw new Error("The fit would cross or touch another contour edge. Try a smaller deviation.");
    }
  }
  for (let i = 0; i < rings.length; i++) if (i !== target) {
    if (pointInRing(originals[target], originals[i][0]) !== pointInRing(candidate, originals[i][0])
      || pointInRing(originals[i], originals[target][0]) !== pointInRing(originals[i], candidate[0])) {
      throw new Error("The fit would change a hole or another contour. Try a smaller deviation.");
    }
  }
}
