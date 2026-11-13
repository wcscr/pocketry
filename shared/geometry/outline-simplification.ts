import type { ReconstructionResult } from "./contour-reconstruction";
import { outlineRoughness } from "./contour-metrics";
import { curvesFromOutline, mapCurves, sampleCurves, type CurveOutline } from "./curves";
import { reconstructDetectedForEditing } from "./detected-cleanup";
import { validateFittedContour } from "./curve-fit";
import { smoothAcceptedPolygon } from "./outline-smoothing";
import { simplifyOutline } from "./simplify";
import type { Outline } from "./types";

/** Shared by fresh detection and the optional manual smoothing preview. */
export const AUTO_SMOOTHING_ALLOWANCE = { mm: .2, px: 2 } as const;

/**
 * How much of the smoothing allowance may be spent moving the boundary towards
 * the material. Filling a dip costs a pocket a little room; shaving a bump or
 * shortening a tip makes it too small for the tool. A quarter keeps the filter
 * continuous where a dip meets a bump without visibly trimming either.
 */
export const SMOOTHING_INWARD_SHARE = .25;

const perimeter = (outline: Outline) => outline.flatMap(s => [s.outer, ...s.holes]).reduce((total, ring) =>
  total + ring.reduce((sum, p, i) => sum + Math.hypot(p.x - ring[(i + 1) % ring.length].x,
    p.y - ring[(i + 1) % ring.length].y), 0), 0);

/** Applied Auto simplification retains its accepted source until another outline edit. */
export interface AppliedOutlineSimplification {
  source: CurveOutline;
  allowance: number;
  unitsPerUnit: number;
  unit: "mm" | "px";
}

export interface OutlineSimplificationRequest {
  source: CurveOutline;
  tolerance: number;
  /** Independent curve tessellation limit, in the source's coordinate units. */
  sampleTolerance: number;
  editableCurves?: boolean;
}

/** Always simplify the accepted outline, and retain the smoothest safe result
 * from the weaker levels too. Stronger presets must not bring back bumps that
 * a weaker preset removed. The allowance is a maximum, not a required movement. */
export function simplifyAcceptedOutline(request: OutlineSimplificationRequest): ReconstructionResult {
  const { source, tolerance, sampleTolerance } = request;
  if (!(tolerance > 0) || !Number.isFinite(tolerance) || !(sampleTolerance > 0) || !Number.isFinite(sampleTolerance))
    throw new Error("Enter a positive finite simplification amount.");
  const original = sampleCurves(source, sampleTolerance / 8);
  const before = source.reduce((n, s) => n + s.outer.length + s.holes.reduce((m, r) => m + r.length, 0), 0);
  const anchors = source.flatMap(s => [s.outer, ...s.holes]).flat();
  const cubics = source.flatMap(s => [s.outer, ...s.holes]).reduce((count, ring) =>
    count + ring.filter((a, i) => a.out || ring[(i + 1) % ring.length].in).length, 0);
  let best: ReconstructionResult = { curves: source, before, after: before, changed: false, maxDeviation: 0,
    lines: before - cubics, cubics, corners: anchors.filter(a => !a.smooth).length,
    smoothJoins: anchors.filter(a => a.smooth).length };
  // Bound evaluation work while comparing at the same physical scale.
  const spacing = Math.max(sampleTolerance * 2, perimeter(original) / 20_000);
  const options = { spacing, scale: spacing * 10, minAmplitude: sampleTolerance * 2 };
  let bestRoughness = outlineRoughness(original, options);
  const amounts = [tolerance];
  while (amounts[0] / 2 >= sampleTolerance * 2 && amounts.length < 8) amounts.unshift(amounts[0] / 2);
  let completed = false, failure: unknown;
  const attempt = (amount: number) => {
    try {
      const candidate = smoothAndFit({ ...request, tolerance: amount });
      completed = true;
      return { candidate, roughness: outlineRoughness(sampleCurves(candidate.curves, sampleTolerance / 8), options) };
    } catch (error) { failure = error; return null; }
  };
  const consider = (result: ReturnType<typeof attempt>) => {
    if (result && result.roughness.reversals <= bestRoughness.reversals &&
      result.roughness.jaggedLength <= bestRoughness.jaggedLength + spacing) {
      best = result.candidate; bestRoughness = result.roughness;
    }
  };
  // The full amount is compared last and wins whenever it is no rougher than the best weaker
  // level. With no bumps at all it cannot lose, so the weaker levels need not be computed: the
  // usual case, and most of this function's time.
  const full = attempt(tolerance);
  if (full && full.roughness.reversals === 0 && full.roughness.jaggedLength === 0) return full.candidate;
  for (const amount of amounts.slice(0, -1)) consider(attempt(amount));
  consider(full);
  if (!completed) throw failure;
  return best;
}

