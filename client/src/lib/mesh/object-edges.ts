import { EdgesGeometry } from "three";
import type { MeshData } from "./mesh-data";
import { toBufferGeometry } from "./to-buffer-geometry";

/** Exterior creases, without coplanar triangulation or helper-cell seams.
 * Smooth surfaces remain legible through the translucent source preview. */
export function objectEdges(mesh: MeshData): [number, number, number][] {
  const geometry = toBufferGeometry(mesh);
  const edges = new EdgesGeometry(geometry, 15);
  try {
    const positions = edges.getAttribute("position");
    return Array.from({ length: positions.count }, (_, i) => [positions.getX(i), positions.getY(i), positions.getZ(i)]);
  } finally {
    edges.dispose();
    geometry.dispose();
  }
}
