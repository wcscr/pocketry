import type { ReconstructionResult } from "./contour-reconstruction";
import { outlineRoughness } from "./contour-metrics";
import { curvesFromOutline, mapCurves, sampleCurves, type CurveOutline } from "./curves";
import { reconstructDetectedForEditing } from "./detected-cleanup";
import { validateFittedContour } from "./curve-fit";
import { smoothAcceptedPolygon } from "./outline-smoothing";
import type { Outline } from "./types";

const perimeter = (outline: Outline) => outline.flatMap(s => [s.outer, ...s.holes]).reduce((total, ring) =>
  total + ring.reduce((sum, p, i) => sum + Math.hypot(p.x - ring[(i + 1) % ring.length].x,
    p.y - ring[(i + 1) % ring.length].y), 0), 0);

/** Applied Auto levels share one accepted source until another outline edit. */
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
  for (const amount of amounts) {
    try {
      const candidate = smoothAndFit({ ...request, tolerance: amount });
      completed = true;
      const roughness = outlineRoughness(sampleCurves(candidate.curves, sampleTolerance / 8), options);
      if (roughness.reversals <= bestRoughness.reversals && roughness.jaggedLength <= bestRoughness.jaggedLength + spacing) {
        best = candidate; bestRoughness = roughness;
      }
    } catch (error) { failure = error; }
  }
  if (!completed) throw failure;
  return best;
}

function smoothAndFit({ source, tolerance, sampleTolerance, editableCurves = true }:
  OutlineSimplificationRequest): ReconstructionResult {
  const hasCurves = source.some(s => [s.outer, ...s.holes].some(r => r.some(a => a.in || a.out)));
  const sourceError = hasCurves ? Math.min(sampleTolerance, tolerance / 8) : 0;
  const dense = sampleCurves(source, sourceError || sampleTolerance);
  const fitAllowance = Math.min(sampleTolerance, (tolerance - sourceError) * .4);
  const smoothAllowance = tolerance - sourceError - fitAllowance;
  const smoothed = smoothAcceptedPolygon(dense, smoothAllowance, sampleTolerance * 4);
  const result = reconstructDetectedForEditing(curvesFromOutline(smoothed), smoothed, fitAllowance,
    editableCurves, sampleTolerance);
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
