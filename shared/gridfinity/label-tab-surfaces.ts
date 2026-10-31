import type { Point, Ring } from "../geometry/types";
import { pointInRing, ringBounds, signedArea } from "../geometry/rings";
import { compartmentHeightMm, compartmentLabelTabPlacements } from "./compartments";
import { edgeForWall, footprintInteriorRingMm, footprintOuterRingMm, resolveBoundaryRun } from "./footprint";
import { boundaryLabelTabProfileMm, labelTabRecessMm, labelTabFrontRimWidthMm } from "./label-tab";
import { BASE_HEIGHT, binHeightMm, D_WALL, TAB_WIDTH_NOMINAL_MM } from "./standard";
import type { BinSpec } from "./types";
import { wallSlantHeightMm, wallSlantOutlineMm } from "./wall-slant";
import { surfaceTextSurface } from "./surface-text";

/** Shelf tops remain horizontal when the walls lean. */
export function labelTabTopZ(spec: BinSpec): number {
  return (spec.labelTab?.scope === "compartments" && spec.fill === "none"
    ? BASE_HEIGHT + compartmentHeightMm(spec) : binHeightMm(spec.heightUnits)) - labelTabRecessMm(spec);
}

export interface LabelTabSurface {
  ring: Ring;
  /** Rounded/custom boundary that clips the rectangular shelf in Layout. */
  clip: Ring;
  z: number;
  rotationDeg: number;
}

/** Project shelf tops, not their swept undersides, into the text's XY frame.
 * The finished solid remains authoritative for printable support validation. */
export function labelTabSurfaces(spec: BinSpec): LabelTabSurface[] {
  const tab = spec.labelTab;
  if (!tab) return [];
  const z = labelTabTopZ(spec);
  if (z > wallSlantHeightMm(spec) + 1e-8 || z <= BASE_HEIGHT) return [];
  const compartments = tab.scope === "compartments" && spec.fill === "none";
  let placements;
  if (compartments) {
    placements = compartmentLabelTabPlacements(spec);
  } else {
    const profile = boundaryLabelTabProfileMm(spec);
    const edge = tab.edge ?? edgeForWall(spec, tab.wall);
    const run = resolveBoundaryRun(spec, edge);
    if (!profile || !run) return [];
    const chord = run.lengthMm - 2 * D_WALL;
    if (chord <= 0) return [];
    const length = tab.width === "full" ? chord : Math.min(TAB_WIDTH_NOMINAL_MM, chord);
    placements = [{
      x: (run.start.x + run.end.x) / 2 + (edge.side === "west" ? D_WALL : edge.side === "east" ? -D_WALL : 0),
      y: (run.start.y + run.end.y) / 2 + (edge.side === "south" ? D_WALL : edge.side === "north" ? -D_WALL : 0),
      start: tab.width === "left" ? -chord / 2 : tab.width === "right" ? chord / 2 - length : -length / 2,
      length, depth: profile.depthMm,
      rotation: edge.side === "north" ? 0 : edge.side === "east" ? -90 : edge.side === "south" ? 180 : 90,
    }];
  }
  const clip = wallSlantOutlineMm(spec, compartments ? footprintOuterRingMm(spec) : footprintInteriorRingMm(spec), z);
  return placements.flatMap(({ x, y, start, length, depth, rotation }) => {
    depth -= labelTabFrontRimWidthMm(spec, depth);
    const angle = rotation * Math.PI / 180;
    const ring = wallSlantOutlineMm(spec, [
      { x: start, y: 0 }, { x: start + length, y: 0 },
      { x: start + length, y: -depth }, { x: start, y: -depth },
    ].map(p => ({ x: x + p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: y + p.x * Math.sin(angle) + p.y * Math.cos(angle) })), z);
    return Math.abs(signedArea(ring)) < 1e-8 ? [] : [{ ring, clip, z, rotationDeg: Math.abs(rotation) === 90 ? 90 : 0 }];
  });
}

export function pointOnLabelTab(point: Point, surface: LabelTabSurface): boolean {
  return pointInRing(surface.ring, point) && pointInRing(surface.clip, point);
}

/** Keep each label's offset from its shelf centre when a recess edit shifts
 * slanted shelves in XY. Text remains rigid, at its authored size and rotation. */
export function moveTextsWithLabelTabRecess(previous: BinSpec, next: BinSpec): BinSpec["surfaceTexts"] {
  if (labelTabRecessMm(previous) === labelTabRecessMm(next) || !previous.labelTab || !next.labelTab) return next.surfaceTexts;
  const before = labelTabSurfaces(previous), after = labelTabSurfaces(next);
  if (before.length !== after.length) return next.surfaceTexts;
  return next.surfaceTexts.map(label => {
    if (surfaceTextSurface(previous, label) !== "label-tab") return label;
    const index = before.findIndex(surface => pointOnLabelTab(label.position, surface));
    if (index < 0) return label;
    const a = ringBounds(before[index].ring), b = ringBounds(after[index].ring);
    if (!a || !b) return label;
    return { ...label, position: {
      x: label.position.x + (b.minX + b.maxX - a.minX - a.maxX) / 2,
      y: label.position.y + (b.minY + b.maxY - a.minY - a.maxY) / 2,
    } };
  });
}
