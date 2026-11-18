import { reconstructContour } from "./contour-reconstruction";
import { validateFittedContour } from "./curve-fit";
import { curvesFromOutline, sampleCurves, type CurveOutline, type CurveRing } from "./curves";
import { traceRingKey } from "./rings";
import type { Ring } from "./types";

export interface CurveDetailRequest { source: CurveOutline; tolerance: number; sampleTolerance: number }

/** Fit each authored ring against its own samples, sharing each exclusion across its pockets.
 * Keep existing native handles whenever a fit would not reduce the number of anchors. */
export function refineCurveDetail({ source, tolerance, sampleTolerance }: CurveDetailRequest): CurveOutline {
  const samplingError = Math.min(sampleTolerance, tolerance / 8);
  const dense = sampleCurves(source, samplingError);
  const count = dense.reduce((n, shape) => n + shape.outer.length + shape.holes.reduce((m, h) => m + h.length, 0), 0);
  if (source.length > 128 || count > 24_000) throw new Error("This outline is too complex to refine at once.");
  const fit = (anchors: CurveRing, points: Ring) => {
    if (anchors.length === 3) return anchors;
    const single = curvesFromOutline([{ outer: points, holes: [] }]);
    const fitted = reconstructContour(single, { shapeIndex: 0, ringIndex: -1 }, points, tolerance - samplingError).curves[0].outer;
    return fitted.length < anchors.length ? fitted : anchors;
  };
  const holes = new Map<string, CurveRing>();
  const result = source.map((shape, i) => ({
    outer: fit(shape.outer, dense[i].outer),
    holes: shape.holes.map((hole, j) => {
      const points = dense[i].holes[j], key = traceRingKey(points);
      const previous = holes.get(key);
      if (previous) return previous;
      const next = fit(hole, points);
      holes.set(key, next);
      return next;
    }),
  }));
  let work = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("This outline is too complex to validate."); };
  for (const [shapeIndex, shape] of result.entries()) {
    for (const [index, ring] of [shape.outer, ...shape.holes].entries()) {
      if (ring === (index ? source[shapeIndex].holes[index - 1] : source[shapeIndex].outer)) continue;
      validateFittedContour(source, result, { shapeIndex, ringIndex: index - 1 }, tolerance, budget, tolerance);
    }
  }
  return result;
}
