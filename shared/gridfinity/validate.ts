import {
  distanceToSegment,
  ringBounds,
  pointInRing,
} from "../geometry/rings";
import type { Bounds, Outline, Point, Ring } from "../geometry/types";
import {
  edgeForWall,
  footprintInteriorRingMm,
  footprintOuterRingMm,
  isBoundaryEdge,
  signedDistanceToFootprintRing,
  resolveBoundaryRun,
} from "./footprint";
import {
  effectiveFingerHoleDepthMm,
  fingerHoleFootprintRing,
  placementFootprint,
  pocketName,
  pocketLayoutAllowanceMm,
  resolvePocketDepth,
  pocketDepths,
  signedDistanceToInterior,
  type CutoutPlacement,
  type FingerHole,
  type TracedShape,
} from "./cutout";
import {
  BASE_HEIGHT,
  BASE_PROFILE_HEIGHT,
  hasStackingLip,
  infillTopAllowanceMm,
  binHeightMm,
  binWallHeightMm,
  D_DIV,
  binWallThicknessMm,
  gridPitchMm,
  STACKING_LIP_DEPTH,
  STACKING_LIP_SUPPORT_HEIGHT,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
  TAB_DEPTH_MM,
  TAB_HEIGHT_MM,
  TAB_WIDTH_NOMINAL_MM,
  binFootprintMm,
} from "./standard";
import type { BinSpec } from "./types";
import { resolvePocketSplit } from "./pocket-split";
import { hasBaseMagnets, baseMagnetSizeError } from "./magnets";
import { hasOverlappingLid, overlapRimInteriorClearanceMm, lidPadExtentMm, magneticLidError } from "./magnetic-lid";

/**
 * Pure validation of a bin specification — no WASM, cheap enough to run on
 * every keystroke. Schema-level shape errors (non-integer grid, unsupported
 * height step, or out-of-range size) are zod's job in `types.ts`; this module
 * judges *geometry* that is representable but unwise or unbuildable.
 *
 * Severity contract (from the plan): errors block export, warnings do not.
 * The issue list will grow substantially with cutouts (out-of-bounds,
 * wall-breach, lip-collision, …); keep codes kebab-case and stable, because
 * the UI will key off them.
 */

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** Cutout(s) the issue is about, for per-cutout highlighting in the editor. */
  cutoutIds?: string[];
  /** Independent finger access object(s) the issue is about. */
  fingerHoleIds?: string[];
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** True when nothing blocks building/exporting this spec. */
  ok: boolean;
}

/**
 * Conservative depth check for floor colors reaching an underside recess.
 * The ordinary underside rises to the bridge at BASE_PROFILE_HEIGHT;
 * full-pitch screw bores can reach BASE_HEIGHT. Actual exposure
 * also depends on where the pocket overlaps those features, so this is a
 * warning, not a claim that every affected pocket has an exposed color face.
 * Pass zero when floor coloring is disabled. Like the builder, the colored
 * volume extends down from the resolved floor and stops at z = 0.
 */
export function validatePocketFloorMaterials(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  floorColorThicknessMm: number,
): ValidationIssue[] {
  if (spec.flatBottom || spec.fill !== "solid" || !Number.isFinite(floorColorThicknessMm) || floorColorThicknessMm <= 0) return [];

  const hasScrewBores = spec.screwHoles && spec.gridPitch === "full";
  const undersideHeightMm = hasScrewBores ? BASE_HEIGHT : BASE_PROFILE_HEIGHT;
  const recess = hasScrewBores ? "the screw holes" : "the recesses between the base feet";
  const issues: ValidationIssue[] = [];
  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    for (const depth of pocketDepths(cutout)) {
      const { floorZ, depthMm } = resolvePocketDepth(spec, depth);
      // Invalid and through pockets have no printable floor-color volume.
      if (!shape || floorZ === null || floorZ <= 0 || depthMm === null || depthMm <= 0) continue;
      const thicknessMm = Math.min(floorColorThicknessMm, floorZ);
      if (floorZ - thicknessMm > undersideHeightMm + 1e-6) continue;
      issues.push({
        code: "floor-color-on-underside",
        severity: "warning",
        cutoutIds: [cutout.id],
        message:
          `“${pocketName(cutout, shape)}”: Floor color may show on the underside. ` +
          `The ${thicknessMm.toFixed(2)} mm color layer reaches ${recess}. ` +
          `Reduce pocket depth, increase the remaining floor, or use a thinner color layer.`,
      });
      break;
    }
  }
  return issues;
}

