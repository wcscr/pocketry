import {
  cutoutPlacementSchema,
  placementFootprint,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import {
  binFootprintMm,
  D_DIV,
  D_WALL,
  STACKING_LIP_DEPTH,
  type GridPitch,
} from "@shared/gridfinity/standard";
import { MAX_GRID, type BinSpec } from "@shared/gridfinity/types";
import {
  canonicalCells,
  cellCenterMm,
  footprintTopologyError,
  rectangleCells,
  type BinFootprint,
} from "@shared/gridfinity/footprint";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";
import { minAreaObb } from "@shared/geometry/obb";
import type { Bounds, Point } from "@shared/geometry/types";

/**
 * Automatic placement and bin sizing — pure math, no WASM, so the designer
 * can call it synchronously when shapes arrive from the trace workspace.
 *
 * v1 per the design doc: simple shelf packing (largest first, left to right,
 * wrap into rows), then the smallest grid whose interior contains the packed
 * block. Min-area-OBB auto-rotation and true nesting are explicitly v2.
 * Everything is centred on the bin origin, which is what makes bin *growth*
 * safe for existing placements: the interior expands symmetrically around
 * them.
 */

/** New pockets have no extra clearance; retain one printable divider plus epsilon. */
const ITEM_GAP_MM = D_DIV + 0.01;

/**
 * Margin between a cutout's outline and the interior wall: wall clearance,
 * the stacking lip's intrusion when present, and 1 mm of slack so a freshly
 * placed shape starts clear of the lip-collision warning band.
 */
export function placementInsetMm(lip: BinSpec["lip"], clearanceMm = 0): number {
  return D_WALL + clearanceMm + (lip === "standard" ? STACKING_LIP_DEPTH - D_WALL : 0) + 1;
}

/** Anything with a footprint the packer can shelve. */
interface PackTarget {
  key: string;
  widthMm: number;
  heightMm: number;
}

interface PackedItem {
  key: string;
  /** Centre of this item's box, relative to the packed block's centre. */
  x: number;
  y: number;
}

interface PackedBlock {
  items: PackedItem[];
  widthMm: number;
  heightMm: number;
}

/** Shelf-packs targets (largest first) into rows no wider than `maxWidthMm`. */
function shelfPack(targets: readonly PackTarget[], maxWidthMm: number): PackedBlock {
  const sorted = [...targets].sort(
    (a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm,
  );

  interface Row {
    items: { target: PackTarget; x: number }[];
    widthMm: number;
    heightMm: number;
  }
  const rows: Row[] = [];
  let current: Row = { items: [], widthMm: 0, heightMm: 0 };

  for (const target of sorted) {
    const w = target.widthMm;
    const h = target.heightMm;
    const nextWidth = current.widthMm + (current.items.length > 0 ? ITEM_GAP_MM : 0) + w;
    if (current.items.length > 0 && nextWidth > maxWidthMm) {
      rows.push(current);
      current = { items: [], widthMm: 0, heightMm: 0 };
    }
    const x = current.widthMm + (current.items.length > 0 ? ITEM_GAP_MM : 0) + w / 2;
    current.items.push({ target, x });
    current.widthMm = x + w / 2;
    current.heightMm = Math.max(current.heightMm, h);
  }
  if (current.items.length > 0) rows.push(current);

  const blockWidth = Math.max(...rows.map((row) => row.widthMm));
  const blockHeight =
    rows.reduce((sum, row) => sum + row.heightMm, 0) + ITEM_GAP_MM * (rows.length - 1);

  // Rows stack top-down; centre every item on the block's own centre.
  const items: PackedItem[] = [];
  let yTop = blockHeight / 2;
  for (const row of rows) {
    const rowCentreY = yTop - row.heightMm / 2;
    for (const item of row.items) {
      items.push({
        key: item.target.key,
        x: item.x - row.widthMm / 2,
        y: rowCentreY,
      });
    }
    yTop -= row.heightMm + ITEM_GAP_MM;
  }

  return { items, widthMm: blockWidth, heightMm: blockHeight };
}

/** Shapes pack by their axis-aligned bbox (fresh placement keeps rotation 0). */
function shapeTargets(shapes: readonly TracedShape[]): PackTarget[] {
  return shapes.map((shape) => ({
    key: shape.id,
    widthMm: shape.bboxMm.maxX - shape.bboxMm.minX,
    heightMm: shape.bboxMm.maxY - shape.bboxMm.minY,
  }));
}

/** Candidate grids ordered by cell count, then by squareness. */
function gridCandidates(minX = 1, minY = 1): { gridX: number; gridY: number }[] {
  const candidates: { gridX: number; gridY: number }[] = [];
  for (let gx = minX; gx <= MAX_GRID; gx++) {
    for (let gy = minY; gy <= MAX_GRID; gy++) {
      candidates.push({ gridX: gx, gridY: gy });
    }
  }
  return candidates.sort(
    (a, b) =>
      a.gridX * a.gridY - b.gridX * b.gridY ||
      Math.abs(a.gridX - a.gridY) - Math.abs(b.gridX - b.gridY),
  );
}

function interiorMm(
  grid: { gridX: number; gridY: number },
  inset: number,
  gridPitch: GridPitch = "full",
) {
  return {
    widthMm: binFootprintMm(grid.gridX, gridPitch) - 2 * inset,
    heightMm: binFootprintMm(grid.gridY, gridPitch) - 2 * inset,
  };
}

/** A placement with the schema defaults, centred at the item position. */
function toPlacement(
  item: PackedItem,
  shapesById: ReadonlyMap<string, TracedShape>,
  offsetX: number,
  offsetY: number,
): CutoutPlacement {
  const shape = shapesById.get(item.key)!;
  const centre = {
    x: (shape.bboxMm.minX + shape.bboxMm.maxX) / 2,
    y: (shape.bboxMm.minY + shape.bboxMm.maxY) / 2,
  };
  return cutoutPlacementSchema.parse({
    id: `cutout-${shape.id}-${Math.random().toString(36).slice(2, 8)}`,
    shapeId: shape.id,
    // The shape's outline is bbox-centred at ~0; compensate for any residue
    // so the *bbox* centre lands exactly on the packed position.
    position: { x: item.x + offsetX - centre.x, y: item.y + offsetY - centre.y },
  });
}

export interface AutoPlaceResult {
  cutouts: CutoutPlacement[];
  gridX: number;
  gridY: number;
  /** True when nothing fit even at MAX_GRID; placements are still returned. */
  overflow: boolean;
}

/**
 * Places `shapes` into a fresh bin: shelf-packs them, then picks the smallest
 * grid whose interior holds the block, centred on the bin origin.
 */
export function autoPlaceFresh(
  shapes: readonly TracedShape[],
  lip: BinSpec["lip"],
  gridPitch: GridPitch = "full",
): AutoPlaceResult {
  if (shapes.length === 0) {
    return { cutouts: [], gridX: 1, gridY: 1, overflow: false };
  }
  const inset = placementInsetMm(lip);
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const targets = shapeTargets(shapes);

  for (const grid of gridCandidates()) {
    const interior = interiorMm(grid, inset, gridPitch);
    if (interior.widthMm <= 0 || interior.heightMm <= 0) continue;
    const block = shelfPack(targets, interior.widthMm);
    if (block.widthMm <= interior.widthMm && block.heightMm <= interior.heightMm) {
      return {
        cutouts: block.items.map((item) => toPlacement(item, byId, 0, 0)),
        gridX: grid.gridX,
        gridY: grid.gridY,
        overflow: false,
      };
    }
  }

  // Nothing fits even at MAX_GRID: return the biggest bin and let the
  // validation rules paint the problem rather than silently dropping shapes.
  const block = shelfPack(
    targets,
    interiorMm({ gridX: MAX_GRID, gridY: MAX_GRID }, inset, gridPitch).widthMm,
  );
  return {
    cutouts: block.items.map((item) => toPlacement(item, byId, 0, 0)),
    gridX: MAX_GRID,
    gridY: MAX_GRID,
    overflow: true,
  };
}

/** Union bounds of existing cutters at the top surface, or null when none. */
function existingBounds(
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
): Bounds | null {
  let bounds: Bounds | null = null;
  const includePoint = (point: Point, allowanceMm: number) => {
    const pointBounds = {
      minX: point.x - allowanceMm,
      minY: point.y - allowanceMm,
      maxX: point.x + allowanceMm,
      maxY: point.y + allowanceMm,
    };
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, pointBounds.minX),
          minY: Math.min(bounds.minY, pointBounds.minY),
          maxX: Math.max(bounds.maxX, pointBounds.maxX),
          maxY: Math.max(bounds.maxY, pointBounds.maxY),
        }
      : pointBounds;
  };
  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    if (!shape) continue;
    const footprint = placementFootprint(shape, cutout);
    const outlineAllowance = cutout.clearanceMm + cutout.topFilletMm;
    for (const part of footprint.outline) {
      for (const point of part.outer) includePoint(point, outlineAllowance);
    }
    for (const ring of footprint.features) {
      for (const point of ring) {
        includePoint(point, 0);
      }
    }
  }
  return bounds;
}

