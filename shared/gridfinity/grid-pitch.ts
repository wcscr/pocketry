import { canonicalCells, type BoundaryEdge, type GridCell } from "./footprint";
import { changeGridPitchPreservingSize, GRID_PITCH_DIVISOR, type GridPitch } from "./standard";
import type { BinSpec } from "./types";

type PitchPatch = Pick<BinSpec, "gridX" | "gridY" | "gridPitch" | "footprint" | "labelTab">;

/** Retain the same physical boundary run when its cell indices change. */
function convertBoundaryEdge(edge: BoundaryEdge, ratio: number): BoundaryEdge {
  const { cell, side } = edge;
  return {
    side,
    cell: {
      x: side === "east" ? Math.ceil((cell.x + 1) * ratio) - 1
        : side === "west" ? Math.floor(cell.x * ratio) : Math.floor((cell.x + 0.5) * ratio),
      y: side === "north" ? Math.ceil((cell.y + 1) * ratio) - 1
        : side === "south" ? Math.floor(cell.y * ratio) : Math.floor((cell.y + 0.5) * ratio),
    },
  };
}

/** Change the grid's resolution without moving or filling any part of the bin.
 * Finer pitches subdivide occupied cells. Coarser pitches require complete
 * blocks, even when the bounding rectangle alone fits the requested pitch.
 */
export function changeBinGridPitchPreservingSize(spec: BinSpec, gridPitch: GridPitch): PitchPatch | null {
  const dimensions = changeGridPitchPreservingSize(spec, gridPitch);
  if (!dimensions) return null;
  const ratio = GRID_PITCH_DIVISOR[gridPitch] / GRID_PITCH_DIVISOR[spec.gridPitch];
  let footprint = spec.footprint;
  if (footprint.kind === "custom" && ratio !== 1) {
    const cells: GridCell[] = [];
    if (ratio > 1) {
      for (const cell of footprint.cells) {
        for (let y = 0; y < ratio; y++) {
          for (let x = 0; x < ratio; x++) {
            cells.push({ x: cell.x * ratio + x, y: cell.y * ratio + y });
          }
        }
      }
    } else {
      const groups = new Map<string, { cell: GridCell; count: number }>();
      for (const cell of footprint.cells) {
        const target = { x: Math.floor(cell.x * ratio), y: Math.floor(cell.y * ratio) };
        const key = `${target.x},${target.y}`;
        const group = groups.get(key) ?? { cell: target, count: 0 };
        group.count++;
        groups.set(key, group);
      }
      const blockSize = (1 / ratio) ** 2;
      for (const group of groups.values()) {
        if (group.count !== blockSize) return null;
        cells.push(group.cell);
      }
    }
    footprint = { kind: "custom", cells: canonicalCells(cells) };
  }
  const labelTab = spec.labelTab?.edge && ratio !== 1
    ? { ...spec.labelTab, edge: convertBoundaryEdge(spec.labelTab.edge, ratio) }
    : spec.labelTab;
  return { ...dimensions, footprint, labelTab };
}