/** Print beds this side of a Voron 350 top out around here. */
const FOOTPRINT_WARN_MM = 260;

export function validateBinSpec(spec: BinSpec): ValidationResult {
  const issues: ValidationIssue[] = [];
  const sizeError = hasBaseMagnets(spec) ? baseMagnetSizeError(spec) : null;
  if (sizeError) issues.push({ code: "magnet-size-unavailable", severity: "error", message: sizeError });
  const lidError = magneticLidError(spec);
  if (lidError) issues.push({ code: "magnetic-lid-unavailable", severity: "error", message: lidError });
  if (hasOverlappingLid(spec) && spec.magneticLidTop === "stacking") {
    issues.push({
      code: "overlap-stacking-filled-lid",
      severity: "warning",
      message: "Overlapping lids with stacking tops currently require a filled lid for printability. The underside is filled automatically, using more material and interior space.",
    });
  }
  const wallHeight = binWallHeightMm(spec.heightUnits);

  if (hasStackingLip(spec) && wallHeight < STACKING_LIP_SUPPORT_HEIGHT_MM) {
    issues.push({
      code: "lip-support-clipped",
      severity: "warning",
      message:
        `A ${spec.heightUnits}u bin leaves only ${wallHeight.toFixed(1)} mm of wall; ` +
        `the stacking lip's ${STACKING_LIP_SUPPORT_HEIGHT_MM} mm support is clipped ` +
        `and the lip will be weaker than the spec intends.`,
    });
  }

  if (spec.fill === "solid") {
    const lipAllowance = infillTopAllowanceMm(spec);
    const fillHeight = wallHeight - lipAllowance;
    if (fillHeight <= 0) {
      issues.push({
        code: "no-infill-space",
        severity: "warning",
        message:
          `A ${spec.heightUnits}u bin has no room above the ${BASE_HEIGHT} mm base ` +
          `for solid fill; the bin will build as if fill were "none".`,
      });
    }
  }

  for (const [axis, cells] of [
    ["x", spec.gridX],
    ["y", spec.gridY],
  ] as const) {
    const span = binFootprintMm(cells, spec.gridPitch);
    const pitchMm = gridPitchMm(spec.gridPitch);
    if (span > FOOTPRINT_WARN_MM) {
      issues.push({
        code: "large-footprint",
        severity: "warning",
        message:
          `${cells} ${spec.gridPitch}-pitch cells along ${axis} is ${span.toFixed(1)} mm ` +
          `(${cells} × ${pitchMm} − gap) — check it fits the print bed.`,
      });
    }
  }

  if (!spec.flatBottom && spec.gridPitch !== "full" && (spec.magnetHoles || spec.screwHoles)) {
    issues.push({
      code: "fractional-grid-holes",
      severity: "warning",
      message:
        "Magnet and screw holes are not supported on half/quarter-grid sockets yet — the holes are ignored.",
    });
  }

  if (
    spec.labelTab &&
    binHeightMm(spec.heightUnits) - TAB_HEIGHT_MM < BASE_HEIGHT
  ) {
    issues.push({
      code: "label-tab-clipped",
      severity: "warning",
      message:
        `A ${spec.heightUnits}u bin is shorter than the ${TAB_HEIGHT_MM.toFixed(1)} mm ` +
        `label tab — the tab reaches down into the base and will look truncated.`,
    });
  }

  if (spec.labelTab?.edge && !isBoundaryEdge(spec, spec.labelTab.edge)) {
    issues.push({
      code: "label-tab-edge-missing",
      severity: "error",
      message: "The selected label-tab edge is no longer part of the bin footprint.",
    });
  }

  return { issues, ok: issues.every((issue) => issue.severity !== "error") };
}

/**
 * Footprint strip the label tab hangs over, in bin-frame mm — or null
 * without a tab. Exported for the layout editor to paint later; validation
 * uses it to warn when a pocket mouth sits in the tab's shadow.
 */
