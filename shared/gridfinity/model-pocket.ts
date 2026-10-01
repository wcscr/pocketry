import { z } from "zod";
import type { Outline } from "../geometry/types";
import { convexHull } from "../geometry/obb";
import { placeObjectVertices, type Vec3 } from "./object-pose";
import type { CutoutPlacement } from "./cutout";
import { pocketAxis, type PocketOrientation } from "./pocket-orientation";

/** Explicit limits apply to STL imports and embedded project meshes alike. */
export const MODEL_MAX_TRIANGLES = 20_000;
export const MODEL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const modelUnitsSchema = z.enum(["mm", "cm", "in", "m"]);
export type ModelUnits = z.infer<typeof modelUnitsSchema>;
export const MODEL_UNIT_MM: Record<ModelUnits, number> = { mm: 1, cm: 10, in: 25.4, m: 1000 };

/** Indexed, centered, right-handed millimetres. Original file access is never required. */
export const importedModelSchema = z.object({
  format: z.literal("stl"), units: modelUnitsSchema,
  positions: z.array(z.number().finite().min(-10000).max(10000)).min(12).max(MODEL_MAX_TRIANGLES * 9),
  indices: z.array(z.number().int().nonnegative()).min(12).max(MODEL_MAX_TRIANGLES * 3),
}).strict().superRefine((mesh, ctx) => {
  if (mesh.positions.length % 3 || mesh.indices.length % 3 || mesh.indices.some(i => i >= mesh.positions.length / 3)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid model vertices or triangle indices." });
  }
});
export type ImportedModel = z.infer<typeof importedModelSchema>;
type ModelPlacement = Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored"> &
  Partial<Pick<CutoutPlacement, "scaleX" | "scaleY" | "modelScaleZ" | "tilt" | "elevationMm" | "modelInsertionMode" | "modelSmoothingMm">>;

export function modelSourceVertices(model: ImportedModel, p: ModelPlacement): Vec3[] {
  const vertices: Vec3[] = [];
  for (let i = 0; i < model.positions.length; i += 3) vertices.push({
    x: model.positions[i] * (p.scaleX ?? 1) * (p.mirrored ? -1 : 1),
    y: model.positions[i + 1] * (p.scaleY ?? 1), z: model.positions[i + 2] * (p.modelScaleZ ?? 1),
  });
  return vertices;
}
export function placedModelVertices(model: ImportedModel, p: ModelPlacement): Vec3[] {
  return placeObjectVertices(modelSourceVertices(model, p), {
    rotation: { xDeg: p.tilt?.xDeg ?? 0, yDeg: p.tilt?.yDeg ?? 0, zDeg: p.rotationDeg },
    position: p.position, elevationMm: p.elevationMm ?? 0,
  });
}
/** The rotated model axis, pointing toward the bin's top even for inverted poses. */
export function modelInsertionAxis(p: PocketOrientation & { modelInsertionMode?: "axis" | "vertical" }): Vec3 {
  if (p.modelInsertionMode === "vertical") return { x: 0, y: 0, z: 1 };
  const axis = pocketAxis(p), sign = axis.z < 0 ? -1 : 1;
  return { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign };
}

/** Fast conservative picking/packing while the worker computes exact sections.
 * A finite top includes the insertion path so Fit bin to contents reserves it. */
/** Common resolution for the conservative storage envelope and packing bounds. */
export function modelStorageGridStep(width: number, depth: number, smoothingMm: number): number {
  return Math.max(0.2, smoothingMm / 4, Math.max(width, depth) / 400, Math.sqrt(width * depth / 60_000));
}

export function modelFootprint(model: ImportedModel, p: ModelPlacement, top = Infinity): Outline {
  const vertices = placedModelVertices(model, p), axis = modelInsertionAxis(p);
  const exits = Number.isFinite(top) && axis.z >= 0.01 ? vertices.filter(v => v.z < top).map(v => {
    const travel = (top - v.z) / axis.z;
    return { x: v.x + axis.x * travel, y: v.y + axis.y * travel };
  }) : [];
  const smoothing = p.modelSmoothingMm ?? 1;
  let points = [...vertices, ...exits];
  if (smoothing > 0) {
    const frame = p.modelInsertionMode === "vertical" ? vertices : modelSourceVertices(model, p);
    const width = Math.max(...frame.map(v => v.x)) - Math.min(...frame.map(v => v.x));
    const depth = Math.max(...frame.map(v => v.y)) - Math.min(...frame.map(v => v.y));
    // Cell coverage, interpolation and boundary smoothing expand outward.
    // An invalid horizontal path has no sweep: keep its picking/packing bounds
    // near the seated tool instead of dividing by a near-zero vertical axis.
    const step = modelStorageGridStep(width, depth, smoothing);
    const pad = ((2 * Math.SQRT2 + 1.5 * Math.sqrt(3)) * step + 1.5 * Math.max(0.3, step)) /
      (axis.z >= 0.01 ? axis.z : 1);
    points = convexHull(points).flatMap(v => [-1,1].flatMap(x => [-1,1].map(y => ({x:v.x+x*pad,y:v.y+y*pad}))));
  }
  return [{ outer: convexHull(points), holes: [] }];
}
export function modelDimensions(model: ImportedModel): [number, number, number] {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  model.positions.forEach((n, i) => { min[i % 3] = Math.min(min[i % 3], n); max[i % 3] = Math.max(max[i % 3], n); });
  return max.map((n, i) => n - min[i]) as [number, number, number];
}

/** Outline-only operations must never silently replace or reshape a model. */
export function modelPlacementError(p: CutoutPlacement): string | null {
  if (p.elevationMm === undefined || p.depth.mode !== "mm" || p.split || p.profileBottom || p.zOffsetMm) return "Imported models use elevation and model scale. Split, through, and outline-profile pockets are not supported.";
  if (modelInsertionAxis(p).z < 0.01) return "A horizontal insertion path cannot enter through the top. This pocket is omitted from the preview; choose Vertical drop-in or change the angle before exporting.";
  if (p.clearanceMm < 0) return "Model clearance must be zero or positive. Use model scale to shrink the cutter.";
  if (p.topFilletMm || p.bottomFilletMm || p.cornerRoundMm) return "Model edges come from the STL. Edit rounding in your modeling software before importing.";
  return null;
}
