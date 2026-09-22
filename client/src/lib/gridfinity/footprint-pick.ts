import type { Point } from "@shared/geometry/types";
import type { GridCell } from "@shared/gridfinity/footprint";

/** Prefer containment; expand only the exposed edge of eligible cells. Equal
 * near misses are ambiguous, so never guess between two small quarter cells.
 */
export function pickFootprintCell(point: Point, cells: readonly GridCell[], gridX: number, gridY: number,
  pitchMm: number, toleranceMm: number): GridCell | null {
  const x = Math.floor(point.x / pitchMm + gridX / 2);
  const y = Math.floor(point.y / pitchMm + gridY / 2);
  const contained = cells.find(cell => cell.x === x && cell.y === y);
  if (contained) return contained;
  let nearest: GridCell | null = null;
  let distance = toleranceMm;
  let tied = false;
  for (const cell of cells) {
    const left = (cell.x - gridX / 2) * pitchMm;
    const bottom = (cell.y - gridY / 2) * pitchMm;
    const next = Math.hypot(Math.max(left - point.x, 0, point.x - left - pitchMm),
      Math.max(bottom - point.y, 0, point.y - bottom - pitchMm));
    if (Math.abs(next - distance) < 1e-6 && nearest) tied = true;
    else if (next <= distance) { nearest = cell; distance = next; tied = false; }
  }
  return tied ? null : nearest;
}
