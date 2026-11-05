import { curveControls, curveRing, curvesFromOutline, evaluateCurve, mapCurves, splitCurve,
  type Cubic, type CurveOutline, type CurveRing } from "./curves";
import { validateFittedContour, type CurveFitResult } from "./curve-fit";
import { distanceToSegment } from "./rings";
import type { Outline, Point, Ring, RingRef } from "./types";

export interface ReconstructionResult extends CurveFitResult {
  lines: number;
  cubics: number;
  corners: number;
  smoothJoins: number;
}
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (p: Point, n: number): Point => ({ x: p.x * n, y: p.y * n });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const length = (p: Point) => Math.hypot(p.x, p.y);
const unit = (p: Point): Point => { const d = length(p); return d > 1e-12 ? mul(p, 1 / d) : { x: 1, y: 0 }; };
const lerp = (a: Point, b: Point, t: number) => add(a, mul(sub(b, a), t));
const angle = (a: Point, b: Point) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
interface Span { first: number; last: number; cubic?: Cubic; error: number; indices?: number[]; times?: number[] }

/** A displayed simplification can reorder similar-sized components. Match the
 * selected contour to its dense source by bounds, rather than trusting index. */
export function reconstructionSourceRing(dense: Outline, displayed: CurveOutline, ref: RingRef): Ring {
  const target = curveRing(displayed, ref);
  if (!target) throw new Error("Choose a detected contour.");
  const bounds = (ring: Ring) => ({ x: Math.min(...ring.map(p => p.x)), y: Math.min(...ring.map(p => p.y)),
    right: Math.max(...ring.map(p => p.x)), bottom: Math.max(...ring.map(p => p.y)) });
  const t = bounds(target.map(a => a.point));
  const candidates = ref.ringIndex === -1 ? dense.map(s => s.outer) : dense.flatMap(s => s.holes);
  const scored = candidates.map(ring => { const b = bounds(ring); return { ring,
    distance: Math.hypot(t.x - b.x, t.y - b.y, t.right - b.right, t.bottom - b.bottom) }; }).sort((a, b) => a.distance - b.distance);
  if (!scored.length || scored[1] && Math.abs(scored[0].distance - scored[1].distance) < 1e-9) {
    throw new Error("The dense source is ambiguous. Re-detect this tool in its own region.");
  }
  return scored[0].ring;
}

/** Explicit default, in local units. Never silently increase a chosen bound.
 * Use 0.1 mm when calibrated (1 px otherwise), or the dense contour's typical
 * sampling step when coarser. The actual allowance remains visible/editable. */
export function recommendedReconstructionTolerance(ring: Ring, unitsPerUnit = 1, unitName: "mm" | "px" = "px"): number {
  if (!(unitsPerUnit > 0) || !Number.isFinite(unitsPerUnit)) throw new Error("Invalid reconstruction scale.");
  const steps = ring.map((p, i) => length(sub(p, ring[(i + 1) % ring.length]))).filter(d => d > 1e-9).sort((a, b) => a - b);
  return Math.max((unitName === "mm" ? 0.1 : 1) / unitsPerUnit, steps[Math.floor(steps.length * 0.75)] ?? 0);
}

/** Atomic preview of all original detected contours. A failure leaves the
 * caller's entire source untouched, including previously processed rings. */
export function reconstructDetectedOutline(source: CurveOutline, dense: Outline, tolerance: number): ReconstructionResult {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("Enter a positive maximum deviation.");
  if (source.length > 128 || dense.reduce((n, s) => n + s.outer.length + s.holes.reduce((n, r) => n + r.length, 0), 0) > 24_000) {
    throw new Error("This detected outline is too complex to reconstruct at once. Select a smaller region.");
  }
  let curves = source, before = 0, maxDeviation = 0, lines = 0, cubics = 0, corners = 0, smoothJoins = 0;
  for (let shapeIndex = 0; shapeIndex < source.length; shapeIndex++) {
    for (const ringIndex of [-1, ...source[shapeIndex].holes.map((_, i) => i)]) {
      const ref = { shapeIndex, ringIndex };
      const ring = reconstructionSourceRing(dense, source, ref);
      const result = reconstructContour(curves, ref, ring, tolerance);
      curves = result.curves; before += result.before; maxDeviation = Math.max(maxDeviation, result.maxDeviation);
      lines += result.lines; cubics += result.cubics; corners += result.corners; smoothJoins += result.smoothJoins;
    }
  }
  return { curves, before, after: curves.reduce((n, s) => n + s.outer.length + s.holes.reduce((n, r) => n + r.length, 0), 0),
    maxDeviation, lines, cubics, corners, smoothJoins, changed: JSON.stringify(curves) !== JSON.stringify(source) };
}