export function labelTabStripMm(spec: BinSpec): Bounds | null {
  const tab = spec.labelTab;
  if (!tab) return null;

  const edge = tab.edge ?? edgeForWall(spec, tab.wall);
  const run = resolveBoundaryRun(spec, edge);
  if (!run) return null;
  const horizontal = edge.side === "north" || edge.side === "south";
  const chord = run.lengthMm - 2 * binWallThicknessMm(spec);
  const length = tab.width === "full" ? chord : Math.min(TAB_WIDTH_NOMINAL_MM, chord);
  const alongStart =
    tab.width === "left"
      ? -chord / 2
      : tab.width === "right"
        ? chord / 2 - length
        : -length / 2;
  const alongEnd = alongStart + length;
  const midpoint = {
    x: (run.start.x + run.end.x) / 2,
    y: (run.start.y + run.end.y) / 2,
  };
  if (edge.side === "north") midpoint.y -= binWallThicknessMm(spec);
  else if (edge.side === "south") midpoint.y += binWallThicknessMm(spec);
  else if (edge.side === "east") midpoint.x -= binWallThicknessMm(spec);
  else midpoint.x += binWallThicknessMm(spec);
  const localCorners: Point[] = [
    { x: alongStart, y: 0 },
    { x: alongEnd, y: 0 },
    { x: alongEnd, y: -TAB_DEPTH_MM },
    { x: alongStart, y: -TAB_DEPTH_MM },
  ];
  const angle = edge.side === "north" ? 0 : edge.side === "east" ? -90 : edge.side === "south" ? 180 : 90;
  const radians = angle * Math.PI / 180;
  const corners = localCorners.map((point) => ({
    x: midpoint.x + point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: midpoint.y + point.x * Math.sin(radians) + point.y * Math.cos(radians),
  }));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    maxX: Math.max(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

// ---------------------------------------------------------------------------
// Layout validation (cutouts)
// ---------------------------------------------------------------------------

/** Six slicer layers at 0.2 mm — below this a pocket floor flexes. */
const MIN_FLOOR_MM = 1.2;

interface PlacedCutout {
  cutout: CutoutPlacement;
  shape: TracedShape;
  outline: Outline;
  /** Finger access and scoop rims — cut at exact size, no fit clearance. */
  features: Ring[];
  /** Outline rings plus feature rings: everything this placement removes. */
  rings: Ring[];
  bounds: Bounds;
  label: string;
}

/**
 * Validates cutout placements against the bin — pure and cheap enough to run
 * on every drag frame. Vertex checks against the interior are *exact*: the
 * interior rounded rectangle is convex, so a polygon lies inside iff all of
 * its vertices do.
 *
 * Rule inventory follows the design doc: out-of-bounds, wall-breach,
 * lip-collision, thin-material, cutout-overlap, too-deep / too-shallow,
 * floor-too-thin (+ floor-in-base with magnet holes), through-island, and
 * uncalibrated-scale as defence-in-depth behind the Add-to-bin gate.
 */
export function validateLayout(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  fingerHoles: readonly FingerHole[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (cutouts.length === 0 && fingerHoles.length === 0) return issues;

  if (spec.fill !== "solid") {
    issues.push({
      code: "cutouts-require-solid-fill",
      severity: "error",
      message: "Cutouts need material to cut into — switch the bin to solid fill.",
    });
  }

  const placed: PlacedCutout[] = [];
  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    if (!shape) {
      issues.push({
        code: "missing-shape",
        severity: "error",
        message: `Cutout ${cutout.id} references a shape that no longer exists.`,
        cutoutIds: [cutout.id],
      });
      continue;
    }
    if (shape.sourceMmPerPx === null && shape.source !== "basic-shape") {
      issues.push({
        code: "uncalibrated-scale",
        severity: "error",
        message:
          `“${pocketName(cutout, shape)}” was traced without a scale — its real size is unknown. ` +
          `Re-trace with a calibration.`,
        cutoutIds: [cutout.id],
      });
    }

    const { outline, features } = placementFootprint(shape, cutout);
    const rings: Ring[] = [];
    let bounds: Bounds | null = null;
    const addBounds = (b: Bounds | null) => {
      if (!b) return;
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, b.minX),
            minY: Math.min(bounds.minY, b.minY),
            maxX: Math.max(bounds.maxX, b.maxX),
            maxY: Math.max(bounds.maxY, b.maxY),
          }
        : b;
    };
    for (const s of outline) {
      rings.push(s.outer, ...s.holes);
      addBounds(ringBounds(s.outer));
    }
    for (const feature of features) {
      rings.push(feature);
      addBounds(ringBounds(feature));
    }
    if (!bounds) continue;
    placed.push({ cutout, shape, outline, features, rings, bounds, label: pocketName(cutout, shape) });
  }

  for (const p of placed) {
    issues.push(...validateAgainstBin(spec, p));
    if (touchesLidSupport(spec, p.outline, pocketLayoutAllowanceMm(p.cutout))) {
      issues.push({ code: "lid-support-collision", severity: "error", cutoutIds: [p.cutout.id],
        message: `“${p.label}” reaches a lid magnet support. Move it away from the corners or turn off Magnetic lid.` });
    }
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const issue = validatePair(placed[i], placed[j]);
      if (issue) issues.push(issue);
    }
  }

  for (const [index, hole] of fingerHoles.entries()) {
    issues.push(...validateFingerHoleAgainstBin(spec, hole, index));
    const ring = fingerHoleFootprintRing(hole, { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false });
    if (touchesLidSupport(spec, [{ outer: ring, holes: [] }], hole.topFilletMm)) {
      issues.push({ code: "lid-support-collision", severity: "error", fingerHoleIds: [hole.id],
        message: `Finger hole ${index + 1} reaches a lid magnet support. Move it away from the corners or turn off Magnetic lid.` });
    }
  }

  // A pocket mouth under the label tab: legal geometry, but the tab shadows
  // the opening and the tool may not come out past it.
  const tabStrip = labelTabStripMm(spec);
  if (tabStrip) {
    for (const p of placed) {
      const overlaps =
        p.bounds.minX < tabStrip.maxX &&
        p.bounds.maxX > tabStrip.minX &&
        p.bounds.minY < tabStrip.maxY &&
        p.bounds.maxY > tabStrip.minY;
      if (overlaps) {
        issues.push({
          code: "label-tab-shadow",
          severity: "warning",
          cutoutIds: [p.cutout.id],
          message: `“${p.label}” sits under the label tab — the tab may block inserting or removing the tool.`,
        });
      }
    }
  }
  return issues;
}

