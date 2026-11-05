import type { Bounds, Point, Ring } from "../geometry/types";
import { clipRingToConvex, pointInRing, ringBounds, signedArea } from "../geometry/rings";
import { compartmentHeightMm, compartmentLabelTabPlacements } from "./compartments";
import { edgeForWall, footprintInsetRingMm, footprintInteriorRingMm, footprintOuterRingMm, resolveBoundaryRun } from "./footprint";
import { boundaryLabelTabProfileMm, labelTabRecessMm, labelTabFrontRimWidthMm, labelTabWidthMm } from "./label-tab";
import { BASE_HEIGHT, binHeightMm, binWallHeightMm, D_WALL, stackingLipReachMm } from "./standard";
import type { BinSpec } from "./types";
import { wallSlantHeightMm, wallSlantOutlineMm } from "./wall-slant";
import { surfaceTextPositionSchema, surfaceTextSurface } from "./surface-text";

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
  rotationDeg: 0 | 90;
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
  return placements.flatMap<LabelTabSurface>(({ x, y, start, length, depth, rotation, key }) => {
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

/** Where lettering of one height can stand on a shelf, seen from above. */
export interface LabelTabWritingArea {
  /** The shelf's clip, or the stacking lip's inner face where it overhangs the lettering. */
  clip: Ring;
  /** Bounds of the shelf inside `clip`. */
  bounds: Bounds;
}

/**
 * A stacking lip overhangs the shelf edges beside the outer walls: compartment
 * shelves sit just below its vertical inner face, boundary shelves beside it.
 * Keep lettering inside the lip over its whole height, shelf top to shelf top +
 * `textHeightMm`. Null when the lip covers the whole shelf. This guides new
 * placement and the offsets of labels that follow a moving shelf; the solid
 * build stays authoritative and saved labels are never moved to suit it.
 */
export function labelTabWritingArea(spec: BinSpec, surface: LabelTabSurface, textHeightMm: number): LabelTabWritingArea | null {
  if (spec.lip === "standard") {
    const rim = BASE_HEIGHT + binWallHeightMm(spec.heightUnits);
    const reach = stackingLipReachMm(surface.z - rim, surface.z + textHeightMm - rim);
    // Compartment shelves are clipped at the outer face, boundary shelves at the inner wall face.
    const clipInset = spec.labelTab?.scope === "compartments" && spec.fill === "none" ? 0 : D_WALL;
    if (reach > clipInset) {
      const clip = wallSlantOutlineMm(spec, footprintInsetRingMm(spec, reach), surface.z);
      const bounds = ringBounds(clipRingToConvex(clip, surface.ring));
      return bounds && { clip, bounds };
    }
  }
  // Without an overhang, keep the shelf's own bounds as placement always has.
  return { clip: surface.clip, bounds: ringBounds(surface.ring)! };
}

/** True when `point` is on the shelf and inside its writing area's clip. */
export function pointInLabelTabWritingArea(point: Point, surface: LabelTabSurface, area: LabelTabWritingArea): boolean {
  return pointInRing(surface.ring, point) && pointInRing(area.clip, point);
}

/** Writing-area bounds, or the whole shelf when a lip covers all of it. */
const writingBounds = (spec: BinSpec, surface: LabelTabSurface, textHeightMm: number): Bounds | null =>
  labelTabWritingArea(spec, surface, textHeightMm)?.bounds ?? ringBounds(surface.ring);

/**
 * Keep each label on the same shelf when shelves move: the same sub-bin
 * (row, column) or the single outer tab, preserving its offset from the centre
 * of the shelf's writing area (clear of a stacking lip). Covers recess edits on
 * slanted walls and sub-bin grid changes.
 * Text remains rigid, at its authored size and rotation. A label whose shelf
 * no longer exists, or turned 90°, stays where it is and remembers its old
 * shelf, so the build reports it even if another shelf occupies that position.
 * Restoring the old shelf restores its placement; manual moves clear the anchor.
 * Returns `next.surfaceTexts` itself when placement and ownership are unchanged.
 */
export function moveTextsWithLabelTabs(previous: BinSpec, next: BinSpec): BinSpec["surfaceTexts"] {
  if (!next.surfaceTexts.length) return next.surfaceTexts;
  const before = labelTabSurfaces(previous);
  const after = new Map(labelTabSurfaces(next).map(surface => [surface.key, surface]));
  let moved = false;
  const texts = next.surfaceTexts.map(label => {
    if (surfaceTextSurface(previous, label) !== "label-tab" || surfaceTextSurface(next, label) !== "label-tab") return label;
    if (label.orphanedTab) {
      const anchor = label.orphanedTab, to = after.get(anchor.key);
      if (!to || to.rotationDeg !== anchor.rotationDeg) return label;
      const bounds = writingBounds(next, to, label.heightMm);
      if (!bounds) return label;
      const position = surfaceTextPositionSchema.safeParse({
        x: (bounds.minX + bounds.maxX) / 2 + anchor.offset.x,
        y: (bounds.minY + bounds.maxY) / 2 + anchor.offset.y,
      });
      // Imported anchors must not turn a valid label position into an invalid document.
      if (!position.success) return label;
      const { orphanedTab: _anchor, ...restored } = label;
      moved = true;
      return { ...restored, position: position.data };
    }
    const from = before.find(surface => pointOnLabelTab(label.position, surface));
    const to = from && after.get(from.key);
    if (!from) return label;
    const a = writingBounds(previous, from, label.heightMm);
    if (!a) return label;
    if (!to || to.rotationDeg !== from.rotationDeg) {
      moved = true;
      return { ...label, orphanedTab: { key: from.key, rotationDeg: from.rotationDeg,
        offset: { x: label.position.x - (a.minX + a.maxX) / 2, y: label.position.y - (a.minY + a.maxY) / 2 } } };
    }
    const b = writingBounds(next, to, label.heightMm);
    if (!b) return label;
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
  if (!next.surfaceTexts.some(label => surfaceTextSurface(next, label) === "label-tab")) return next.surfaceTexts;
  const follow = (from: BinSpec, to: BinSpec, texts: BinSpec["surfaceTexts"]) => shelfInputs(from) === shelfInputs(to)
    ? texts : moveTextsWithLabelTabs(from, withTabSizeOf({ ...to, surfaceTexts: texts }, from.labelTab));
  const source = sameLabels(follow(committed, current, committed.surfaceTexts), current.surfaceTexts) ? committed : current;
  const placements = new Map(follow(source, next, source.surfaceTexts).map(label => [label.id, label]));
  // Take only placement and shelf ownership: parsing `next` may have retargeted other fields.
  let changed = false;
  const texts = next.surfaceTexts.map(label => {
    const placement = placements.get(label.id);
    if (!placement || (Math.abs(placement.position.x - label.position.x) < 1e-9 && Math.abs(placement.position.y - label.position.y) < 1e-9
      && JSON.stringify(placement.orphanedTab) === JSON.stringify(label.orphanedTab))) return label;
    changed = true;
    const { orphanedTab: _anchor, ...rest } = label;
    return { ...rest, position: placement.position, ...(placement.orphanedTab ? { orphanedTab: placement.orphanedTab } : {}) };
  });
  return changed ? texts : next.surfaceTexts;
}
