import type { Manifold, Vec3 } from "manifold-3d";
import { resolvePocketDepth, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { rotateObjectVector } from "@shared/gridfinity/object-pose";
import { pocketAxis } from "@shared/gridfinity/pocket-orientation";
import { pocketRotation } from "@shared/gridfinity/rigid-pocket";
import { modelInsertionAxis, modelPlacementError, modelStorageGridStep } from "@shared/gridfinity/model-pocket";
import type { BinSpec } from "@shared/gridfinity/types";
import type { Kernel } from "@/lib/manifold/runtime";
import { modelStorageEnvelope } from "./model-storage-envelope";
import { modelSolid } from "./model-import";
import { buildObjectCavity } from "./object-cavity";
import { sweepSolidAlongAxis } from "./insertion-sweep";
import type { CutoutCutters } from "./cutouts";

/** Form a conservative storage cradle in the insertion frame, or an explicit
 * detailed CAD sweep at smoothing zero. Both clear the complete path toward the
 * opening. Storage smoothing retains the authored seating floor; it never
 * stretches or tightens the source model. */
export function buildModelPocket(kernel: Kernel, shape: TracedShape, p: CutoutPlacement,
  spec: BinSpec, floorThicknessMm = 0, top = resolvePocketDepth(spec, p.depth).cutterTopZ,
): CutoutCutters {
  const error = modelPlacementError(p);
  if (error) throw new Error(error);
  if (!shape.model) throw new Error("The imported model geometry is missing.");
  const { arena, Manifold } = kernel;
  const original = modelSolid(kernel, shape.model);
  const scaled = arena.track(original.scale([p.scaleX * (p.mirrored ? -1 : 1), p.scaleY, p.modelScaleZ ?? 1]));
  const rotation: [number, number, number] = [p.tilt?.xDeg ?? 0, p.tilt?.yDeg ?? 0, p.rotationDeg];
  let box: Manifold | undefined, clearance: Manifold | undefined;
  if (p.clearanceMm > 0) {
    box = arena.track(Manifold.cube([2 * p.clearanceMm, 2 * p.clearanceMm, 2 * p.clearanceMm], true));
    clearance = arena.track(box.rotate(rotation));
  }
  let source = arena.track(scaled.rotate(rotation));
  const bounds = source.boundingBox(), padding = clearance?.boundingBox();
  const bottom = bounds.min[2] + (padding?.min[2] ?? 0);
  const highest = bounds.max[2] + (padding?.max[2] ?? 0);
  const exitZ = Math.max(resolvePocketDepth(spec, p.depth).cutterTopZ, Number.isFinite(top) ? top : 0);
  const ceiling = Math.max(highest, exitZ - p.elevationMm! + bottom) + 1;
  const axis = modelInsertionAxis(p);
  const smoothing = p.modelSmoothingMm ?? 1;
  if (p.modelInsertionMode === "vertical") {
    source = smoothing > 0
      ? modelStorageEnvelope(kernel, source, ceiling, smoothing, p.clearanceMm)
      : sweepSolidAlongAxis(kernel, source, [0, 0, 1], ceiling, clearance);
  } else {
    // Sweep along authored Z before rotation. Nearly parallel rotated faces
    // otherwise make a detailed model's Minkowski sum unnecessarily expensive.
    const inverted = pocketAxis(p).z < 0;
    const native = inverted ? arena.track(scaled.rotate([180, 0, 0])) : scaled;
    const reach = Math.max(0, exitZ - p.elevationMm!) / axis.z + 1;
    const nativeCeiling = native.boundingBox().max[2] + p.clearanceMm + reach;
    const basis = [{x:1,y:0},{x:0,y:1},{x:0,y:0}].map((v,i) =>
      rotateObjectVector({...v,z:i===2?1:0},pocketRotation(p)));
    // Express the bin-horizontal numerical overlap in the model frame, so it
    // never shifts the seated floor when the swept solid is rotated back.
    const numericalDirections: Vec3[] = [-1,1].flatMap(x => [-1,1].map(y =>
      basis.map((v,i) => (v.x*x + v.y*y) * (inverted && i>0 ? -1 : 1)) as Vec3));
    source = smoothing > 0
      ? modelStorageEnvelope(kernel, native, nativeCeiling +
          (Math.hypot(...native.boundingBox().max.map((v,i) => v - native.boundingBox().min[i])) +
            4 * (smoothing + p.clearanceMm) + 2) / axis.z, smoothing, p.clearanceMm)
      : sweepSolidAlongAxis(kernel, native, [0,0,1], nativeCeiling, box, numericalDirections);
    if (inverted) source = arena.track(source.rotate([180,0,0]));
    source = arena.track(source.rotate(rotation));
    source = arena.track(source.trimByPlane([0,0,-1],-ceiling));
  }
  if (smoothing > 0) {
    const frame = p.modelInsertionMode === "vertical" ? bounds : scaled.boundingBox();
    const step = modelStorageGridStep(frame.max[0]-frame.min[0], frame.max[1]-frame.min[1], smoothing);
    // Leave part of the rounded underside before anchoring the floor. Half the
    // rounding radius is inside even the sphere mesh's inscribed octahedron,
    // so the subsequent lift still contains the original seated tool. Clipping
    // at the original bottom would discard the blend and recreate a sharp heel.
    const relief = Math.max(0.3, step) / 2;
    source = arena.track(source.trimByPlane([0,0,1], bounds.min[2] - relief));
  }
  const pose = { rotation: pocketRotation({ rotationDeg: 0 }), position: p.position, elevationMm: p.elevationMm! };
  const cutter = buildObjectCavity(kernel, source, pose, top);
  const floorInserts = [], floorRegions = [];
  const distance = Math.min(floorThicknessMm, p.elevationMm!);
  if (cutter && distance > 0) {
    // A downward-only band has zero thickness on vertical faces and vanishes
    // on overhangs, exposing body-colored patches inside an otherwise closed
    // pocket. Wrap the prepared cavity so every orientation has a real lining.
    // Expand only the material region; the cutter and tool clearance stay fixed.
    const shellRadius = arena.track(Manifold.sphere(distance, 8));
    const surrounding = arena.track(source.minkowskiSum(shellRadius));
    const band = arena.track(surrounding.subtract(source));
    const insert = buildObjectCavity(kernel, band, pose, top, source);
    const region = buildObjectCavity(kernel, surrounding, pose, top, source);
    if (insert) floorInserts.push(insert);
    if (region) floorRegions.push(region);
  }
  return { cutters: cutter ? [cutter] : [], floorInserts, floorRegions,
    reports: [{ id: p.id, emptied: source.isEmpty() }] };
}
