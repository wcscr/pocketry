import { distanceToSegment, pointInRing } from "../geometry/rings";
import type { Point, Ring } from "../geometry/types";
import {
  BASE_GAP_MM,
  BASE_TOP_RADIUS,
  D_WALL,
  gridPitchMm,
  R_F2,
  type GridPitch,
} from "./standard";

export interface GridCell {
  /** Zero-based column, west to east. */
  x: number;
  /** Zero-based row, south to north. */
  y: number;
}

export type CellSide = "north" | "south" | "east" | "west";

export interface BoundaryEdge {
  cell: GridCell;
  side: CellSide;
}

export type BinFootprint =
  | { kind: "rectangle" }
  | { kind: "custom"; cells: GridCell[] };

export interface FootprintSpec {
  gridX: number;
  gridY: number;
  gridPitch?: GridPitch;
  footprint?: BinFootprint;
}

export interface BoundaryRun {
  side: CellSide;
  /** Inclusive first and last occupied cells along the run. */
  cells: GridCell[];
  start: Point;
  end: Point;
  lengthMm: number;
}

const cellKey = (cell: GridCell): string => `${cell.x},${cell.y}`;
const vertexKey = (x: number, y: number): string => `${x},${y}`;

export function canonicalCells(cells: readonly GridCell[]): GridCell[] {
  return [...cells]
    .map(({ x, y }) => ({ x, y }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function rectangleCells(gridX: number, gridY: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let y = 0; y < gridY; y++) {
    for (let x = 0; x < gridX; x++) cells.push({ x, y });
  }
  return cells;
}

export function occupiedCells(spec: FootprintSpec): GridCell[] {
  return spec.footprint?.kind === "custom"
    ? canonicalCells(spec.footprint.cells)
    : rectangleCells(spec.gridX, spec.gridY);
}

export function occupiedCellCount(spec: FootprintSpec): number {
  return spec.footprint?.kind === "custom"
    ? spec.footprint.cells.length
    : spec.gridX * spec.gridY;
}

export function hasCell(spec: FootprintSpec, cell: GridCell): boolean {
  if (cell.x < 0 || cell.y < 0 || cell.x >= spec.gridX || cell.y >= spec.gridY) {
    return false;
  }
  if (spec.footprint?.kind !== "custom") return true;
  return spec.footprint.cells.some(({ x, y }) => x === cell.x && y === cell.y);
}

export function cellCenterMm(spec: FootprintSpec, cell: GridCell): Point {
  const pitch = gridPitchMm(spec.gridPitch);
  return {
    x: (cell.x - (spec.gridX - 1) / 2) * pitch,
    y: (cell.y - (spec.gridY - 1) / 2) * pitch,
  };
}

/** Returns a user-facing error, or null when the mask is a valid v1 polyomino. */
export function footprintTopologyError(
  gridX: number,
  gridY: number,
  cells: readonly GridCell[],
): string | null {
  if (cells.length === 0) return "A footprint must contain at least one cell.";
  const keys = new Set<string>();
  for (const cell of cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      return "Footprint cell coordinates must be integers.";
    }
    if (cell.x < 0 || cell.y < 0 || cell.x >= gridX || cell.y >= gridY) {
      return "Footprint cells must lie inside the bounding grid.";
    }
    const key = cellKey(cell);
    if (keys.has(key)) return "Footprint cells must be unique.";
    keys.add(key);
  }

  const queue = [cells[0]];
  const seen = new Set([cellKey(cells[0])]);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    for (const next of neighbours(cell)) {
      const key = cellKey(next);
      if (keys.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  if (seen.size !== cells.length) return "Footprint cells must share edges as one piece.";

  // Flood empty space from a one-cell border. Any unvisited empty cell inside
  // the bounding grid is an enclosed footprint hole.
  const emptySeen = new Set<string>();
  const emptyQueue: GridCell[] = [{ x: -1, y: -1 }];
  emptySeen.add(cellKey(emptyQueue[0]));
  for (let i = 0; i < emptyQueue.length; i++) {
    const cell = emptyQueue[i];
    for (const next of neighbours(cell)) {
      if (next.x < -1 || next.y < -1 || next.x > gridX || next.y > gridY) continue;
      const key = cellKey(next);
      if (keys.has(key) || emptySeen.has(key)) continue;
      emptySeen.add(key);
      emptyQueue.push(next);
    }
  }
  for (let y = 0; y < gridY; y++) {
    for (let x = 0; x < gridX; x++) {
      const key = cellKey({ x, y });
      if (!keys.has(key) && !emptySeen.has(key)) {
        return "Footprint cells may not enclose an empty hole.";
      }
    }
  }
  return null;
}

function neighbours(cell: GridCell): GridCell[] {
  return [
    { x: cell.x - 1, y: cell.y },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x, y: cell.y + 1 },
  ];
}

/**
 * Removes empty outside rows/columns. `shiftCells` is the lattice translation
 * applied to the retained cells; callers apply its millimetre equivalent to
 * pockets so the edited footprint does not jump beneath them.
 */
export function normalizeCustomFootprint(cells: readonly GridCell[]): {
  gridX: number;
  gridY: number;
  cells: GridCell[];
  shiftCells: GridCell;
} {
  if (cells.length === 0) {
    return { gridX: 1, gridY: 1, cells: [], shiftCells: { x: 0, y: 0 } };
  }
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return {
    gridX: maxX - minX + 1,
    gridY: maxY - minY + 1,
    cells: canonicalCells(cells.map(({ x, y }) => ({ x: x - minX, y: y - minY }))),
    shiftCells: { x: -minX, y: -minY },
  };
}

interface LatticeEdge {
  from: GridCell;
  to: GridCell;
  cell: GridCell;
  side: CellSide;
}

/** Unit boundary edges, wound counter-clockwise around the occupied cells. */
function latticeEdges(spec: FootprintSpec): LatticeEdge[] {
  const all = new Map<string, LatticeEdge>();
  const add = (edge: LatticeEdge) => {
    const forward = `${vertexKey(edge.from.x, edge.from.y)}>${vertexKey(edge.to.x, edge.to.y)}`;
    const reverse = `${vertexKey(edge.to.x, edge.to.y)}>${vertexKey(edge.from.x, edge.from.y)}`;
    if (all.has(reverse)) all.delete(reverse);
    else all.set(forward, edge);
  };
  for (const cell of occupiedCells(spec)) {
    const { x, y } = cell;
    add({ from: { x, y }, to: { x: x + 1, y }, cell, side: "south" });
    add({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 }, cell, side: "east" });
    add({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 }, cell, side: "north" });
    add({ from: { x, y: y + 1 }, to: { x, y }, cell, side: "west" });
  }
  return [...all.values()];
}

