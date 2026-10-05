import type { CutoutPlacement } from "./cutout";
import { pocketAxis, type Vec3 } from "./pocket-orientation";

/** The insertion direction always leads upward, including inverted pockets. */
export function pocketInsertionAxis(pocket: CutoutPlacement): Vec3 {
  if (pocket.insertionMode === "vertical") return { x: 0, y: 0, z: 1 };
  const axis = pocketAxis(pocket);
  const sign = axis.z < 0 ? -1 : 1;
  return { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign };
}

/** Finite pockets remain valid at any angle; an axial path must reach the top. */
export function pocketInsertionError(pocket: CutoutPlacement): string | null {
  return pocket.insertionMode === "axis" && pocketInsertionAxis(pocket).z < 0.01
    ? "The pocket angle is too close to horizontal to reach the surface. Use vertical drop-in or change the angle."
    : null;
}