function validateAgainstBin(spec: BinSpec, p: PlacedCutout): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { cutout, label } = p;

  const halfW = binFootprintMm(spec.gridX, spec.gridPitch) / 2;
  const halfL = binFootprintMm(spec.gridY, spec.gridPitch) / 2;
  const outerBoundary = spec.footprint.kind === "custom" ? footprintOuterRingMm(spec) : null;
  const outside = outerBoundary
    ? p.rings.some((ring) => !ringInsideBoundary(ring, outerBoundary))
    : p.bounds.minX < -halfW ||
      p.bounds.maxX > halfW ||
      p.bounds.minY < -halfL ||
      p.bounds.maxY > halfL;
  if (outside) {
    issues.push({
      code: "out-of-bounds",
      severity: "error",
      cutoutIds: [cutout.id],
      message: `“${label}” extends past the bin's footprint.`,
    });
  }

  // Exact because the interior is convex: min over vertices is the polygon
  // min. The outline gets its fit clearance and top-surface round-over added.
  // `features` is an empty compatibility collection for legacy placements.
  const interiorBoundary = spec.footprint.kind === "custom"
    ? footprintInteriorRingMm(spec)
    : null;
  let minDistOutline = Infinity;
  for (const s of p.outline) {
    const d = interiorBoundary
      ? ringSignedClearance(s.outer, interiorBoundary)
      : Math.min(...s.outer.map((point) => signedDistanceToInterior(point, spec)));
    if (d < minDistOutline) minDistOutline = d;
  }
  let minDistFeature = Infinity;
  for (const feature of p.features) {
    const d = interiorBoundary
      ? ringSignedClearance(feature, interiorBoundary)
      : Math.min(...feature.map((point) => signedDistanceToInterior(point, spec)));
    if (d < minDistFeature) minDistFeature = d;
  }
  const outlineAllowance = pocketLayoutAllowanceMm(cutout);
  const wallMargin = Math.min(minDistOutline - outlineAllowance, minDistFeature);
  const rimMargin = hasOverlappingLid(spec) ? Math.min(
    ...p.outline.flatMap(shape => shape.outer.map(point => overlapRimInteriorClearanceMm(point, spec) - outlineAllowance)),
    ...p.features.flatMap(ring => ring.map(point => overlapRimInteriorClearanceMm(point, spec))),
  ) : Infinity;

  if (wallMargin < 0) {
    issues.push({
      code: "wall-breach",
      severity: "error",
      cutoutIds: [cutout.id],
      message: `“${label}” cuts into the bin wall once its ${outlineAllowance} mm combined clearance and top-edge round are added.`,
    });
  } else if (rimMargin < 0) {
    issues.push({ code: "lid-rim-collision", severity: "error", cutoutIds: [cutout.id],
      message: `“${label}” cuts into the inset lid rim. Move it farther from the edge.` });
  } else if (hasStackingLip(spec) && wallMargin < Math.max(0, STACKING_LIP_DEPTH - binWallThicknessMm(spec))) {
    issues.push({
      code: "lip-collision",
      severity: "warning",
      cutoutIds: [cutout.id],
      message: `“${label}” is legal at depth but fouls the stacking lip's ${STACKING_LIP_DEPTH} mm overhang at the rim.`,
    });
  } else if (wallMargin < D_DIV) {
    issues.push({
      code: "thin-material",
      severity: "warning",
      cutoutIds: [cutout.id],
      message: `“${label}” leaves less than ${D_DIV} mm of material against the wall.`,
    });
  }

  const split = cutout.split ? resolvePocketSplit(p.shape.outlineMm, cutout.split.boundary) : null;
  if (split?.error) issues.push({
    code: "invalid-pocket-split", severity: "error", cutoutIds: [cutout.id],
    message: `“${label}”: ${split.error}`,
  });
  for (const [index, depth] of pocketDepths(cutout).entries()) {
    const label = cutout.split ? `${p.label} · Section ${index === 0 ? "A" : "B"}` : p.label;
    const pocket = resolvePocketDepth(spec, depth);
    if (pocket.floorZ !== null) {
      if (pocket.floorZ < 0) {
        issues.push({
          code: "too-deep",
          severity: "error",
          cutoutIds: [cutout.id],
          message: `“${label}” is deeper than the bin itself.`,
        });
      } else if (pocket.depthMm !== null && pocket.depthMm <= 0) {
        issues.push({
          code: "too-shallow",
          severity: "error",
          cutoutIds: [cutout.id],
          message: `“${label}” has no depth — its floor sits at or above the fill surface.`,
        });
      } else {
        if (pocket.floorZ < MIN_FLOOR_MM) {
          issues.push({
            code: "floor-too-thin",
            severity: "warning",
            cutoutIds: [cutout.id],
            message: `“${label}” leaves a ${pocket.floorZ.toFixed(1)} mm floor — likely to flex or delaminate.`,
          });
        }
        if (!spec.flatBottom && spec.magnetHoles && pocket.floorZ < BASE_HEIGHT) {
          issues.push({
            code: "floor-in-base",
            severity: "warning",
            cutoutIds: [cutout.id],
            message: `“${label}” reaches into the base, where the magnet holes live.`,
          });
        }
      }
    } else {
      const region = split?.regions?.[index] ?? p.shape.outlineMm;
      const hasHoles = region.some((s) => s.holes.length > 0);
      if (hasHoles) {
        issues.push({
          code: "through-island",
          severity: "error",
          cutoutIds: [cutout.id],
          message:
            `“${label}” has interior holes: cutting it through leaves the island ` +
            `floating loose. Use a blind pocket instead.`,
        });
      }
    }
  }

  return issues;
}