function smoothAndFit({ source, tolerance, sampleTolerance, editableCurves = true }:
  OutlineSimplificationRequest): ReconstructionResult {
  const hasCurves = source.some(s => [s.outer, ...s.holes].some(r => r.some(a => a.in || a.out)));
  const sourceError = hasCurves ? Math.min(sampleTolerance, tolerance / 8) : 0;
  const dense = sampleCurves(source, sourceError || sampleTolerance);
  const fitAllowance = Math.min(sampleTolerance, (tolerance - sourceError) * .4);
  // A point outline is thinned after it is flattened (below), and that movement comes out of the smoothing's share.
  const thinAllowance = editableCurves ? 0 : Math.min(sampleTolerance, (tolerance - sourceError - fitAllowance) * .25);
  const smoothAllowance = tolerance - sourceError - fitAllowance - thinAllowance;
  const smoothed = smoothAcceptedPolygon(dense, smoothAllowance, sampleTolerance * 4, smoothAllowance * SMOOTHING_INWARD_SHARE);
  let result = reconstructDetectedForEditing(curvesFromOutline(smoothed), smoothed, fitAllowance,
    editableCurves, sampleTolerance);
  if (thinAllowance > 0) {
    // Flattening the fitted curves to a quarter of the fit allowance leaves about three times the
    // points the outline arrived with, for the user to edit one by one. Thinning to the tolerance
    // a detected outline is flattened with brings the count back and moves nothing by more than that.
    const curves = curvesFromOutline(simplifyOutline(sampleCurves(result.curves, sampleTolerance), thinAllowance));
    const points = curves.reduce((n, s) => n + s.outer.length + s.holes.reduce((m, r) => m + r.length, 0), 0);
    result = { ...result, curves, after: points, lines: points, cubics: 0, corners: points, smoothJoins: 0,
      maxDeviation: result.maxDeviation + thinAllowance };
  }
  // Smoothing also moves vertices. Check the final topology against the
  // accepted outline, atomically including interactions between changed rings.
  let checked = source, work = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("This outline is too complex to validate."); };
  for (let shapeIndex = 0; shapeIndex < source.length; shapeIndex++)
    for (const ringIndex of [-1, ...source[shapeIndex].holes.map((_, i) => i)]) {
      const next = mapCurves(checked, p => ({ ...p }));
      if (ringIndex === -1) next[shapeIndex].outer = result.curves[shapeIndex].outer;
      else next[shapeIndex].holes[ringIndex] = result.curves[shapeIndex].holes[ringIndex];
      validateFittedContour(checked, next, { shapeIndex, ringIndex }, tolerance, budget);
      checked = next;
    }
  const before = source.reduce((n, s) => n + s.outer.length + s.holes.reduce((m, r) => m + r.length, 0), 0);
  return { ...result, before,
    maxDeviation: result.maxDeviation + sourceError + smoothAllowance, changed: JSON.stringify(source) !== JSON.stringify(result.curves) };
}
