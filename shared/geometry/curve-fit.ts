import { curveControls, curveRing, mapCurves, sampleCurveRing, splitCurve,
  type Cubic, type CurveOutline, type CurveRing } from "./curves";
import { distanceToSegment, pointInRing, signedArea, traceRingKey } from "./rings";
import type { Point, Ring, RingRef } from "./types";

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

interface Contact {
  span: [Point, Point];
  targetEdge: number;
  otherEdge: number;
  /** Crossing direction along the target ring. Zero denotes a touch or shared span. */
  direction: number;
}

/** Locate contact along the neighboring edge. Collinear overlap contributes an interval. */
function edgeContact(a: Point, b: Point, c: Point, d: Point): Pick<Contact, "span" | "direction"> | undefined {
  const determinant = (u: Point, v: Point) => u.x * v.y - u.y * v.x;
  const ab = sub(b, a), cd = sub(d, c), ac = sub(c, a);
  const den = determinant(ab, cd);
  if (den) {
    const t = determinant(ac, cd) / den, u = determinant(ac, ab) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const point = mix(a, b, t);
      return { span: [point, point], direction: Math.min(t, 1 - t) * norm(ab) > 1e-9 && Math.min(u, 1 - u) * norm(cd) > 1e-9 ? Math.sign(den) : 0 };
    }
  }
  const touching = [a, b, c, d].filter(p =>
    distanceToSegment(p, a, b) < 1e-9 && distanceToSegment(p, c, d) < 1e-9);
  if (!touching.length) return;
  touching.sort((p, q) => p.x - q.x || p.y - q.y);
  return { span: [touching[0], touching[touching.length - 1]], direction: 0 };
}

/** At a sampled vertex both incident segments report the same hit. Use the outgoing
 * segment as its owner, and both incident rays to distinguish a crossing from a touch. */
function incidentRays(ring: Ring, edge: number, p: Point) {
  const next = (edge + 1) % ring.length;
  const vertex = norm(sub(p, ring[edge])) < 1e-9 ? edge : norm(sub(p, ring[next])) < 1e-9 ? next : -1;
  if (vertex < 0) return { owner: edge, back: ring[edge], forward: ring[next] };
  return { owner: vertex, back: ring[(vertex + ring.length - 1) % ring.length], forward: ring[(vertex + 1) % ring.length] };
}

function crossingAtVertex(p: Point, target: ReturnType<typeof incidentRays>, other: ReturnType<typeof incidentRays>) {
  const angle = (q: Point) => Math.atan2(q.y - p.y, q.x - p.x);
  const origin = angle(target.forward), turn = 2 * Math.PI;
  const relative = (q: Point) => (angle(q) - origin + turn) % turn;
  const limit = relative(target.back);
  const side = (q: Point) => {
    const a = relative(q);
    if (Math.min(a, turn - a, Math.abs(a - limit)) < 1e-10) return 0;
    return a < limit ? 1 : -1;
  };
  const before = side(other.back), after = side(other.forward);
  return before && before === -after ? after : 0;
}

const crossingError = "The fit would cross or touch another contour edge. Try a smaller deviation.";

/** Sweep only overlapping bounds. The target may never cross itself. */
function contourContacts(rings: Ring[], target: number, skip: Set<number>, budget: () => void, strict: boolean) {
  const contacts = new Map<number, Contact[]>();
  const edges = rings.flatMap((r, ring) => skip.has(ring) ? [] : r.map((a, i) => {
    const b = r[(i + 1) % r.length];
    return { a, b, ring, i, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  })).sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length && edges[j].minX <= edges[i].maxX + 1e-9; j++) {
    budget();
    const a = edges[i], b = edges[j];
    if (a.ring !== target && b.ring !== target || a.maxY < b.minY || b.maxY < a.minY) continue;
    if (a.ring === b.ring && (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === rings[a.ring].length - 1)) continue;
    const [subject, neighbor] = a.ring === target ? [a, b] : [b, a];
    const contact = edgeContact(subject.a, subject.b, neighbor.a, neighbor.b);
    if (!contact) continue;
    if (strict || a.ring === b.ring) throw new Error(crossingError);
    if (!contact.direction && norm(sub(contact.span[0], contact.span[1])) < 1e-9) {
      const p = contact.span[0];
      const subjectRays = incidentRays(rings[target], subject.i, p);
      const neighborRays = incidentRays(rings[neighbor.ring], neighbor.i, p);
      if (subjectRays.owner !== subject.i || neighborRays.owner !== neighbor.i) continue;
      contact.direction = crossingAtVertex(p, subjectRays, neighborRays);
    }
    const other = neighbor.ring;
    const list = contacts.get(other) ?? [];
    list.push({ ...contact, targetEdge: subject.i, otherEdge: neighbor.i });
    contacts.set(other, list);
  }
  return contacts;
}

/** Existing authored crossings can move within the fitting allowance. Require contacts in
 * both directions so a new intersection elsewhere, or a lost overlap, is still rejected. */
function coversContacts(contacts: Contact[], previous: Contact[], tolerance: number, budget: () => void) {
  return contacts.every(({ span: [a, b] }) => [a, mix(a, b, .5), b].every(p => previous.some(({ span: [c, d] }) => {
    budget();
    return distanceToSegment(p, c, d) <= tolerance;
  })));
}

