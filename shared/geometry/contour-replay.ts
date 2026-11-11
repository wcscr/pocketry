import type { Outline, Point } from "./types";
import { preservesMaterial } from "./boundary-contract";

/** Explicit raster provenance; never estimate it by fitting output bounds. */
export interface RasterTransform { origin: Point; scale: { x: number; y: number } }
export function outlineToInput(outline: Outline, transform: RasterTransform): Outline {
  const map=(p:Point)=>({x:(p.x-transform.origin.x)/transform.scale.x,y:(p.y-transform.origin.y)/transform.scale.y});
  return outline.map(s=>({outer:s.outer.map(map),holes:s.holes.map(r=>r.map(map))}));
}
/** Same input must preserve topology and every boundary, including short tips. */
export function replayMatches(a: Outline, b: Outline, tolerance=.05): boolean {
  return preservesMaterial(a,b,tolerance)&&preservesMaterial(b,a,tolerance);
}
export function missingMaterialFailure(outline: Outline, leftOut: number | null, limit=1): boolean {
  return !outline.length || leftOut===null || !Number.isFinite(leftOut) || leftOut>=limit;
}
