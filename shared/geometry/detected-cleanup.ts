import { reconstructDetectedOutline, type ReconstructionResult } from "./contour-reconstruction";
import { curvesFromOutline, sampleCurves, type CurveOutline } from "./curves";
import { validateFittedContour } from "./curve-fit";
import type { Outline } from "./types";

/** Both editing styles reconstruct lines and curves. Point mode flattens the
 * fitted geometry, reserving a quarter of the allowance for that approximation;
 * it must not revert to simplifying the jagged detected polygon alone. */
export function reconstructDetectedForEditing(source: CurveOutline, dense: Outline, tolerance: number,
  editableCurves = true): ReconstructionResult {
  if (editableCurves) return reconstructDetectedOutline(source, dense, tolerance);
  const result = reconstructDetectedOutline(source, dense, tolerance * .75);
  const sampleTolerance = tolerance * .25;
  const curves = curvesFromOutline(sampleCurves(result.curves, sampleTolerance));
  let work = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("This outline is too complex to simplify."); };
  for (let shapeIndex = 0; shapeIndex < curves.length; shapeIndex++)
    for (const ringIndex of [-1, ...curves[shapeIndex].holes.map((_, i) => i)])
      validateFittedContour(result.curves, curves, { shapeIndex, ringIndex }, sampleTolerance, budget);
  const after = curves.reduce((n, s) => n + s.outer.length + s.holes.reduce((m, r) => m + r.length, 0), 0);
  return { ...result, curves, after, maxDeviation: result.maxDeviation + sampleTolerance,
    lines: after, cubics: 0, corners: after, smoothJoins: 0,
    changed: JSON.stringify(source) !== JSON.stringify(curves) };
}
