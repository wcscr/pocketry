import type { Point, Ring } from "../geometry/types";
import { pointInRing, ringBounds, signedArea } from "../geometry/rings";
import { compartmentHeightMm, compartmentLabelTabPlacements } from "./compartments";
import { edgeForWall, footprintInteriorRingMm, footprintOuterRingMm, resolveBoundaryRun } from "./footprint";
import { boundaryLabelTabProfileMm, labelTabRecessMm, labelTabFrontRimWidthMm, labelTabWidthMm } from "./label-tab";
import { BASE_HEIGHT, binHeightMm, D_WALL } from "./standard";
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
  /** Stable identity across edits: "outer" for the boundary tab, "r{row}c{column}" for sub-bin tabs. */
  key: string;
}

/** Project shelf tops, not their swept undersides, into the text's XY frame.
 * The finished solid remains authoritative for printable support validation. */
export function labelTabSurfaces(spec: BinSpec): LabelTabSurface[] {
  const tab = spec.labelTab;
  if (!tab) return [];
  const z = labelTabTopZ(spec);
  if (z > wallSlantHeightMm(spec) + 1e-8 || z <= BASE_HEIGHT) return [];
  const compartments = tab.scope === "compartments" && spec.fill === "none";
  let placements: { x: number; y: number; start: number; length: number; depth: number; rotation: number; key: string }[];
  if (compartments) {
    placements = compartmentLabelTabPlacements(spec).map(tab => ({ ...tab, key: `r${tab.row}c${tab.column}` }));
  } else {
    const profile = boundaryLabelTabProfileMm(spec);
    const edge = tab.edge ?? edgeForWall(spec, tab.wall);
    const run = resolveBoundaryRun(spec, edge);
    if (!profile || !run) return [];
    const chord = run.lengthMm - 2 * D_WALL;
    if (chord <= 0) return [];
    const length = tab.width === "full" ? chord : Math.min(labelTabWidthMm(spec), chord);
    placements = [{
      x: (run.start.x + run.end.x) / 2 + (edge.side === "west" ? D_WALL : edge.side === "east" ? -D_WALL : 0),
      y: (run.start.y + run.end.y) / 2 + (edge.side === "south" ? D_WALL : edge.side === "north" ? -D_WALL : 0),
      start: tab.width === "left" ? -chord / 2 : tab.width === "right" ? chord / 2 - length : -length / 2,
      length, depth: profile.depthMm,
      rotation: edge.side === "north" ? 0 : edge.side === "east" ? -90 : edge.side === "south" ? 180 : 90,
      key: "outer",
    }];
  }
  const clip = wallSlantOutlineMm(spec, compartments ? footprintOuterRingMm(spec) : footprintInteriorRingMm(spec), z);
  return placements.flatMap(({ x, y, start, length, depth, rotation, key }) => {
    depth -= labelTabFrontRimWidthMm(spec, depth);
    const angle = rotation * Math.PI / 180;
    const ring = wallSlantOutlineMm(spec, [
      { x: start, y: 0 }, { x: start + length, y: 0 },
      { x: start + length, y: -depth }, { x: start, y: -depth },
    ].map(p => ({ x: x + p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: y + p.x * Math.sin(angle) + p.y * Math.cos(angle) })), z);
    return Math.abs(signedArea(ring)) < 1e-8 ? [] : [{ ring, clip, z, rotationDeg: Math.abs(rotation) === 90 ? 90 : 0, key }];
  });
}

export function pointOnLabelTab(point: Point, surface: LabelTabSurface): boolean {
  return pointInRing(surface.ring, point) && pointInRing(surface.clip, point);
}

/**
 * Keep each label on the same shelf when shelves move: the same sub-bin
 * (row, column) or the single outer tab, preserving its offset from the shelf
 * centre. Covers recess edits on slanted walls and sub-bin grid changes.
 * Text remains rigid, at its authored size and rotation. A label whose shelf
 * no longer exists, or turned 90°, stays where it is; the build reports it.
 * Returns `next.surfaceTexts` itself when nothing moves.
 */
