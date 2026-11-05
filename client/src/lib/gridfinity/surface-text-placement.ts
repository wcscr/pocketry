import type { Point, Ring } from "@shared/geometry/types";
import { pointInRing, ringBounds } from "@shared/geometry/rings";
import {
  fingerHoleFootprintRing, pocketLayoutAllowanceMm, pocketOccupiedOutline, signedDistanceToInterior,
  type CutoutPlacement, type FingerHole, type TracedShape,
} from "@shared/gridfinity/cutout";
import { infillTopZ } from "@shared/gridfinity/fill";
import { footprintInteriorRingMm, signedDistanceToFootprintRing } from "@shared/gridfinity/footprint";
import { labelTabSurfaces } from "@shared/gridfinity/label-tab-surfaces";
import { STACKING_LIP_DEPTH, D_WALL } from "@shared/gridfinity/standard";
import { surfaceTextSurface, type SurfaceText } from "@shared/gridfinity/surface-text";
import type { BinSpec } from "@shared/gridfinity/types";
import { wallSlantOutlineMm } from "@shared/gridfinity/wall-slant";
import { outlineBounds } from "@/lib/geometry/outline";
import { surfaceTextOutline } from "./surface-text";

/** Clearance kept around new lettering, from pockets, labels and the walls. */
const MARGIN_MM = 1.5;
/** How far the stacking lip overhangs the inner wall face (see validate.ts). */
const LIP_INTRUSION_MM = STACKING_LIP_DEPTH - D_WALL;
/** Upper bound on candidate positions, so very large bins stay instant. */
const MAX_CANDIDATES = 2500;

/** Something on the fill surface that text must not overlap, grown by `growMm`. */
export interface SurfaceTextObstacle { ring: Ring; growMm: number }

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Rectangle/polygon overlap: a vertex inside, containment, or crossing edges. */
function rectOverlapsRing(rect: Rect, ring: Ring, ringRect: Rect): boolean {
  if (rect.maxX < ringRect.minX || rect.minX > ringRect.maxX || rect.maxY < ringRect.minY || rect.minY > ringRect.maxY) return false;
  const corners = [
    { x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY },
  ];
  if (ring.some(p => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY)) return true;
  if (corners.some(corner => pointInRing(ring, corner))) return true;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let j = 0; j < 4; j++) if (segmentsIntersect(a, b, corners[j], corners[(j + 1) % 4])) return true;
  }
  return false;
}

/**
 * Start new solid-surface text at the first clear spot, scanning from the
 * front edge toward the back and from the centre outward, so it does not land
 * on a pocket. The label's bounding box is tested against `obstacles` (see
 * `surfaceTextObstacles`) and kept inside the walls and stacking lip. This is
 * a fast 2D estimate; the worker's solid check stays authoritative and reports
 * any remaining conflict. Labels on label tabs, and hollow bins, are returned
 * unchanged, as is the label when no clear spot exists.
 */
export function placeSurfaceTextOnSurface(spec: BinSpec, label: SurfaceText, obstacles: readonly SurfaceTextObstacle[]): SurfaceText {
  if (surfaceTextSurface(spec, label) !== "bin") return label;
  let local;
  try {
    local = outlineBounds(surfaceTextOutline({ ...label, position: { x: 0, y: 0 } }));
  } catch {
    return label;
  }
  if (!local) return label;
  // Lettering sits on the fill: inside the (possibly slanted) walls and clear of the lip's overhang.
  const straight = footprintInteriorRingMm(spec);
  const interiorRing = spec.wallSlant ? wallSlantOutlineMm(spec, straight, infillTopZ(spec)) : straight;
  const exact = !spec.wallSlant && spec.footprint.kind !== "custom";
  const inside = (point: Point) => exact ? signedDistanceToInterior(point, spec) : signedDistanceToFootprintRing(point, interiorRing);
  const wallMargin = MARGIN_MM + (spec.lip === "standard" ? LIP_INTRUSION_MM : 0);
  const blocked = obstacles.flatMap(({ ring, growMm }) => {
    const bounds = ringBounds(ring);
    return bounds && ring.length >= 3 ? [{ ring, bounds, grow: MARGIN_MM + Math.max(0, growMm) }] : [];
  });
  const fits = (center: Point): boolean => {
    const corners = [
      { x: center.x + local.minX, y: center.y + local.minY }, { x: center.x + local.maxX, y: center.y + local.minY },
      { x: center.x + local.maxX, y: center.y + local.maxY }, { x: center.x + local.minX, y: center.y + local.maxY },
    ];
    if (corners.some(corner => inside(corner) < wallMargin)) return false;
    return !blocked.some(({ ring, bounds, grow }) => rectOverlapsRing({
      minX: center.x + local.minX - grow, maxX: center.x + local.maxX + grow,
      minY: center.y + local.minY - grow, maxY: center.y + local.maxY + grow,
    }, ring, bounds));
  };

  const interior = ringBounds(interiorRing);
  if (!interior) return label;
  const halfW = (local.maxX - local.minX) / 2, halfH = (local.maxY - local.minY) / 2;
  const width = interior.maxX - interior.minX, length = interior.maxY - interior.minY;
  const step = Math.max(1, Math.sqrt((width * length) / MAX_CANDIDATES));
  const midX = (interior.minX + interior.maxX) / 2;
  const columns: number[] = [midX];
  for (let dx = step; dx <= width / 2 - halfW; dx += step) columns.push(midX + dx, midX - dx);
  // Text bounds need not be centred on the label origin (symbols, descenders), so offset by them.
  const offsetX = (local.minX + local.maxX) / 2, offsetY = (local.minY + local.maxY) / 2;
  for (let y = interior.minY + halfH; y <= interior.maxY - halfH + 1e-9; y += step) {
    for (const x of columns) {
      const center = { x: x - offsetX, y: y - offsetY };
      if (fits(center)) return { ...label, position: { x: round(center.x), y: round(center.y) } };
    }
  }
  return label;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * What new solid-surface text must avoid: each pocket's conservative occupied
 * outline grown by its layout allowance (clearance and top rounding), finger
 * access, label-tab shelves overhanging the fill, and the bounding boxes of
 * existing solid-surface labels. Pockets whose shape is missing are skipped.
 */
export function surfaceTextObstacles(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapes: readonly TracedShape[],
  fingerHoles: readonly FingerHole[],
): SurfaceTextObstacle[] {
  const obstacles: SurfaceTextObstacle[] = [];
  for (const cutout of cutouts) {
    const shape = shapes.find(item => item.id === cutout.shapeId);
    if (!shape) continue;
    try {
      const growMm = pocketLayoutAllowanceMm(cutout);
      for (const item of pocketOccupiedOutline(shape, cutout, spec)) obstacles.push({ ring: item.outer, growMm });
    } catch {
      // An unbuildable pocket is reported elsewhere; it cannot steer placement.
    }
  }
  for (const hole of fingerHoles) {
    obstacles.push({ ring: fingerHoleFootprintRing(hole, { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false }), growMm: 0 });
  }
  for (const surface of labelTabSurfaces(spec)) obstacles.push({ ring: surface.ring, growMm: 0 });
  for (const other of spec.surfaceTexts) {
    if (surfaceTextSurface(spec, other) !== "bin") continue;
    let bounds;
    try { bounds = outlineBounds(surfaceTextOutline(other)); } catch { continue; }
    if (bounds) obstacles.push({ growMm: 0, ring: [
      { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
    ] });
  }
  return obstacles;
}
