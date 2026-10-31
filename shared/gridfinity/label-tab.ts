import type { BinSpec } from "./types";
import type { Point } from "../geometry/types";
import { edgeForWall, resolveBoundaryRun, type CellSide } from "./footprint";
import { wallSlantCloses, wallSlantOffsetMm, wallSlantPointMm } from "./wall-slant";
import {
  BASE_HEIGHT,
  D_WALL,
  TAB_DEPTH_MM,
  TAB_HEIGHT_MM,
  TAB_PROFILE,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_SUPPORT_HEIGHT_MM,
  binWallHeightMm,
} from "./standard";

interface LabelTabProfile {
  depthMm: number;
  heightMm: number;
  points: [number, number][];
  /** The wall itself leans too far to restore the nominal underside angle. */
  supportLimited?: boolean;
}

export const DEFAULT_LABEL_TAB_RECESS_MM = 0.4;

/** Missing values belong to saved designs made before recess was configurable. */
export function labelTabRecessMm(spec: Pick<BinSpec, "labelTab">): number {
  return spec.labelTab?.recessMm ?? 0;
}

/** Place tabs above the acute floor-to-wall angle, opposite the scoops. */
export function defaultLabelTabWall(spec: Pick<BinSpec, "wallSlant">): NonNullable<BinSpec["labelTab"]>["wall"] {
  const slant = spec.wallSlant;
  if (!slant || slant.angleDeg === 0) return "north";
  return slant.axis === "x"
    ? slant.angleDeg > 0 ? "west" : "east"
    : slant.angleDeg > 0 ? "south" : "north";
}

/** Keep slanted or recessed tabs' 36-degree undersides above the fixed base.
 * Legacy flush upright tabs retain their original truncated profile. */
export function labelTabProfileMm(spec: Pick<BinSpec, "heightUnits" | "wallSlant" | "labelTab">,
  mountingHeightMm = binWallHeightMm(spec.heightUnits)): LabelTabProfile | null {
  const recess = labelTabRecessMm(spec);
  const availableHeightMm = mountingHeightMm - recess;
  if (recess > 0 && availableHeightMm <= TAB_SUPPORT_HEIGHT_MM) return null;
  if ((!spec.wallSlant && recess === 0) || availableHeightMm >= TAB_HEIGHT_MM) {
    return { depthMm: TAB_DEPTH_MM, heightMm: TAB_HEIGHT_MM,
      points: TAB_PROFILE.map(([depth, height]) => [depth, height]) };
  }
  if (availableHeightMm <= TAB_SUPPORT_HEIGHT_MM) return null;
  const slope = Math.tan(TAB_SUPPORT_ANGLE_DEG * Math.PI / 180);
  const depthMm = (availableHeightMm - TAB_SUPPORT_HEIGHT_MM) / slope;
  const heightMm = availableHeightMm;
  return {
    depthMm,
    heightMm,
    points: [
      [0, 0],
      [0, heightMm],
      [depthMm, heightMm],
      [depthMm, heightMm - TAB_SUPPORT_HEIGHT_MM],
    ],
  };
}

/** Add support before the body's warp so its final underside is no shallower
 * than the original 36 degrees. Keep the label surface and deepen only the
 * underside. Short bins can carry the support down to the existing floor. */
export function supportedLabelTabProfileMm(spec: BinSpec, profile: LabelTabProfile,
  wall: CellSide, origin: Point, depthMm: number, topMm: number): LabelTabProfile {
  const scaled = { ...profile, depthMm,
    points: profile.points.map(([d, z]) => [d * depthMm / profile.depthMm, z] as [number, number]) };
  if (!spec.wallSlant || spec.wallSlant.angleDeg === 0) return scaled;
  const axis = wall === "north" || wall === "south" ? "y" : "x";
  if (spec.wallSlant.axis !== axis) return scaled;
  const inward = wall === "south" || wall === "west" ? 1 : -1;
  // Closing bodies shear first and clip afterwards; do not use the clamped
  // display coordinate when calculating the profile's pre-clipping support.
  const placed = (point: Point, z: number) => wallSlantCloses(spec)
    ? point[axis] + wallSlantOffsetMm(spec, z)[axis]
    : wallSlantPointMm(spec, point, z)[axis];
  const tipZ = topMm - TAB_SUPPORT_HEIGHT_MM;
  const tip = { ...origin, [axis]: origin[axis] + inward * depthMm };
  const reach = inward * (placed(tip, tipZ) - placed(origin, tipZ));
  const drift = inward * (placed(origin, tipZ) - placed(origin, tipZ - 1));
  const tipDrift = inward * (placed(tip, tipZ) - placed(tip, tipZ - 1));
  // A single-wall warp scales the span as well as shifting it. Its underside
  // has a varying slope; bound both ends, not just the root-to-tip chord.
  const maximumDrift = drift + Math.abs(tipDrift - drift);
  const runPerRise = 1 / Math.tan(TAB_SUPPORT_ANGLE_DEG * Math.PI / 180);
  const availableRise = tipZ - BASE_HEIGHT;
  const nominalRise = profile.heightMm - TAB_SUPPORT_HEIGHT_MM;
  if (reach + maximumDrift * nominalRise <= nominalRise * runPerRise + 1e-8) return scaled;
  const requiredRise = maximumDrift < runPerRise ? reach / (runPerRise - maximumDrift) : Infinity;
  const rise = Math.min(availableRise, requiredRise);
  const heightMm = rise + TAB_SUPPORT_HEIGHT_MM;
  // When the support meets the floor before the wall, its foot spreads along
  // that floor. The base receives the added material without lowering the bin.
  const foot = Math.max(0, (reach + maximumDrift * rise - rise * runPerRise) /
    (1 + Math.abs(tipDrift - drift) * rise / depthMm));
  const supportLimited = foot > depthMm + 1e-8;
  // Do not fill the cavity with a column when even that cannot achieve the
  // support angle. Preserve the existing shelf and report the limitation.
  if (supportLimited) return { ...scaled, supportLimited: true };
  const points: [number, number][] = [[0, 0], [0, heightMm], [depthMm, heightMm], [depthMm, rise]];
  if (foot > 1e-8) points.push([foot, 0]);
  return { depthMm, heightMm, points, supportLimited };
}

/** Same corrected boundary profile for solid construction and collision bounds. */
export function boundaryLabelTabProfileMm(spec: BinSpec): LabelTabProfile | null {
  const profile = labelTabProfileMm(spec), tab = spec.labelTab;
  if (!profile || !tab) return profile;
  const edge = tab.edge ?? edgeForWall(spec, tab.wall);
  const run = resolveBoundaryRun(spec, edge);
  if (!run) return profile;
  const origin = { x: (run.start.x + run.end.x) / 2, y: (run.start.y + run.end.y) / 2 };
  const axis = edge.side === "north" || edge.side === "south" ? "y" : "x";
  origin[axis] += edge.side === "south" || edge.side === "west" ? D_WALL : -D_WALL;
  return supportedLabelTabProfileMm(spec, profile, edge.side, origin, profile.depthMm,
    BASE_HEIGHT + binWallHeightMm(spec.heightUnits) - labelTabRecessMm(spec));
}