/** Original, dependency-free reconstruction of a dense ring into lines/cubics.
 * Endpoints remain on the source. Lines have a finite-chord distance bound;
 * cubics are verified continuously against every source edge, not just vertices.
 * Corner support is measured in arc length, independently of pixel orientation.
 * This is an explicit replacement preview, never a load/detection side effect.
 */
export function reconstructContour(source: CurveOutline, ref: RingRef, dense: Ring, tolerance: number): ReconstructionResult {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("Enter a positive maximum deviation.");
  const original = curveRing(source, ref);
  if (!original || dense.length < 3) throw new Error("Choose a detected contour with at least three samples.");
  if (original.some(a => a.in || a.out || a.smooth !== undefined)) throw new Error("Reconstruction needs the original detected contour. Undo curve edits first.");
  if (dense.length > 12_000 || !dense.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    throw new Error("This detected contour is too complex or contains invalid coordinates.");
  }
  let work = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("Reconstruction is too complex at this deviation. Try a larger deviation or a smaller region."); };
  const n = dense.length, distances = [0];
  for (let i = 1; i <= n; i++) distances.push(distances[i - 1] + length(sub(dense[i % n], dense[i - 1])));
  const perimeter = distances[n];
  if (perimeter < 1e-9) throw new Error("The detected contour has no length.");
  const steps = distances.slice(1).map((d, i) => d - distances[i]).filter(d => d > 1e-9).sort((a, b) => a - b);
  const support = Math.min(perimeter / 16, Math.max(tolerance * 6, steps[Math.floor(steps.length / 2)] * 6));
  const at = (distance: number): Point => {
    const d = ((distance % perimeter) + perimeter) % perimeter;
    let lo = 0, hi = n;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (distances[mid] <= d) lo = mid; else hi = mid; }
    const edge = distances[lo + 1] - distances[lo];
    return lerp(dense[lo], dense[(lo + 1) % n], edge ? (d - distances[lo]) / edge : 0);
  };
  const turns = dense.map((p, i) => {
    const s = distances[i];
    const near = angle(sub(p, at(s - support)), sub(at(s + support), p));
    const far = angle(sub(p, at(s - support * 2)), sub(at(s + support * 2), p));
    return near >= Math.PI * 35 / 180 && far >= near * 0.7 && far <= near * 1.5 ? near : 0;
  });
  const corners = new Set<number>();
  for (const index of Array.from({ length: n }, (_, i) => i).filter(i => turns[i] > 0).sort((a, b) => turns[b] - turns[a] || a - b)) {
    budget();
    if (![...corners].some(j => { budget(); return Math.min(Math.abs(distances[j] - distances[index]), perimeter - Math.abs(distances[j] - distances[index])) < support; })) corners.add(index);
  }
  const breaks = [...corners].sort((a, b) => a - b);
  if (!breaks.length) breaks.push(0);
  while (breaks.length < 4) {
    let best = 0, gap = -1;
    for (let i = 0; i < breaks.length; i++) {
      const d = (distances[breaks[(i + 1) % breaks.length]] - distances[breaks[i]] + perimeter) % perimeter || perimeter;
      if (d > gap) { gap = d; best = i; }
    }
    const target = (distances[breaks[best]] + gap / 2) % perimeter;
    let next = 0; for (let i = 1; i < n; i++) if (Math.abs(distances[i] - target) < Math.abs(distances[next] - target)) next = i;
    if (breaks.includes(next)) break;
    breaks.push(next); breaks.sort((a, b) => a - b);
  }
  const tangent = (i: number, side: "in" | "out") => {
    const s = distances[i], p = dense[i];
    return corners.has(i) ? unit(side === "out" ? sub(at(s + support), p) : sub(p, at(s - support)))
      : unit(sub(at(s + support), at(s - support)));
  };
  const bound = (delta: Cubic, depth = 0): number => {
    budget();
    const upper = Math.max(...delta.map(length));
    if (upper <= tolerance) return upper;
    if (length(delta[0]) > tolerance || length(delta[3]) > tolerance || depth >= 12) return Infinity;
    const [a, b] = splitCurve(delta, 0.5);
    return Math.max(bound(a, depth + 1), bound(b, depth + 1));
  };
  const spans: Span[] = [];
  const tangentOverrides = new Map<number, Point>();
  const fit = (indices: number[], depth = 0, constrained = false): void => {
    budget();
    const first = indices[0], last = indices[indices.length - 1], points = indices.map(i => dense[i]);
    const a = points[0], b = points[points.length - 1], chord = sub(b, a), chordLength = length(chord);
    if (indices.length === 2) { spans.push({ first, last, error: 0 }); return; }
    const u = tangentOverrides.get(first) ?? tangent(first, "out"), v = tangentOverrides.get(last) ?? tangent(last, "in");
    const lineError = Math.max(...points.map(p => distanceToSegment(p, a, b)));
    let furthest = 0, reversal = 0;
    if (chordLength > 1e-9) for (const p of points) {
      const t = dot(sub(p, a), chord) / chordLength;
      reversal = Math.max(reversal, furthest - t); furthest = Math.max(furthest, t);
    }
    // Projection is continuous over each source edge and covers the entire
    // finite chord, supplying a two-way geometric distance bound. Large
    // backtracking is rejected so a thin bay cannot collapse to a line.
    if (!constrained && lineError <= tolerance && reversal <= tolerance && angle(u, v) <= Math.PI / 15 &&
        angle(chord, u) <= Math.PI / 15 && angle(chord, v) <= Math.PI / 15) {
      spans.push({ first, last, error: lineError }); return;
    }
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + length(sub(points[i], points[i - 1])));
    const total = lengths[lengths.length - 1];
    let times = lengths.map(d => total ? d / total : 0);
    let cubic: Cubic = [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
    for (let pass = 0; pass < 4; pass++) {
      let aa = 0, ab = 0, bb = 0, ar = { x: 0, y: 0 }, br = { x: 0, y: 0 };
      for (let i = 1; i < points.length - 1; i++) {
        budget();
        const t = times[i], s = 1 - t, b1 = 3 * s * s * t, b2 = 3 * s * t * t;
        const residual = sub(sub(points[i], a), mul(sub(b, a), t ** 3));
        aa += b1 * b1; ab += b1 * b2; bb += b2 * b2;
        ar = add(ar, mul(residual, b1)); br = add(br, mul(residual, b2));
      }
      const determinant = aa * bb - ab * ab;
      cubic = determinant > 1e-12 ? [a, add(a, mul(sub(mul(ar, bb), mul(br, ab)), 1 / determinant)),
        add(a, mul(sub(mul(br, aa), mul(ar, ab)), 1 / determinant)), b]
        : [a, add(a, mul(u, total / 3)), sub(b, mul(v, total / 3)), b];
      if (constrained) {
        let aa = 0, ab = 0, bb = 0, ar = 0, br = 0;
        for (let i = 1; i < points.length - 1; i++) {
          budget();
          const t = times[i], s = 1 - t, b1 = 3 * s * s * t, b2 = 3 * s * t * t;
          const x = mul(u, b1), y = mul(v, -b2), residual = sub(points[i], lerp(a, b, b2 + t ** 3));
          aa += dot(x, x); ab += dot(x, y); bb += dot(y, y); ar += dot(x, residual); br += dot(y, residual);
        }
        const determinant = aa * bb - ab * ab;
        let alpha = determinant > 1e-12 ? (ar * bb - br * ab) / determinant : total / 3;
        let beta = determinant > 1e-12 ? (br * aa - ar * ab) / determinant : total / 3;
        if (!(alpha > 0 && beta > 0 && alpha < total * 2 && beta < total * 2)) alpha = beta = total / 3;
        cubic = [a, add(a, mul(u, alpha)), sub(b, mul(v, beta)), b];
      }
      if (pass === 3) break;
      const adjusted = [0];
      for (let i = 1; i < points.length - 1; i++) {
        let t = times[i];
        for (let step = 0; step < 3; step++) {
          const p = evaluateCurve(cubic, t), s = 1 - t;
          const derivative = add(add(mul(sub(cubic[1], a), 3 * s * s), mul(sub(cubic[2], cubic[1]), 6 * s * t)), mul(sub(b, cubic[2]), 3 * t * t));
          const second = add(mul(add(sub(cubic[2], mul(cubic[1], 2)), a), 6 * s), mul(add(sub(b, mul(cubic[2], 2)), cubic[1]), 6 * t));
          const residual = sub(p, points[i]), denominator = dot(derivative, derivative) + dot(residual, second);
          if (Math.abs(denominator) > 1e-12) t -= dot(residual, derivative) / denominator;
          t = Math.max(times[i - 1], Math.min(times[i + 1], t));
        }
        adjusted.push(Math.max(adjusted[i - 1], Math.min(1, t)));
      }
      times = [...adjusted, 1];
    }
    let error = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const end = times[i + 1], prefix = splitCurve(cubic, end)[0];
      const piece = end > 0 ? splitCurve(prefix, times[i] / end)[1] : prefix;
      const line: Cubic = [points[i], lerp(points[i], points[i + 1], 1 / 3), lerp(points[i], points[i + 1], 2 / 3), points[i + 1]];
      error = Math.max(error, bound(piece.map((p, j) => sub(p, line[j])) as Cubic));
      if (!Number.isFinite(error)) break;
    }
    if (error <= tolerance) { spans.push({ first, last, cubic, error, indices, times }); return; }
    if (depth >= 24) { indices.slice(1).forEach((last, i) => spans.push({ first: indices[i], last, error: 0 })); return; }
    const mid = Math.floor(indices.length / 2);
    fit(indices.slice(0, mid + 1), depth + 1, constrained); fit(indices.slice(mid), depth + 1, constrained);
  };
  for (let i = 0; i < breaks.length; i++) {
    const first = breaks[i], last = breaks[(i + 1) % breaks.length], indices = [first];
    for (let j = (first + 1) % n; j !== last; j = (j + 1) % n) indices.push(j);
    indices.push(last); fit(indices);
  }
  // First identify supported lines. Then use those line directions and shared
  // neighbourhood tangents to refit curved spans. Splitting a curve preserves
  // the same tangent at the new shared anchor; it never changes the allowance.
  const provisional = spans.slice();
  for (let i = 0; i < provisional.length; i++) {
    const span = provisional[i]; if (span.cubic) continue;
    const direction = unit(sub(dense[span.last], dense[span.first]));
    if (!corners.has(span.first) && provisional[(i + provisional.length - 1) % provisional.length].cubic) tangentOverrides.set(span.first, direction);
    if (!corners.has(span.last) && provisional[(i + 1) % provisional.length].cubic) tangentOverrides.set(span.last, direction);
  }
  spans.length = 0;
  for (const span of provisional) {
    if (!span.cubic) spans.push(span);
    else fit(span.indices!, 0, true);
  }
  const verifyAdjusted = (span: Span, cubic: Cubic): number => {
    let error = 0;
    const indices = span.indices!, times = span.times!;
    for (let i = 0; i < indices.length - 1; i++) {
      const end = times[i + 1], prefix = splitCurve(cubic, end)[0];
      const piece = end > 0 ? splitCurve(prefix, times[i] / end)[1] : prefix;
      const a = dense[indices[i]], b = dense[indices[i + 1]];
      const line: Cubic = [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
      error = Math.max(error, bound(piece.map((p, j) => sub(p, line[j])) as Cubic));
      if (!Number.isFinite(error)) break;
    }
    return error;
  };
  const refitHandles = (span: Span, candidate: Cubic): Cubic => {
    const a = candidate[0], b = candidate[3], u = unit(sub(candidate[1], a)), v = unit(sub(b, candidate[2]));
    let aa = 0, ab = 0, bb = 0, ar = 0, br = 0;
    for (let i = 1; i < span.indices!.length - 1; i++) {
      budget();
      const t = span.times![i], s = 1 - t, b1 = 3 * s * s * t, b2 = 3 * s * t * t;
      const x = mul(u, b1), y = mul(v, -b2), residual = sub(dense[span.indices![i]], lerp(a, b, b2 + t ** 3));
      aa += dot(x, x); ab += dot(x, y); bb += dot(y, y); ar += dot(x, residual); br += dot(y, residual);
    }
    const determinant = aa * bb - ab * ab;
    if (determinant < 1e-12) return candidate;
    const alpha = (ar * bb - br * ab) / determinant, beta = (br * aa - ar * ab) / determinant;
    return alpha > 0 && beta > 0 ? [a, add(a, mul(u, alpha)), sub(b, mul(v, beta)), b] : candidate;
  };
  // Make non-corner joins tangent-continuous only when BOTH adjusted spans
  // still satisfy the original continuous error allowance. Never smooth a
  // persistent corner, or silently spend more than the requested deviation.
  for (let i = 0; i < spans.length; i++) {
    const previous = spans[(i + spans.length - 1) % spans.length], next = spans[i];
    if (corners.has(next.first) || !previous.cubic && !next.cubic) continue;
    const p = dense[next.first];
    const incoming = previous.cubic ? sub(p, previous.cubic[2]) : sub(p, dense[previous.first]);
    const outgoing = next.cubic ? sub(next.cubic[1], p) : sub(dense[next.last], p);
    if (angle(incoming, outgoing) > Math.PI / 3) continue;
    const direction = previous.cubic && next.cubic ? unit(add(unit(incoming), unit(outgoing))) : unit(previous.cubic ? outgoing : incoming);
    let before = previous.cubic ? [...previous.cubic] as Cubic : undefined;
    let after = next.cubic ? [...next.cubic] as Cubic : undefined;
    if (before) before[2] = sub(p, mul(direction, length(incoming)));
    if (after) after[1] = add(p, mul(direction, length(outgoing)));
    let errorBefore = before ? verifyAdjusted(previous, before) : previous.error;
    let errorAfter = after ? verifyAdjusted(next, after) : next.error;
    if (before) { const fitted = refitHandles(previous, before), error = verifyAdjusted(previous, fitted); if (error < errorBefore) { before = fitted; errorBefore = error; } }
    if (after) { const fitted = refitHandles(next, after), error = verifyAdjusted(next, fitted); if (error < errorAfter) { after = fitted; errorAfter = error; } }
    if (errorBefore <= tolerance && errorAfter <= tolerance) {
      if (before) { previous.cubic = before; previous.error = errorBefore; }
      if (after) { next.cubic = after; next.error = errorAfter; }
    }
  }
  const anchors: CurveRing = spans.map(span => ({ point: { ...dense[span.first] } }));
  spans.forEach((span, i) => { if (span.cubic) { anchors[i].out = span.cubic[1]; anchors[(i + 1) % anchors.length].in = span.cubic[2]; } });
  anchors.forEach((a, i) => {
    const previous = curveControls(anchors, (i + anchors.length - 1) % anchors.length), next = curveControls(anchors, i);
    a.smooth = !corners.has(spans[i].first) && angle(sub(previous[3], previous[2]), sub(next[1], next[0])) < 1e-6;
  });
  const curves = mapCurves(source, p => ({ ...p }));
  if (ref.ringIndex === -1) curves[ref.shapeIndex].outer = anchors; else curves[ref.shapeIndex].holes[ref.ringIndex] = anchors;
  const reference = mapCurves(source, p => ({ ...p }));
  const raw = curvesFromOutline([{ outer: dense, holes: [] }])[0].outer;
  if (ref.ringIndex === -1) reference[ref.shapeIndex].outer = raw; else reference[ref.shapeIndex].holes[ref.ringIndex] = raw;
  validateFittedContour(reference, curves, ref, tolerance, budget);
  return { curves, before: dense.length, after: anchors.length, maxDeviation: Math.max(...spans.map(s => s.error)),
    changed: JSON.stringify(curves) !== JSON.stringify(source), lines: spans.filter(s => !s.cubic).length,
    cubics: spans.filter(s => s.cubic).length, corners: corners.size, smoothJoins: anchors.filter(a => a.smooth).length };
}
