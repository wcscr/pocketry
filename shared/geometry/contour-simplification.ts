import { curveRing, mapCurves, type CurveOutline } from "./curves";
import { reconstructionSourceRing, type ReconstructionResult } from "./contour-reconstruction";
import { curveFitRange, type CurveFitRequest, type CurveFitResult, validateFittedContour } from "./curve-fit";
import { distanceToSegment } from "./rings";
import type { Outline, Point, Ring, RingRef } from "./types";

function simplifyOpen(points: Ring, tolerance: number, budget: () => void): { points: Ring; maxDeviation: number } {
  let maxDeviation = 0;
  const fit = (points: Ring, depth = 0): Ring => {
      budget(); const a = points[0], b = points.at(-1)!;
      let error = 0, split = 0, progress = 0, reversal = 0;
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      for (let i = 1; i + 1 < points.length; i++) {
        budget(); const p = points[i], distance = distanceToSegment(p, a, b);
        if (distance > error) { error = distance; split = i; }
        const along = length ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length : 0;
        reversal = Math.max(reversal, progress - along); progress = Math.max(progress, along);
      }
      if (error <= tolerance && reversal <= tolerance) { maxDeviation = Math.max(maxDeviation, error); return [a, b]; }
      if (depth >= 24) return points;
      if (!split || reversal > tolerance) split = Math.floor(points.length / 2);
      return [...fit(points.slice(0, split + 1), depth + 1).slice(0, -1), ...fit(points.slice(split), depth + 1)];
    };
  return { points: fit(points), maxDeviation };
}

/** Default point-only cleanup. Finite-chord, two-way distance bounds retain
 * straight runs and approximate curved runs with points. Never authors handles. */
export function simplifyDetectedOutline(source: CurveOutline, dense: Outline, tolerance: number): ReconstructionResult {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error("Enter a positive maximum change.");
  if (source.length > 128 || dense.reduce((n, s) => n + s.outer.length + s.holes.reduce((n, r) => n + r.length, 0), 0) > 24_000) throw new Error("Select a smaller outline to simplify.");
  let curves = mapCurves(source, p => ({ ...p })), before = 0, maxDeviation = 0, after = 0, work = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("This outline is too complex to simplify at this allowance."); };
  const simplify = (ring: Ring): Ring => {
    if (ring.length < 3 || ring.length > 12_000 || !ring.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error("Choose a valid detected outline.");
    const farthest = (p: Point) => ring.reduce((best, q, i) => Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(ring[best].x - p.x, ring[best].y - p.y) ? i : best, 0);
    const first = farthest(ring[0]), last = farthest(ring[first]);
    const path = (start: number, end: number) => Array.from({ length: (end - start + ring.length) % ring.length + 1 }, (_, i) => ring[(start + i) % ring.length]);
    const a = simplifyOpen(path(first, last), tolerance, budget), b = simplifyOpen(path(last, first), tolerance, budget);
    maxDeviation = Math.max(maxDeviation, a.maxDeviation, b.maxDeviation);
    const result = [...a.points.slice(0, -1), ...b.points.slice(0, -1)];
    if (result.length < 3) throw new Error("The allowance would collapse this outline. Choose More detail.");
    return result;
  };
  for (let shapeIndex = 0; shapeIndex < source.length; shapeIndex++) for (const ringIndex of [-1, ...source[shapeIndex].holes.map((_, i) => i)]) {
    const ref = { shapeIndex, ringIndex }, original = curveRing(source, ref)!;
    if (original.some(a => a.in || a.out)) throw new Error("Convert curves to points before simplifying this outline.");
    const raw = reconstructionSourceRing(dense, source, ref), points = simplify(raw), next = mapCurves(curves, p => ({ ...p }));
    const ring = points.map(point => ({ point: { ...point } }));
    const reference = mapCurves(curves, p => ({ ...p }));
    if (ringIndex === -1) { next[shapeIndex].outer = ring; reference[shapeIndex].outer = raw.map(point => ({ point })); }
    else { next[shapeIndex].holes[ringIndex] = ring; reference[shapeIndex].holes[ringIndex] = raw.map(point => ({ point })); }
    validateFittedContour(reference, next, ref, tolerance, budget);
    curves = next; before += raw.length; after += points.length;
  }
  return { curves, before, after, maxDeviation, lines: after, cubics: 0, corners: after, smoothJoins: 0, changed: JSON.stringify(curves) !== JSON.stringify(source) };
}

/** Point-only counterpart of manual section/contour fitting. */
export function simplifyContour(source: CurveOutline, ref: RingRef, request: CurveFitRequest, tolerance: number): CurveFitResult {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error("Enter a positive maximum change.");
  const ring = curveRing(source, ref);
  if (!ring || ring.length < 3 || ring.length > 12_000 || ring.some(a => a.in || a.out)) throw new Error("Choose an outline made of points.");
  let work = 0; const budget = () => { if (++work > 5_000_000) throw new Error("This section is too complex to simplify."); };
  let fitted: typeof ring, maxDeviation: number;
  if (request.kind === "auto") {
    const result = simplifyDetectedOutline([{ outer: ring, holes: [] }], [{ outer: ring.map(a => a.point), holes: [] }], tolerance);
    fitted = result.curves[0].outer; maxDeviation = result.maxDeviation;
  } else {
    const indices = curveFitRange(ring.length, request.start, request.end);
    if (indices.length < 3) throw new Error("Select at least three adjacent points.");
    const result = simplifyOpen(indices.map(i => ring[i].point), tolerance, budget);
    fitted = result.points.map(point => ({ point: { ...point } })); maxDeviation = result.maxDeviation;
    for (let i = (request.end + 1) % ring.length; i !== request.start; i = (i + 1) % ring.length) fitted.push({ ...ring[i], point: { ...ring[i].point } });
  }
  if (fitted.length < 3) throw new Error("Keep at least three points in an outline.");
  const curves = mapCurves(source, p => ({ ...p }));
  if (ref.ringIndex === -1) curves[ref.shapeIndex].outer = fitted; else curves[ref.shapeIndex].holes[ref.ringIndex] = fitted;
  validateFittedContour(source, curves, ref, tolerance, budget);
  return { curves, before: ring.length, after: fitted.length, maxDeviation, changed: JSON.stringify(source) !== JSON.stringify(curves) };
}