function validateFingerHoleAgainstBin(
  spec: BinSpec,
  hole: FingerHole,
  index: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const label = `Finger access ${index + 1}`;
  const ring = fingerHoleFootprintRing(
    hole,
    { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false },
  );
  const bounds = ringBounds(ring);
  if (!bounds) return issues;
  const topAllowanceMm = hole.topFilletMm;

  const halfW = binFootprintMm(spec.gridX, spec.gridPitch) / 2;
  const halfL = binFootprintMm(spec.gridY, spec.gridPitch) / 2;
  const outerBoundary =
    spec.footprint.kind === "custom" ? footprintOuterRingMm(spec) : null;
  const outside = outerBoundary
    ? ringSignedClearance(ring, outerBoundary) < topAllowanceMm
    : bounds.minX - topAllowanceMm < -halfW ||
      bounds.maxX + topAllowanceMm > halfW ||
      bounds.minY - topAllowanceMm < -halfL ||
      bounds.maxY + topAllowanceMm > halfL;
  if (outside) {
    issues.push({
      code: "finger-hole-out-of-bounds",
      severity: "error",
      fingerHoleIds: [hole.id],
      message: `${label} extends past the bin's footprint.`,
    });
  }

  const interiorBoundary =
    spec.footprint.kind === "custom" ? footprintInteriorRingMm(spec) : null;
  const wallMargin =
    (interiorBoundary
      ? ringSignedClearance(ring, interiorBoundary)
      : Math.min(...ring.map((point) => signedDistanceToInterior(point, spec)))) -
    topAllowanceMm;
  const rimMargin = hasOverlappingLid(spec)
    ? Math.min(...ring.map(point => overlapRimInteriorClearanceMm(point, spec))) - topAllowanceMm
    : Infinity;
  if (wallMargin < 0) {
    issues.push({
      code: "finger-hole-wall-breach",
      severity: "error",
      fingerHoleIds: [hole.id],
      message: `${label} cuts into the bin wall.`,
    });
  } else if (rimMargin < 0) {
    issues.push({ code: "lid-rim-collision", severity: "error", fingerHoleIds: [hole.id],
      message: `${label} cuts into the inset lid rim. Move it farther from the edge.` });
  } else if (hasStackingLip(spec) && wallMargin < Math.max(0, STACKING_LIP_DEPTH - binWallThicknessMm(spec))) {
    issues.push({
      code: "finger-hole-lip-collision",
      severity: "warning",
      fingerHoleIds: [hole.id],
      message: `${label} fouls the stacking lip's ${STACKING_LIP_DEPTH} mm overhang.`,
    });
  } else if (wallMargin < D_DIV) {
    issues.push({
      code: "finger-hole-thin-material",
      severity: "warning",
      fingerHoleIds: [hole.id],
      message: `${label} leaves less than ${D_DIV} mm of material against the wall.`,
    });
  }

  const surface = resolvePocketDepth(spec, { mode: "mm", value: hole.depthMm });
  const cutDepth = effectiveFingerHoleDepthMm(hole);
  const bottomZ = surface.infillTopZ - cutDepth;
  if (bottomZ < 0) {
    issues.push({
      code: "finger-hole-too-deep",
      severity: "error",
      fingerHoleIds: [hole.id],
      message: `${label} is deeper than the bin itself.`,
    });
  } else if (bottomZ < MIN_FLOOR_MM) {
    issues.push({
      code: "finger-hole-floor-too-thin",
      severity: "warning",
      fingerHoleIds: [hole.id],
      message: `${label} leaves a ${bottomZ.toFixed(1)} mm floor — likely to flex or delaminate.`,
    });
  }
  return issues;
}

