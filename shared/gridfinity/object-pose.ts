import { z } from "zod";
import type { Point } from "../geometry/types";

export type Vec3 = { x: number; y: number; z: number };
export const objectRotationSchema = z.object({
  xDeg: z.number().finite(), yDeg: z.number().finite(), zDeg: z.number().finite(),
}).strict();
export type ObjectRotation = z.infer<typeof objectRotationSchema>;
export interface ObjectPose { rotation: ObjectRotation; position: Point; elevationMm: number }

/** A convex volume from any source: an extruded outline today, or convex
 * pieces of a model later. Edges make surface sections independent of the source mesh. */
export interface ConvexObjectCell { vertices: Vec3[]; edges: [number, number][] }

/** Fixed bin axes: Rz * Ry * Rx. Full turns and exact sideways/inverted poses
 * are valid; no insertion-axis division or pocket-specific tilt limit. */
export function rotateObjectVector(p: Vec3, rotation: ObjectRotation): Vec3 {
  const sinCos = (degrees: number): [number, number] => {
    const d = degrees % 360, angle = d * Math.PI / 180;
    // Match the kernel's exact quarter turns. Tiny trig residues otherwise
    // introduce nearly coincident faces when translating floor-color bands.
    return d % 90 === 0 ? [Math.round(Math.sin(angle)), Math.round(Math.cos(angle))] : [Math.sin(angle), Math.cos(angle)];
  };
  const [sx, cx] = sinCos(rotation.xDeg), [sy, cy] = sinCos(rotation.yDeg), [sz, cz] = sinCos(rotation.zDeg);
  const a = { x: p.x, y: p.y * cx - p.z * sx, z: p.y * sx + p.z * cx };
  const b = { x: a.x * cy + a.z * sy, y: a.y, z: -a.x * sy + a.z * cy };
  return { x: b.x * cz - b.y * sz, y: b.x * sz + b.y * cz, z: b.z };
}

/** Apply one rigid pose to every cell. Re-anchor only Z so elevation always
 * means the object's lowest point, with local thickness/scale unchanged. */
export function placeObjectCells(cells: readonly ConvexObjectCell[], pose: ObjectPose, anchor: readonly ConvexObjectCell[] = cells): ConvexObjectCell[] {
  const rotated = cells.map(c => ({ ...c, vertices: c.vertices.map(p => rotateObjectVector(p, pose.rotation)) }));
  let bottom = Infinity;
  const reference = anchor === cells ? rotated : anchor.map(c => ({ vertices: c.vertices.map(p => rotateObjectVector(p, pose.rotation)) }));
  for (const cell of reference) for (const p of cell.vertices) bottom = Math.min(bottom, p.z);
  return rotated.map(c => ({ ...c, vertices: c.vertices.map(p => ({
    x: p.x + pose.position.x, y: p.y + pose.position.y, z: p.z - bottom + pose.elevationMm,
  })) }));
}

/** Horizontal section through the actual cell, rather than its projected
 * shadow. Include coplanar faces only when material lies below the plane. */
export function sectionObjectCell(cell: ConvexObjectCell, top: number): Vec3[] {
  if (cell.vertices.every(p => p.z >= top - 1e-8) || cell.vertices.every(p => p.z < top - 1e-8)) return [];
  const points = cell.vertices.filter(p => Math.abs(p.z - top) < 1e-8);
  for (const [i, j] of cell.edges) {
    const a = cell.vertices[i], b = cell.vertices[j];
    if ((a.z < top && b.z > top) || (b.z < top && a.z > top)) {
      const t = (top - a.z) / (b.z - a.z);
      points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: top });
    }
  }
  return points;
}
