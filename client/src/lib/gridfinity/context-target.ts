import type { Point, Outline, RingRef } from "@shared/geometry/types";
import { pointInRing } from "@shared/geometry/rings";
import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
import { transformOutlinePlacement } from "@shared/gridfinity/cutout";
import { pickObject, type EditableObject, type ObjectRef } from "./object-arrangement";

export type BinContextTarget = ObjectRef | { kind: "text"; id: string }
  | { kind: "hole"; id: string; shapeId: string; ref: RingRef };

/** Finger access stays on top. Retained-material holes belong to their pocket. */
export function pickBinContextTarget(objects: readonly EditableObject[], point: Point,
  geometry?: ReadonlyMap<string, { full: Outline }>,
): BinContextTarget | null {
  const object = pickObject(objects, point, geometry);
  if (object?.kind === "finger") return object;
  for (const item of [...objects].reverse()) {
    if (item.kind !== "pocket" || item.cutout.profileBottom || hasPocketTilt(item.cutout)) continue;
    const placed = transformOutlinePlacement(item.shape.outlineMm, item.cutout);
    for (const [shapeIndex, shape] of placed.entries()) for (const [ringIndex, ring] of shape.holes.entries()) {
      if (pointInRing(ring, point)) return { kind: "hole", id: item.cutout.id, shapeId: item.shape.id, ref: { shapeIndex, ringIndex } };
    }
  }
  return object;
}