export interface AutoPlaceIncrementalOptions {
  lip: BinSpec["lip"];
  gridPitch?: GridPitch;
  gridX: number;
  gridY: number;
  existing: readonly CutoutPlacement[];
  shapesById: ReadonlyMap<string, TracedShape>;
}

/**
 * Places new shapes into a bin that already has user-arranged cutouts,
 * without moving them: packs the newcomers as a block and tries the free
 * strips beside/above/below the occupied region, growing the grid when
 * nothing fits. Growth is safe because the frame is centre-origin.
 */
export function autoPlaceIncremental(
  shapes: readonly TracedShape[],
  options: AutoPlaceIncrementalOptions,
): AutoPlaceResult {
  const occupied = existingBounds(options.existing, options.shapesById);
  if (!occupied) {
    const fresh = autoPlaceFresh(shapes, options.lip, options.gridPitch);
    return {
      ...fresh,
      gridX: Math.max(fresh.gridX, options.gridX),
      gridY: Math.max(fresh.gridY, options.gridY),
    };
  }
  if (shapes.length === 0) {
    return {
      cutouts: [],
      gridX: options.gridX,
      gridY: options.gridY,
      overflow: false,
    };
  }

  const inset = placementInsetMm(options.lip);
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const targets = shapeTargets(shapes);

  for (const grid of gridCandidates(options.gridX, options.gridY)) {
    const interior = interiorMm(grid, inset, options.gridPitch);
    const halfW = interior.widthMm / 2;
    const halfH = interior.heightMm / 2;

    // Free strips around the occupied region, largest first.
    const strips = [
      // Right / left of the occupied block, full interior height.
      { minX: occupied.maxX + ITEM_GAP_MM, maxX: halfW, minY: -halfH, maxY: halfH },
      { minX: -halfW, maxX: occupied.minX - ITEM_GAP_MM, minY: -halfH, maxY: halfH },
      // Above / below it, full interior width.
      { minX: -halfW, maxX: halfW, minY: occupied.maxY + ITEM_GAP_MM, maxY: halfH },
      { minX: -halfW, maxX: halfW, minY: -halfH, maxY: occupied.minY - ITEM_GAP_MM },
    ]
      .map((strip) => ({
        ...strip,
        width: strip.maxX - strip.minX,
        height: strip.maxY - strip.minY,
      }))
      .filter((strip) => strip.width > 0 && strip.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);

    for (const strip of strips) {
      const block = shelfPack(targets, strip.width);
      if (block.widthMm <= strip.width && block.heightMm <= strip.height) {
        const cx = strip.minX + strip.width / 2;
        const cy = strip.minY + strip.height / 2;
        return {
          cutouts: block.items.map((item) => toPlacement(item, byId, cx, cy)),
          gridX: grid.gridX,
          gridY: grid.gridY,
          overflow: false,
        };
      }
    }
  }

  // Give up gracefully: drop the block to the right of everything.
  const block = shelfPack(targets, Number.POSITIVE_INFINITY);
  const cx = occupied.maxX + ITEM_GAP_MM + block.widthMm / 2;
  return {
    cutouts: block.items.map((item) => toPlacement(item, byId, cx, 0)),
    gridX: MAX_GRID,
    gridY: Math.max(options.gridY, 1),
    overflow: true,
  };
}