/** At a shallow angle a small boundary displacement can move the intersection much farther.
 * Follow the actual contour from the old crossing toward its proposed location. Stay within
 * the deviation of that short path, so a crossing on a distant fold cannot take its place. */
function followsCrossing(ring: Ring, edge: number, from: Point, to: Point, tolerance: number, budget: () => void): boolean {
  for (const step of [1, -1]) {
    let start = from;
    let index = step === 1 ? (edge + 1) % ring.length : edge;
    for (let n = 0; n <= ring.length; n++) {
      budget();
      const end = ring[index];
      if (distanceToSegment(to, start, end) <= tolerance) return true;
      if (distanceToSegment(end, from, to) > tolerance) break;
      start = end;
      index = (index + step + ring.length) % ring.length;
    }
  }
  return false;
}

function preservesCrossings(old: Contact[], next: Contact[], originals: Ring[], fitted: Ring[],
  target: number, other: number, tolerance: number, budget: () => void): boolean {
  if (old.length !== next.length) return false;
  const used = new Set<Contact>();
  return old.every(before => {
    const a = before.span[0];
    const matches = next.filter(after => {
      budget();
      if (before.direction !== after.direction) return false;
      const b = after.span[0];
      return norm(sub(a, b)) <= tolerance || (
        followsCrossing(originals[target], before.targetEdge, a, b, tolerance, budget) &&
        followsCrossing(originals[other], before.otherEdge, a, b, tolerance, budget) &&
        followsCrossing(fitted[target], after.targetEdge, b, a, tolerance, budget) &&
        followsCrossing(fitted[other], after.otherEdge, b, a, tolerance, budget));
    });
    if (matches.length !== 1 || used.has(matches[0])) return false;
    used.add(matches[0]);
    return true;
  });
}

/** Topology guard on fine adaptive samples. Detected contours require disjoint boundaries.
 * For authored pockets, compare contacts to the accepted geometry before the edit. */
export function validateFittedContour(before: CurveOutline, after: CurveOutline, ref: RingRef, tolerance: number,
  budget: () => void, existingContactAllowance?: number): void {
  const flat = (outline: CurveOutline) => outline.flatMap((s, shapeIndex) => [
    { ring: s.outer, shapeIndex, ringIndex: -1 }, ...s.holes.map((ring, ringIndex) => ({ ring, shapeIndex, ringIndex }))]);
  const sources = flat(before), target = sources.findIndex(r => r.shapeIndex === ref.shapeIndex && r.ringIndex === ref.ringIndex);
  const precision = Math.min(tolerance / 16, 0.01);
  const originals = sources.map(r => sampleCurveRing(r.ring, precision));
  const rings = flat(after).map((r, i) => {
    if (r.ring === sources[i].ring || (existingContactAllowance === undefined && i !== target)) return originals[i];
    return sampleCurveRing(r.ring, precision);
  });
  const candidate = rings[target];
  if (candidate.length + originals.reduce((n, r) => n + r.length, 0) > 16_000) {
    throw new Error("This contour is too detailed to validate. Choose a shorter section or simplify it first.");
  }
  if (Math.abs(signedArea(candidate)) < 1e-12 || Math.sign(signedArea(candidate)) !== Math.sign(signedArea(originals[target]))) {
    throw new Error("The fit would collapse or reverse the contour. Try a smaller deviation.");
  }
  const skip = new Set<number>();
  if (existingContactAllowance !== undefined && ref.ringIndex >= 0) {
    const key = traceRingKey(originals[target]), nextKey = traceRingKey(candidate);
    sources.forEach((r, i) => {
      if (i !== target && r.ringIndex >= 0 && traceRingKey(originals[i]) === key && traceRingKey(rings[i]) === nextKey) skip.add(i);
    });
  }
  const contacts = contourContacts(rings, target, skip, budget, existingContactAllowance === undefined);
  const previous = existingContactAllowance === undefined || rings.length === 1
    ? new Map<number, Contact[]>() : contourContacts(originals, target, skip, budget, false);
  for (let i = 0; i < rings.length; i++) if (i !== target && !skip.has(i)) {
    const old = previous.get(i) ?? [], next = contacts.get(i) ?? [];
    if (old.length || next.length) {
      const allowance = (existingContactAllowance ?? 0) + 2 * precision;
      if (existingContactAllowance) {
        const oldCrossings = old.filter(c => c.direction), newCrossings = next.filter(c => c.direction);
        if (!preservesCrossings(oldCrossings, newCrossings, originals, rings, target, i, allowance, budget)) throw new Error(crossingError);
      }
      // Direct brush edits keep all contacts in place. For bounded refinement, crossings
      // were matched above and only tangent points and collinear spans still need comparison.
      const oldFixed = existingContactAllowance ? old.filter(c => !c.direction) : old;
      const newFixed = existingContactAllowance ? next.filter(c => !c.direction) : next;
      if (!coversContacts(newFixed, oldFixed, allowance, budget) || !coversContacts(oldFixed, newFixed, allowance, budget)) throw new Error(crossingError);
    } else if (pointInRing(originals[target], originals[i][0]) !== pointInRing(candidate, rings[i][0])
      || pointInRing(originals[i], originals[target][0]) !== pointInRing(rings[i], candidate[0])) {
      throw new Error("The fit would change a hole or another contour. Try a smaller deviation.");
    }
  }
}