/** Conservative plan clearance for the full pad; the worker also checks the actual 3D cutters. */
function touchesLidSupport(spec: BinSpec, outline: Outline, allowance: number): boolean {
  if (!spec.magneticLid || !spec.lidMagnetHoles || magneticLidError(spec)) return false;
  const halfW = binFootprintMm(spec.gridX, spec.gridPitch) / 2;
  const halfL = binFootprintMm(spec.gridY, spec.gridPitch) / 2;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = sx * halfW;
    const y = sy * halfL;
    const pad: Ring = [{ x, y }, { x: x - sx * lidPadExtentMm(spec), y },
      { x: x - sx * lidPadExtentMm(spec), y: y - sy * lidPadExtentMm(spec) },
      { x, y: y - sy * lidPadExtentMm(spec) }];
    for (const shape of outline) {
      if (shape.holes.some(hole => ringInsideBoundary(pad, hole) && ringSeparation(pad, hole) > Math.max(0, allowance))) continue;
      if (shape.outer.some(point => pointInRing(pad, point)) || pad.some(point => pointInRing(shape.outer, point))) return true;
      for (let i = 0; i < shape.outer.length; i++) for (let j = 0; j < pad.length; j++) {
        if (segmentsIntersect(shape.outer[i], shape.outer[(i + 1) % shape.outer.length], pad[j], pad[(j + 1) % pad.length])) return true;
      }
      if (Math.min(ringSeparation(shape.outer, pad), ringSeparation(pad, shape.outer)) <= Math.max(0, allowance)) return true;
    }
  }
  return false;
}