/**
 * Recentres the occupied layout and returns the smallest grid that contains
 * it with the standard inset. Relative placement, rotation and pocket options
 * are preserved. Recentering is essential after removal: otherwise a survivor
 * from a previously larger layout can remain off-centre and falsely require
 * the old grid size.
 */
export function fitLayoutToPlacements(
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  lip: BinSpec["lip"],
  gridPitch: GridPitch = "full",
): { cutouts: CutoutPlacement[]; gridX: number; gridY: number } {
  const bounds = existingBounds(cutouts, shapesById);
  if (!bounds) return { cutouts: [...cutouts], gridX: 1, gridY: 1 };

  // Cutter bounds already include each pocket's clearance and top round.
  const inset = placementInsetMm(lip, 0);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const halfWNeeded = (bounds.maxX - bounds.minX) / 2 + inset;
  const halfHNeeded = (bounds.maxY - bounds.minY) / 2 + inset;

  const fit = (halfNeeded: number): number => {
    for (let cells = 1; cells <= MAX_GRID; cells++) {
      if (binFootprintMm(cells, gridPitch) / 2 >= halfNeeded) return cells;
    }
    return MAX_GRID;
  };
  return {
    cutouts: cutouts.map((cutout) => ({
      ...cutout,
      position: {
        x: cutout.position.x - centreX,
        y: cutout.position.y - centreY,
      },
    })),
    gridX: fit(halfWNeeded),
    gridY: fit(halfHNeeded),
  };
}

