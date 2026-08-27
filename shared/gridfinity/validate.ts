import {
  distanceToSegment,
  ringBounds,
  pointInRing,
} from "../geometry/rings";
import type { Bounds, Outline, Point, Ring } from "../geometry/types";
import {
  effectiveScoopDepthMm,
  placementFootprint,
  resolvePocketDepth,
  signedDistanceToInterior,
  type CutoutPlacement,
  type TracedShape,
} from "./cutout";
import {
  BASE_HEIGHT,
  binHeightMm,
  binWallHeightMm,
  D_DIV,
  D_WALL,
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

/**
 * Pure validation of a bin specification — no WASM, cheap enough to run on
 * every keystroke. Schema-level shape errors (non-integer grid, out-of-range
 * height) are zod's job in `types.ts`; this module judges *geometry* that is
 * representable but unwise or unbuildable.
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
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** True when nothing blocks building/exporting this spec. */
  ok: boolean;
}

/** Print beds this side of a Voron 350 top out around here. */
const FOOTPRINT_WARN_MM = 260;

export function validateBinSpec(spec: BinSpec): ValidationResult {
  const issues: ValidationIssue[] = [];
  const wallHeight = binWallHeightMm(spec.heightUnits);

  if (spec.lip === "standard" && wallHeight < STACKING_LIP_SUPPORT_HEIGHT_MM) {
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
    const lipAllowance = spec.lip === "standard" ? STACKING_LIP_SUPPORT_HEIGHT : 0;
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

  if (spec.liteBase && (spec.magnetHoles || spec.screwHoles)) {
    issues.push({
      code: "lite-base-holes",
      severity: "warning",
      message:
        "Magnet and screw holes are not supported on a lite base yet — the holes are ignored.",
    });
  }

  if (spec.gridPitch !== "full" && (spec.magnetHoles || spec.screwHoles)) {
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

  const interiorW = binFootprintMm(spec.gridX, spec.gridPitch) - 2 * D_WALL;
  const interiorL = binFootprintMm(spec.gridY, spec.gridPitch) - 2 * D_WALL;
  const alongNorth = tab.wall === "north" || tab.wall === "south";
  const faceDist = (alongNorth ? interiorL : interiorW) / 2;
  const chord = alongNorth ? interiorW : interiorL;

  const length = tab.width === "full" ? chord : Math.min(TAB_WIDTH_NOMINAL_MM, chord);
  // Facing the wall from the bin centre, left is the −x end pre-rotation —
  // the same frame the builder uses.
  const startX =
    tab.width === "left"
      ? -chord / 2
      : tab.width === "right"
        ? chord / 2 - length
        : -length / 2;
  const pre: Bounds = {
    minX: startX,
    maxX: startX + length,
    minY: faceDist - TAB_DEPTH_MM,
    maxY: faceDist,
  };

  switch (tab.wall) {
    case "north":
      return pre;
    case "south":
      return { minX: -pre.maxX, maxX: -pre.minX, minY: -pre.maxY, maxY: -pre.minY };
    case "east": // rotate −90°: (x, y) → (y, −x)
      return { minX: pre.minY, maxX: pre.maxY, minY: -pre.maxX, maxY: -pre.minX };
    case "west": // rotate +90°: (x, y) → (−y, x)
      return { minX: -pre.maxY, maxX: -pre.minY, minY: pre.minX, maxY: pre.maxX };
  }
}

// ---------------------------------------------------------------------------
// Layout validation (cutouts)
// ---------------------------------------------------------------------------

/** How far the stacking lip's tip protrudes past the interior boundary. */
const LIP_INTRUSION_MM = STACKING_LIP_DEPTH - D_WALL; // 1.65

/** Six slicer layers at 0.2 mm — below this a pocket floor flexes. */
const MIN_FLOOR_MM = 1.2;

interface PlacedCutout {
  cutout: CutoutPlacement;
  shape: TracedShape;
  outline: Outline;
  /** Finger-hole and scoop rims — cut at exact size, no fit clearance. */
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
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (cutouts.length === 0) return issues;

  if (spec.fill !== "solid") {
    issues.push({
      code: "cutouts-require-solid-fill",
      severity: "error",
      message: "Pockets need material to cut into — switch the bin to solid fill.",
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
    if (shape.sourceMmPerPx === null) {
      issues.push({
        code: "uncalibrated-scale",
        severity: "error",
        message:
          `“${shape.name}” was traced without a scale — its real size is unknown. ` +
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
    placed.push({ cutout, shape, outline, features, rings, bounds, label: shape.name });
  }

  for (const p of placed) {
    issues.push(...validateAgainstBin(spec, p));
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const issue = validatePair(placed[i], placed[j]);
      if (issue) issues.push(issue);
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
  if (
    p.bounds.minX < -halfW ||
    p.bounds.maxX > halfW ||
    p.bounds.minY < -halfL ||
    p.bounds.maxY > halfL
  ) {
    issues.push({
      code: "out-of-bounds",
      severity: "error",
      cutoutIds: [cutout.id],
      message: `“${label}” extends past the bin's footprint.`,
    });
  }

  // Exact because the interior is convex: min over vertices is the polygon
  // min. The outline gets its fit clearance and top-surface round-over added;
  // feature circles are cut at their drawn size, so their allowance is zero.
  let minDistOutline = Infinity;
  for (const s of p.outline) {
    for (const point of s.outer) {
      const d = signedDistanceToInterior(point, spec);
      if (d < minDistOutline) minDistOutline = d;
    }
  }
  let minDistFeature = Infinity;
  for (const feature of p.features) {
    for (const point of feature) {
      const d = signedDistanceToInterior(point, spec);
      if (d < minDistFeature) minDistFeature = d;
    }
  }
  const outlineAllowance = cutout.clearanceMm + cutout.topFilletMm;
  const wallMargin = Math.min(minDistOutline - outlineAllowance, minDistFeature);

  if (wallMargin < 0) {
    issues.push({
      code: "wall-breach",
      severity: "error",
      cutoutIds: [cutout.id],
      message: `“${label}” cuts into the bin wall once its ${outlineAllowance} mm combined clearance and top-edge round are added.`,
    });
  } else if (spec.lip === "standard" && wallMargin < LIP_INTRUSION_MM) {
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

  const pocket = resolvePocketDepth(spec, cutout.depth);
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
      if (spec.magnetHoles && pocket.floorZ < BASE_HEIGHT) {
        issues.push({
          code: "floor-in-base",
          severity: "warning",
          cutoutIds: [cutout.id],
      message: `“${label}” reaches into the base, where the magnet holes live.`,
        });
      }
      if (spec.liteBase && pocket.floorZ <= BASE_HEIGHT) {
        issues.push({
          code: "lite-base-floor",
          severity: "warning",
          cutoutIds: [cutout.id],
          message: `“${label}”'s floor rests on the hollow lite base — it may open into the base cavities.`,
        });
      }
    }
  } else {
    const hasHoles = p.shape.outlineMm.some((s) => s.holes.length > 0);
    if (hasHoles) {
      issues.push({
        code: "through-island",
        severity: "error",
        message:
          `“${label}” has interior holes: cutting it through leaves the island ` +
          `floating loose. Use a blind pocket instead.`,
      });
    }
  }

  // Scoop-style finger holes cut from the top surface regardless of pocket
  // depth, so each gets its own floor arithmetic.
  for (const hole of cutout.fingerHoles) {
    if (hole.kind !== "scoop") continue;
    const scoopBottomZ = pocket.infillTopZ - effectiveScoopDepthMm(hole);
    if (scoopBottomZ < 0) {
      issues.push({
        code: "scoop-too-deep",
        severity: "error",
        cutoutIds: [cutout.id],
        message: `“${label}”'s scoop finger hole is deeper than the bin itself.`,
      });
    } else if (scoopBottomZ < MIN_FLOOR_MM) {
      issues.push({
        code: "floor-too-thin",
        severity: "warning",
        cutoutIds: [cutout.id],
        message: `“${label}”'s scoop finger hole leaves a ${scoopBottomZ.toFixed(1)} mm floor — likely to flex or delaminate.`,
      });
    }
  }

  return issues;
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
    a.cutout.clearanceMm +
    a.cutout.topFilletMm +
    b.cutout.clearanceMm +
    b.cutout.topFilletMm;
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