export function boundaryEdges(spec: FootprintSpec): BoundaryEdge[] {
  return latticeEdges(spec).map(({ cell, side }) => ({ cell, side }));
}

function orderedLatticeRing(spec: FootprintSpec): GridCell[] {
  const edges = latticeEdges(spec);
  if (edges.length === 0) return [];
  const outgoing = new Map<string, LatticeEdge[]>();
  for (const edge of edges) {
    const key = vertexKey(edge.from.x, edge.from.y);
    outgoing.set(key, [...(outgoing.get(key) ?? []), edge]);
  }
  const start = [...edges].sort(
    (a, b) => a.from.y - b.from.y || a.from.x - b.from.x || a.to.x - b.to.x,
  )[0];
  const ring: GridCell[] = [];
  const used = new Set<string>();
  let edge = start;
  while (true) {
    const id = `${vertexKey(edge.from.x, edge.from.y)}>${vertexKey(edge.to.x, edge.to.y)}`;
    if (used.has(id)) break;
    used.add(id);
    ring.push(edge.from);
    const candidates = outgoing.get(vertexKey(edge.to.x, edge.to.y)) ?? [];
    const next = candidates.find((candidate) => {
      const candidateId = `${vertexKey(candidate.from.x, candidate.from.y)}>${vertexKey(candidate.to.x, candidate.to.y)}`;
      return !used.has(candidateId);
    });
    if (!next) break;
    edge = next;
  }
  return removeCollinear(ring);
}

function removeCollinear(points: readonly GridCell[]): GridCell[] {
  return points.filter((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return (point.x - prev.x) * (next.y - point.y) -
      (point.y - prev.y) * (next.x - point.x) !== 0;
  });
}

function roundedOffsetRing(
  spec: FootprintSpec,
  insetMm: number,
  convexRadiusMm: number,
  concaveRadiusMm: number,
  circularSegments: number,
): Ring {
  const lattice = orderedLatticeRing(spec);
  if (lattice.length < 3) return [];
  const pitch = gridPitchMm(spec.gridPitch);
  const points = lattice.map((point) => ({
    x: (point.x - spec.gridX / 2) * pitch,
    y: (point.y - spec.gridY / 2) * pitch,
  }));
  const result: Ring = [];
  const quarterSegments = Math.max(1, Math.round(circularSegments / 4));

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const point = points[i];
    const next = points[(i + 1) % points.length];
    const incoming = unit({ x: point.x - prev.x, y: point.y - prev.y });
    const outgoing = unit({ x: next.x - point.x, y: next.y - point.y });
    const leftIn = { x: -incoming.y, y: incoming.x };
    const leftOut = { x: -outgoing.y, y: outgoing.x };
    const vertex = {
      x: point.x + insetMm * (leftIn.x + leftOut.x),
      y: point.y + insetMm * (leftIn.y + leftOut.y),
    };
    const turn = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const radius = turn > 0 ? convexRadiusMm : concaveRadiusMm;
    const start = {
      x: vertex.x - incoming.x * radius,
      y: vertex.y - incoming.y * radius,
    };
    const centre = {
      x: start.x + outgoing.x * radius,
      y: start.y + outgoing.y * radius,
    };
    const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
    const delta = turn > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (let step = 0; step < quarterSegments; step++) {
      const angle = startAngle + delta * (step / quarterSegments);
      result.push({
        x: centre.x + radius * Math.cos(angle),
        y: centre.y + radius * Math.sin(angle),
      });
    }
  }
  return result;
}