// ---------------------------------------------------------------------------
// Auto-arrange (min-area OBB rotation + shelf packing)
// ---------------------------------------------------------------------------

interface ArrangeItem {
  cutout: CutoutPlacement;
  /** Rotation that lays the shape (and its features) down in landscape. */
  rotationDeg: number;
  /** OBB centre in the pre-rotation local frame (mirror applied). */
  obbCentre: Point;
  widthMm: number;
  heightMm: number;
}

/**
 * The measured footprint of one cutout at rotation 0 (mirror kept): outline
 * *and* feature circles, because a finger hole protruding from the outline
 * still needs floor space next to its neighbour.
 */
function arrangeItem(
  cutout: CutoutPlacement,
  shape: TracedShape,
): ArrangeItem {
  const local = placementFootprint(shape, {
    ...cutout,
    position: { x: 0, y: 0 },
    rotationDeg: 0,
  });
  const points: Point[] = [];
  for (const s of local.outline) {
    points.push(...s.outer);
  }
  for (const feature of local.features) {
    points.push(...feature);
  }
  const obb = minAreaObb(points);
  return {
    cutout,
    rotationDeg: obb.angleDeg,
    obbCentre: obb.center,
    widthMm: obb.widthMm,
    heightMm: obb.heightMm,
  };
}

export interface AutoArrangeResult {
  /** The same cutouts (ids kept) with new rotation and position. */
  cutouts: CutoutPlacement[];
  gridX: number;
  gridY: number;
  overflow: boolean;
  footprint?: BinFootprint;
}

const FOOTPRINT_CODES = new Set([
  "out-of-bounds",
  "wall-breach",
  "lip-collision",
  "thin-material",
  "label-tab-edge-missing",
]);

/**
 * Deterministically prunes safe boundary cells. The result is minimal under
 * another single-cell removal; this deliberately avoids pretending to be a
 * global nesting solver.
 */
