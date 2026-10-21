import { labelTabProfileMm } from "./label-tab";
import { STACKING_LIP_SUPPORT_HEIGHT, TAB_WIDTH_NOMINAL_MM } from "./standard";
import type { Ring } from "../geometry/types";
import type { BinSpec } from "./types";
import { binWidthMm, binLengthMm } from "./bin-size";
import { binWallHeightMm, binWallThicknessMm } from "./standard";

/** Bounds the number of generated divider strips and scoop profiles. */
export const MAX_COMPARTMENTS_PER_AXIS = 32;

/** Match Rebuilt's infill ceiling so the next bin's feet clear internal walls. */
export function compartmentHeightMm(spec: BinSpec): number {
  return Math.max(0, binWallHeightMm(spec.heightUnits) - (spec.lip === "standard" ? STACKING_LIP_SUPPORT_HEIGHT : 0));
}

/** Older designs enable their saved grid; explicit off retains its dimensions. */
export function compartmentsEnabled(spec: BinSpec): boolean {
  return spec.compartments.enabled ?? (spec.compartments.rows > 1 || spec.compartments.columns > 1);
}

/** Equal clear spans, with divider material accounted for between compartments. */
export function compartmentLayout(spec: BinSpec) {
  const { dividerThicknessMm: thickness } = spec.compartments;
  const enabled = compartmentsEnabled(spec);
  const rows = enabled ? spec.compartments.rows : 1;
  const columns = enabled ? spec.compartments.columns : 1;
  const wall = binWallThicknessMm(spec);
  const width = binWidthMm(spec), length = binLengthMm(spec);
  const innerWidth = width - 2 * wall, innerLength = length - 2 * wall;
  const cellWidth = (innerWidth - (columns - 1) * thickness) / columns;
  const cellLength = (innerLength - (rows - 1) * thickness) / rows;
  const columnCenters = Array.from({ length: columns - 1 }, (_, i) =>
    -innerWidth / 2 + (i + 1) * (cellWidth + thickness) - thickness / 2);
  const rowCenters = Array.from({ length: rows - 1 }, (_, i) =>
    -innerLength / 2 + (i + 1) * (cellLength + thickness) - thickness / 2);
  const rowFronts = Array.from({ length: rows }, (_, i) => -innerLength / 2 + i * (cellLength + thickness));
  const columnFronts = Array.from({ length: columns }, (_, i) => -innerWidth / 2 + i * (cellWidth + thickness));
  // Leaning toward +axis makes the +axis floor/wall angle obtuse, and vice versa.
  const slant = spec.wallSlant;
  const scoopAxis = slant && slant.angleDeg !== 0 ? slant.axis : "y";
  const scoopSide = slant && slant.angleDeg > 0 ? 1 : -1;
  const scoopSpan = scoopAxis === "x" ? cellWidth : cellLength;
  const scoopWalls = (scoopAxis === "x" ? columnFronts : rowFronts).map(start => start + (scoopSide > 0 ? scoopSpan : 0));
  const scoopRadius = Math.max(0, Math.min(compartmentHeightMm(spec) / 2, scoopSpan / 2));
  const scoopWall = scoopAxis === "x" ? scoopSide > 0 ? "right" : "left" : scoopSide > 0 ? "back" : "front";
  return { width, length, cellWidth, cellLength, thickness, columnCenters, rowCenters, rowFronts, columnFronts,
    scoopRadius, scoopAxis, scoopSide, scoopWalls, scoopWall };
}

export function hasCompartments(spec: BinSpec): boolean {
  return (compartmentsEnabled(spec) && (spec.compartments.rows > 1 || spec.compartments.columns > 1)) || spec.compartments.scoop;
}

/** Geometry errors stay recoverable while the user edits dimensions or fill. */
export function compartmentLayoutError(spec: BinSpec): string | null {
  if (spec.fill !== "none" || !hasCompartments(spec)) return null;
  if (compartmentHeightMm(spec) <= 0) return "Increase bin height to make room for dividers or scoop bottoms below the rim.";
  const layout = compartmentLayout(spec);
  if (Math.min(layout.cellWidth, layout.cellLength) < 1) {
    return "Sub-bins need at least 1 mm of clear width and length. Use fewer rows or columns, thinner walls, or a larger bin.";
  }
  return null;
}

/** Unclipped divider footprints, shared by the layout view and solid builder. */
export function dividerStripRings(spec: BinSpec): Ring[] {
  if (spec.fill !== "none" || compartmentLayoutError(spec)) return [];
  const { width, length, thickness, columnCenters, rowCenters } = compartmentLayout(spec);
  const rect = (x: number, y: number, w: number, h: number): Ring => [
    { x: x - w / 2, y: y - h / 2 }, { x: x + w / 2, y: y - h / 2 },
    { x: x + w / 2, y: y + h / 2 }, { x: x - w / 2, y: y + h / 2 },
  ];
  return [...columnCenters.map(x => rect(x, 0, thickness, length)),
    ...rowCenters.map(y => rect(0, y, width, thickness))];
}

/** Tab placements in upright bin coordinates, reused by solids and collision warnings. */
export function compartmentLabelTabPlacements(spec: BinSpec) {
  const tab = spec.labelTab, profile = labelTabProfileMm(spec);
  if (!tab || tab.scope !== "compartments" || spec.fill !== "none" || !profile || compartmentLayoutError(spec)) return [];
  const { cellWidth, cellLength, columnFronts, rowFronts } = compartmentLayout(spec);
  const horizontal = tab.wall === "north" || tab.wall === "south";
  const chord = horizontal ? cellWidth : cellLength;
  const length = tab.width === "full" ? chord : Math.min(TAB_WIDTH_NOMINAL_MM, chord);
  const start = tab.width === "left" ? -chord / 2 : tab.width === "right" ? chord / 2 - length : -length / 2;
  const depth = Math.min(profile.depthMm, (horizontal ? cellLength : cellWidth) / 2);
  const rotation = tab.wall === "north" ? 0 : tab.wall === "east" ? -90 : tab.wall === "south" ? 180 : 90;
  return rowFronts.flatMap(y => columnFronts.map(x => ({
    x: tab.wall === "west" ? x : tab.wall === "east" ? x + cellWidth : x + cellWidth / 2,
    y: tab.wall === "south" ? y : tab.wall === "north" ? y + cellLength : y + cellLength / 2,
    start, length, depth, rotation, profile,
  })));
}
