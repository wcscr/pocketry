import { BASE_HEIGHT, binHeightMm, binWallThicknessMm, D_WALL } from "./standard";
import { binWidthMm, binLengthMm } from "./bin-size";
import type { Point } from "../geometry/types";
import type { BinSpec } from "./types";

/** Displacement of a tilted wall at this height above the fixed base. */
export function wallSlantOffsetMm(spec: Pick<BinSpec, "wallSlant">, zMm: number): { x: number; y: number } {
  const slant = spec.wallSlant;
  if (!slant) return { x: 0, y: 0 };
  const offset = (zMm - BASE_HEIGHT) * Math.tan(slant.angleDeg * Math.PI / 180);
  return slant.axis === "x" ? { x: offset, y: 0 } : { x: 0, y: offset };
}

export function wallSlantTopOffsetMm(spec: Pick<BinSpec, "wallSlant" | "heightUnits">): { x: number; y: number } {
  return wallSlantOffsetMm(spec, binHeightMm(spec.heightUnits));
}

function transitionSpanMm(spec: BinSpec): number {
  const span = spec.wallSlant?.axis === "x" ? binWidthMm(spec) : binLengthMm(spec);
  return Math.max(D_WALL, span - 2 * binWallThicknessMm(spec));
}

/** Single-wall slants keep both faces of the opposite wall upright. The
 * connecting sides taper between the two walls, retaining a horizontal rim. */
export function wallSlantPointMm(spec: BinSpec, point: Point, zMm: number): Point {
  const slant = spec.wallSlant;
  if (!slant) return point;
  const offset = wallSlantOffsetMm(spec, zMm);
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

export function wallSlantError(spec: BinSpec): string | null {
  const slant = spec.wallSlant;
  if (!slant?.side || slant.side === "both") return null;
  const offset = wallSlantTopOffsetMm(spec)[slant.axis];
  const remaining = transitionSpanMm(spec) + (slant.side === "positive" ? offset : -offset);
  return remaining <= D_WALL
    ? "The tilted wall reaches the opposite wall. Reduce the inward angle or increase the bin size."
    : null;
}