export function trimFootprintToPlacements(
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  spec: BinSpec,
): BinFootprint {
  let cells = rectangleCells(spec.gridX, spec.gridY);
  const bounds = existingBounds(cutouts, shapesById);
  const centre = bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    : { x: 0, y: 0 };
  let changed = true;
  while (changed && cells.length > 1) {
    changed = false;
    const ordered = [...cells].sort((a, b) => {
      const ca = cellCenterMm(spec, a);
      const cb = cellCenterMm(spec, b);
      return Math.hypot(cb.x - centre.x, cb.y - centre.y) -
        Math.hypot(ca.x - centre.x, ca.y - centre.y) ||
        b.y - a.y || b.x - a.x;
    });
    for (const cell of ordered) {
      const candidateCells = cells.filter((item) => item.x !== cell.x || item.y !== cell.y);
      if (footprintTopologyError(spec.gridX, spec.gridY, candidateCells)) continue;
      const candidate = parseBinSpec({
        ...spec,
        footprint: { kind: "custom", cells: canonicalCells(candidateCells) },
      });
      const issues = [
        ...validateBinSpec(candidate).issues,
        ...validateLayout(candidate, cutouts, shapesById),
      ];
      if (issues.some((issue) => FOOTPRINT_CODES.has(issue.code))) continue;
      cells = candidateCells;
      changed = true;
      break;
    }
  }
  return cells.length === spec.gridX * spec.gridY
    ? { kind: "rectangle" }
    : { kind: "custom", cells: canonicalCells(cells) };
}

export function fitFootprintToPlacements(
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  spec: BinSpec,
): { cutouts: CutoutPlacement[]; gridX: number; gridY: number; footprint: BinFootprint } {
  const fitted = fitLayoutToPlacements(cutouts, shapesById, spec.lip, spec.gridPitch);
  const fittedSpec = parseBinSpec({
    ...spec,
    gridX: fitted.gridX,
    gridY: fitted.gridY,
    footprint: { kind: "rectangle" },
  });
  return {
    ...fitted,
    footprint: trimFootprintToPlacements(fitted.cutouts, shapesById, fittedSpec),
  };
}

/**
 * Re-lays out *existing* cutouts: each one is rotated to its min-area OBB
 * (features included), shelf-packed, and centred in the smallest grid that
 * holds the block. Depth, clearance, features and mirroring are preserved;
 * only rotation and position change — same ids, so selection and undo
 * behave.
 */
export function autoArrangeLayout(
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  lip: BinSpec["lip"],
  gridPitch: GridPitch = "full",
  baseSpec?: BinSpec,
): AutoArrangeResult | null {
  const items: ArrangeItem[] = [];
  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    if (!shape) return null; // dangling reference: let validation surface it
    items.push(arrangeItem(cutout, shape));
  }
  if (items.length === 0) return null;

  const byKey = new Map(items.map((item) => [item.cutout.id, item]));
  const targets: PackTarget[] = items.map((item) => ({
    key: item.cutout.id,
    widthMm: item.widthMm,
    heightMm: item.heightMm,
  }));
  const inset = placementInsetMm(lip);

  const placeBlock = (block: PackedBlock): CutoutPlacement[] =>
    block.items.map((packed) => {
      const item = byKey.get(packed.key)!;
      // The packed point is where the rotated OBB centre must land:
      // position = packed − R(θ)·centre.
      const radians = (item.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const cx = item.obbCentre.x * cos - item.obbCentre.y * sin;
      const cy = item.obbCentre.x * sin + item.obbCentre.y * cos;
      return {
        ...item.cutout,
        rotationDeg: item.rotationDeg,
        position: { x: packed.x - cx, y: packed.y - cy },
      };
    });

  for (const grid of gridCandidates()) {
    const interior = interiorMm(grid, inset, gridPitch);
    if (interior.widthMm <= 0 || interior.heightMm <= 0) continue;
    const block = shelfPack(targets, interior.widthMm);
    if (block.widthMm <= interior.widthMm && block.heightMm <= interior.heightMm) {
      const placed = placeBlock(block);
      const arrangedSpec = baseSpec
        ? parseBinSpec({
            ...baseSpec,
            gridX: grid.gridX,
            gridY: grid.gridY,
            footprint: { kind: "rectangle" },
          })
        : null;
      return {
        cutouts: placed,
        gridX: grid.gridX,
        gridY: grid.gridY,
        overflow: false,
        ...(arrangedSpec
          ? { footprint: trimFootprintToPlacements(placed, shapesById, arrangedSpec) }
          : {}),
      };
    }
  }

  const block = shelfPack(
    targets,
    interiorMm({ gridX: MAX_GRID, gridY: MAX_GRID }, inset, gridPitch).widthMm,
  );
  return {
    cutouts: placeBlock(block),
    gridX: MAX_GRID,
    gridY: MAX_GRID,
    overflow: true,
  };
}
