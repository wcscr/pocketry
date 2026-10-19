import { pocketDepths, type CutoutPlacement } from "./cutout";
import { pocketInsertionAxis } from "./pocket-insertion";
import { migrateProfilePocket } from "./rigid-pocket";
import type { Vec3 } from "./object-pose";

/** Color direction is independent of clearance. Horizontal axes are valid:
 * their supporting surface is a side wall, without requiring an exit path. */
export function pocketColorLocalAxis(pocket: CutoutPlacement): "x" | "y" | "z" | null {
  const reference = pocket.colorFloorAxis ?? "vertical";
  if (reference === "vertical") return null;
  const posed = migrateProfilePocket(pocket);
  if (reference !== "insertion") return reference;
  if (posed.insertionMode === "vertical") return null;
  return posed.insertionMode === "axis" ? posed.insertionAxis ?? "z" : "z";
}

export function pocketColorAxis(pocket: CutoutPlacement): Vec3 {
  const axis = pocketColorLocalAxis(pocket);
  return axis === null ? { x: 0, y: 0, z: 1 }
    : pocketInsertionAxis({ ...migrateProfilePocket(pocket), insertionMode: "axis", insertionAxis: axis });
}

/** The export dialog and exporter must agree: through pockets can still have
 * colored side surfaces, while retained-material holes are never colored. */
export function hasColorablePocketSurfaces(pocket: CutoutPlacement): boolean {
  return pocket.role !== "hole" && (pocket.colorCoverage === "interior"
    || pocketColorLocalAxis(pocket) !== null
    || pocketDepths(pocket).some(depth => depth.mode !== "through"));
}