function ringInsideBoundary(ring: Ring, boundary: Ring): boolean {
  if (ring.some((point) => signedDistanceToFootprintRing(point, boundary) < -1e-7)) {
    return false;
  }
  for (let i = 0; i < ring.length; i++) {
    for (let j = 0; j < boundary.length; j++) {
      if (segmentsIntersect(
        ring[i],
        ring[(i + 1) % ring.length],
        boundary[j],
        boundary[(j + 1) % boundary.length],
      )) return false;
    }
  }
  return true;
}

function ringSignedClearance(ring: Ring, boundary: Ring): number {
  return ringInsideBoundary(ring, boundary)
    ? ringSeparation(ring, boundary)
    : -ringSeparation(ring, boundary);
}

/** Orientation-based proper segment intersection (touching counts). */
function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function validatePair(a: PlacedCutout, b: PlacedCutout): ValidationIssue | null {
  const edgeAllowance =
    pocketLayoutAllowanceMm(a.cutout) + pocketLayoutAllowanceMm(b.cutout);
  const warnGap = edgeAllowance + D_DIV;

  // Cheap reject: bboxes further apart than the warning threshold.
  const gapX = Math.max(
    a.bounds.minX - b.bounds.maxX,
    b.bounds.minX - a.bounds.maxX,
  );
  const gapY = Math.max(
    a.bounds.minY - b.bounds.maxY,
    b.bounds.minY - a.bounds.maxY,
  );
  if (Math.max(gapX, gapY) > warnGap) return null;

  // Edge crossings and containment mean the outlines themselves overlap.
  let overlapping = false;
  outer: for (const ringA of a.rings) {
    for (const ringB of b.rings) {
      const nA = ringA.length;
      const nB = ringB.length;
      for (let i = 0; i < nA; i++) {
        const a1 = ringA[i];
        const a2 = ringA[(i + 1) % nA];
        for (let j = 0; j < nB; j++) {
          if (segmentsIntersect(a1, a2, ringB[j], ringB[(j + 1) % nB])) {
            overlapping = true;
            break outer;
          }
        }
      }
    }
  }
  if (!overlapping) {
    // No crossings: one may still sit wholly inside the other.
    const aInB = b.outline.some((s) => pointInRing(s.outer, a.rings[0][0]));
    const bInA = a.outline.some((s) => pointInRing(s.outer, b.rings[0][0]));
    overlapping = aInB || bInA;
  }

  if (overlapping) {
    return {
      code: "cutout-overlap",
      severity: "error",
      message: `“${a.label}” and “${b.label}” overlap.`,
      cutoutIds: [a.cutout.id, b.cutout.id],
    };
  }

  // Disjoint: measure the actual separation (vertex-to-edge both ways).
  let separation = Infinity;
  for (const ringA of a.rings) {
    for (const ringB of b.rings) {
      separation = Math.min(
        separation,
        ringSeparation(ringA, ringB),
        ringSeparation(ringB, ringA),
      );
      if (separation === 0) break;
    }
  }

  if (separation < edgeAllowance) {
    return {
      code: "cutout-overlap",
      severity: "error",
      message: `“${a.label}” and “${b.label}” merge once their clearances and top-edge rounds are added.`,
      cutoutIds: [a.cutout.id, b.cutout.id],
    };
  }
  if (separation < warnGap) {
    return {
      code: "thin-material",
      severity: "warning",
      message: `“${a.label}” and “${b.label}” leave less than ${D_DIV} mm of material between them.`,
      cutoutIds: [a.cutout.id, b.cutout.id],
    };
  }
  return null;
}

function ringSeparation(from: Ring, to: Ring): number {
  let best = Infinity;
  const n = to.length;
  for (const point of from) {
    for (let i = 0; i < n; i++) {
      const d = distanceToSegment(point, to[i], to[(i + 1) % n]);
      if (d < best) best = d;
    }
  }
  return best;
}
