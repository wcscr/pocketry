import { preservesMaterial } from "@shared/geometry/boundary-contract";
import { curvesFromOutline } from "@shared/geometry/curves";
import { validateFittedContour } from "@shared/geometry/curve-fit";
import type { Outline } from "@shared/geometry/types";

/** Geometry checks are against the accepted silhouette, before user clearance. */
export function validDetectionGeometry(reference: Outline, candidate: Outline, inward: number, outward: number): boolean {
  if (reference === candidate) return true;
  if (!preservesMaterial(reference,candidate,inward) || !preservesMaterial(candidate,reference,outward)) return false;
  const before=curvesFromOutline(reference), after=curvesFromOutline(candidate);
  let remaining=5_000_000;
  const budget=()=>{if (--remaining<0) throw new Error("Boundary validation budget exceeded");};
  try {
    for (let shapeIndex=0;shapeIndex<candidate.length;shapeIndex++) {
      for (const ringIndex of [-1,...candidate[shapeIndex].holes.map((_,i)=>i)]) {
        const ref={shapeIndex,ringIndex};
        // Check changed containment against the original and all simultaneous
        // changes against one another, reusing the existing curve topology guard.
        validateFittedContour(before,after,ref,inward,budget);
        if (candidate.length>1 || candidate[shapeIndex].holes.length) validateFittedContour(after,after,ref,inward,budget);
      }
    }
    return true;
  } catch { return false; }
}
