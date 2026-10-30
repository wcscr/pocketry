import { BASE_HEIGHT, binHeightMm, binWallThicknessMm, D_WALL } from "./standard";
import { binWidthMm, binLengthMm } from "./bin-size";
import type { Point, Ring } from "../geometry/types";
import type { BinSpec } from "./types";

/** Displacement of a tilted wall at this height above the fixed base. */
export function wallSlantOffsetMm(spec: Pick<BinSpec, "wallSlant">, zMm: number): { x: number; y: number } {
  const slant = spec.wallSlant;
  if (!slant) return { x: 0, y: 0 };
  const offset = (zMm - BASE_HEIGHT) * Math.tan(slant.angleDeg * Math.PI / 180);
  return slant.axis === "x" ? { x: offset, y: 0 } : { x: 0, y: offset };
}

export function wallSlantTopOffsetMm(spec: BinSpec): Point {
  return wallSlantOffsetMm(spec, wallSlantHeightMm(spec));
}

function transitionSpanMm(spec: BinSpec): number {
  const span = spec.wallSlant?.axis === "x" ? binWidthMm(spec) : binLengthMm(spec);
  return Math.max(D_WALL, span - 2 * binWallThicknessMm(spec));
}

/** An inward single-wall slant can close instead of folding through the fixed wall. */
export function wallSlantCloses(spec: BinSpec): boolean {
  const slant = spec.wallSlant;
  if (!slant?.side || slant.side === "both" || binHeightMm(spec.heightUnits) <= BASE_HEIGHT) return false;
  const offset = wallSlantOffsetMm(spec, binHeightMm(spec.heightUnits))[slant.axis];
  return (slant.side === "positive" ? -offset : offset) >= transitionSpanMm(spec);
}

/** The ridge can be lower than the requested height when the outside faces meet. */
export function wallSlantHeightMm(spec: BinSpec): number {
  const requested = binHeightMm(spec.heightUnits);
  const slant = spec.wallSlant;
  if (!slant?.side || slant.side === "both" ||
    (slant.side === "positive" ? slant.angleDeg >= 0 : slant.angleDeg <= 0)) return requested;
  const span = slant.axis === "x" ? binWidthMm(spec) : binLengthMm(spec);
  return Math.min(requested, BASE_HEIGHT + span / Math.abs(Math.tan(slant.angleDeg * Math.PI / 180)));
}

/** Single-wall slants keep both faces of the opposite wall upright. The
 * connecting sides taper between the two walls, retaining a horizontal rim. */
export function wallSlantPointMm(spec: BinSpec, point: Point, zMm: number): Point {
  const slant = spec.wallSlant;
  if (!slant) return point;
  const offset = wallSlantOffsetMm(spec, zMm);
  if (wallSlantCloses(spec)) {
    const half = (slant.axis === "x" ? binWidthMm(spec) : binLengthMm(spec)) / 2;
    const coordinate = point[slant.axis] + offset[slant.axis];
    return { ...point, [slant.axis]: slant.side === "positive"
      ? Math.max(-half, coordinate) : Math.min(half, coordinate) };
  }
  let weight = 1;
  if (slant.side && slant.side !== "both") {
    const span = transitionSpanMm(spec);
    const positiveWeight = Math.max(0, Math.min(1, point[slant.axis] / span + 0.5));
    weight = slant.side === "positive" ? positiveWeight : 1 - positiveWeight;
  }
  return { x: point.x + offset.x * weight, y: point.y + offset.y * weight };
}

/** Includes the fixed base; an inward-slanting wall does not enlarge it. */
export function wallSlantExtraSizeMm(spec: BinSpec): Point {
  const offset = wallSlantTopOffsetMm(spec);
  const side = spec.wallSlant?.side;
  const extra = (value: number) => side === "positive" ? Math.max(0, value)
    : side === "negative" ? Math.max(0, -value) : Math.abs(value);
  return { x: extra(offset.x), y: extra(offset.y) };
}

/** Clip the top-down rim to the fixed wall, including new edge intersections. */
export function wallSlantOutlineMm(spec: BinSpec, ring: Ring, zMm: number): Ring {
  if (!wallSlantCloses(spec) || !spec.wallSlant) return ring.map(point => wallSlantPointMm(spec, point, zMm));
  const slant = spec.wallSlant;
  const offset = wallSlantOffsetMm(spec, zMm);
  const half = (slant.axis === "x" ? binWidthMm(spec) : binLengthMm(spec)) / 2;
  const sign = slant.side === "positive" ? 1 : -1;
  const boundary = -sign * half;
  const moved = ring.map(point => ({ x: point.x + offset.x, y: point.y + offset.y }));
  const clipped: Ring = [];
  for (let i = 0; i < moved.length; i++) {
    const a = moved[i], b = moved[(i + 1) % moved.length];
    const insideA = sign * (a[slant.axis] - boundary) >= -1e-8;
    const insideB = sign * (b[slant.axis] - boundary) >= -1e-8;
    if (insideA) clipped.push(a);
    if (insideA !== insideB) {
      const t = (boundary - a[slant.axis]) / (b[slant.axis] - a[slant.axis]);
      clipped.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return clipped;
}