function unit(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  return { x: vector.x / length, y: vector.y / length };
}

/** Rounded outer material boundary in bin-local millimetres. */
export function footprintOuterRingMm(spec: FootprintSpec, circularSegments = 64): Ring {
  return roundedOffsetRing(
    spec,
    BASE_GAP_MM / 2,
    BASE_TOP_RADIUS,
    BASE_TOP_RADIUS,
    circularSegments,
  );
}

/** Rounded cavity boundary after the wall inset. */
export function footprintInteriorRingMm(spec: FootprintSpec, circularSegments = 64): Ring {
  return roundedOffsetRing(
    spec,
    BASE_GAP_MM / 2 + D_WALL,
    R_F2,
    BASE_TOP_RADIUS + D_WALL,
    circularSegments,
  );
}

/** Positive inside, negative outside, exact for the sampled boundary segments. */
export function signedDistanceToFootprintRing(point: Point, ring: Ring): number {
  if (ring.length === 0) return -Infinity;
  let distance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    distance = Math.min(distance, distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return pointInRing(ring, point) ? distance : -distance;
}

export function isBoundaryEdge(spec: FootprintSpec, edge: BoundaryEdge): boolean {
  if (!hasCell(spec, edge.cell)) return false;
  const delta: Record<CellSide, GridCell> = {
    north: { x: 0, y: 1 },
    south: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
  };
  const d = delta[edge.side];
  return !hasCell(spec, { x: edge.cell.x + d.x, y: edge.cell.y + d.y });
}

/** Resolves an anchored unit edge to its maximal collinear boundary run. */
export function resolveBoundaryRun(spec: FootprintSpec, edge: BoundaryEdge): BoundaryRun | null {
  if (!isBoundaryEdge(spec, edge)) return null;
  const horizontal = edge.side === "north" || edge.side === "south";
  const cells: GridCell[] = [edge.cell];
  for (const direction of [-1, 1] as const) {
    let cursor = edge.cell;
    while (true) {
      const next = horizontal
        ? { x: cursor.x + direction, y: cursor.y }
        : { x: cursor.x, y: cursor.y + direction };
      if (!isBoundaryEdge(spec, { cell: next, side: edge.side })) break;
      if (direction < 0) cells.unshift(next);
      else cells.push(next);
      cursor = next;
    }
  }
  const pitch = gridPitchMm(spec.gridPitch);
  const first = cellCenterMm(spec, cells[0]);
  const last = cellCenterMm(spec, cells[cells.length - 1]);
  const half = pitch / 2 - BASE_GAP_MM / 2;
  let start: Point;
  let end: Point;
  if (horizontal) {
    const y = first.y + (edge.side === "north" ? half : -half);
    start = { x: first.x - half, y };
    end = { x: last.x + half, y };
  } else {
    const x = first.x + (edge.side === "east" ? half : -half);
    start = { x, y: first.y - half };
    end = { x, y: last.y + half };
  }
  return { side: edge.side, cells, start, end, lengthMm: cells.length * pitch - BASE_GAP_MM };
}

/**
 * A deterministic outermost edge on a named side. Rectangles preserve the
 * historic centre-edge choice; custom masks choose the outermost run nearest
 * the bounding-grid centre, so a legacy wall selection cannot land in a
 * missing corner cell.
 */
export function edgeForWall(spec: FootprintSpec, side: CellSide): BoundaryEdge {
  if (spec.footprint?.kind === "custom") {
    const centreX = (spec.gridX - 1) / 2;
    const centreY = (spec.gridY - 1) / 2;
    const candidates = boundaryEdges(spec).filter((edge) => edge.side === side);
    candidates.sort((a, b) => {
      const outward =
        side === "north"
          ? b.cell.y - a.cell.y
          : side === "south"
            ? a.cell.y - b.cell.y
            : side === "east"
              ? b.cell.x - a.cell.x
              : a.cell.x - b.cell.x;
      if (outward !== 0) return outward;
      const aCentreDistance =
        side === "north" || side === "south"
          ? Math.abs(a.cell.x - centreX)
          : Math.abs(a.cell.y - centreY);
      const bCentreDistance =
        side === "north" || side === "south"
          ? Math.abs(b.cell.x - centreX)
          : Math.abs(b.cell.y - centreY);
      return aCentreDistance - bCentreDistance ||
        a.cell.y - b.cell.y || a.cell.x - b.cell.x;
    });
    if (candidates[0]) return candidates[0];
  }
  switch (side) {
    case "north": return { cell: { x: Math.floor((spec.gridX - 1) / 2), y: spec.gridY - 1 }, side };
    case "south": return { cell: { x: Math.floor((spec.gridX - 1) / 2), y: 0 }, side };
    case "east": return { cell: { x: spec.gridX - 1, y: Math.floor((spec.gridY - 1) / 2) }, side };
    case "west": return { cell: { x: 0, y: Math.floor((spec.gridY - 1) / 2) }, side };
  }
}