export function moveTextsWithLabelTabs(previous: BinSpec, next: BinSpec): BinSpec["surfaceTexts"] {
  if (!previous.labelTab || !next.labelTab || !next.surfaceTexts.length) return next.surfaceTexts;
  const before = labelTabSurfaces(previous);
  if (!before.length) return next.surfaceTexts;
  const after = new Map(labelTabSurfaces(next).map(surface => [surface.key, surface]));
  let moved = false;
  const texts = next.surfaceTexts.map(label => {
    if (surfaceTextSurface(previous, label) !== "label-tab" || surfaceTextSurface(next, label) !== "label-tab") return label;
    const from = before.find(surface => pointOnLabelTab(label.position, surface));
    const to = from && after.get(from.key);
    if (!from || !to || to.rotationDeg !== from.rotationDeg) return label;
    const a = ringBounds(from.ring), b = ringBounds(to.ring);
    if (!a || !b) return label;
    const dx = (b.minX + b.maxX - a.minX - a.maxX) / 2, dy = (b.minY + b.maxY - a.minY - a.maxY) / 2;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return label;
    moved = true;
    return { ...label, position: { x: label.position.x + dx, y: label.position.y + dy } };
  });
  return moved ? texts : next.surfaceTexts;
}

const sameLabels = (a: BinSpec["surfaceTexts"], b: BinSpec["surfaceTexts"]) => a === b || (a.length === b.length && a.every((label, i) => {
  const other = b[i];
  return label.id === other.id && Math.abs(label.position.x - other.position.x) < 1e-6 && Math.abs(label.position.y - other.position.y) < 1e-6
    && JSON.stringify({ ...label, position: null }) === JSON.stringify({ ...other, position: null });
}));

/** Resizing a tab keeps existing text where it is (see Label tab size controls); only shelf moves carry it. */
const withTabSizeOf = (spec: BinSpec, sizing: BinSpec["labelTab"]): BinSpec => spec.labelTab && sizing
  ? { ...spec, labelTab: { ...spec.labelTab, depthMm: sizing.depthMm, widthMm: sizing.widthMm, width: sizing.width, frontRim: sizing.frontRim } }
  : spec;

/** Everything but the labels and their color can move a shelf. */
const shelfInputs = (spec: BinSpec) => JSON.stringify({ ...spec, surfaceTexts: null, textColor: null });

/**
 * Labels after a spec edit: each tab label follows its shelf (same sub-bin)
 * when the grid, recess, slant or bin size moves it. Shelves are matched from
 * the committed (pre-gesture) spec, so a gesture that passes through other
 * grids, such as a slider drag, never strands labels on shelves that existed
 * only mid-gesture. Falls back to the live spec when labels changed
 * independently since that commit. Tab size edits never move text.
 */
export function textsAfterLabelTabEdit(committed: BinSpec, current: BinSpec, next: BinSpec): BinSpec["surfaceTexts"] {
  if (!next.labelTab || !next.surfaceTexts.some(label => surfaceTextSurface(next, label) === "label-tab")) return next.surfaceTexts;
  const follow = (from: BinSpec, to: BinSpec, texts: BinSpec["surfaceTexts"]) => shelfInputs(from) === shelfInputs(to)
    ? texts : moveTextsWithLabelTabs(from, withTabSizeOf({ ...to, surfaceTexts: texts }, from.labelTab));
  const source = sameLabels(follow(committed, current, committed.surfaceTexts), current.surfaceTexts) ? committed : current;
  const positions = new Map(follow(source, next, source.surfaceTexts).map(label => [label.id, label.position]));
  // Take only positions: parsing `next` may have retargeted other fields (e.g. hollow → label tabs).
  let changed = false;
  const texts = next.surfaceTexts.map(label => {
    const position = positions.get(label.id);
    if (!position || (Math.abs(position.x - label.position.x) < 1e-9 && Math.abs(position.y - label.position.y) < 1e-9)) return label;
    changed = true;
    return { ...label, position };
  });
  return changed ? texts : next.surfaceTexts;
}
