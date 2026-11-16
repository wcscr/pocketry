import { z } from "zod";

import { minAreaObb } from "../geometry/obb";
import { distanceToSegment, pointInRing, ringBounds, signedArea } from "../geometry/rings";
import type { Bounds, Outline, Point, Ring } from "../geometry/types";
import {
  fingerHoleSchema,
  parseCutoutPlacement,
  signedDistanceToInterior,
  tracedShapeSchema,
  transformOutlinePlacement,
  type FingerHole,
  type TracedShape,
} from "./cutout";
import { infillTopZ } from "./fill";
import { projectDocSchema, PROJECT_SCHEMA_VERSION, type ProjectDoc } from "./project";
import {
  BASE_HEIGHT,
  BASE_GAP_MM,
  BASE_PROFILE_HEIGHT,
  binFootprintMm,
  binTotalHeightMm,
  D_WALL,
  GRID_DIMENSIONS_MM,
  HEIGHT_UNIT_MM,
  STACKING_LIP_DEPTH,
  STACKING_LIP_SUPPORT_HEIGHT,
} from "./standard";
import { MAX_GRID, MAX_HEIGHT_UNITS, parseBinSpec, type BinSpec } from "./types";
import { validateBinSpec, validateLayout, type ValidationIssue } from "./validate";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

export const svgFingerAccessOptionsSchema = z.object({
  /** Sides follow the object's long edges, rather than the bin's X/Y edges. */
  placement: z.enum(["sides", "ends", "both", "none", "custom"]).default("sides"),
  diameterMm: z.number().finite().min(6).max(80).default(18),
  /** How far the round opening extends past the cleared silhouette. */
  extensionMm: z.number().finite().positive().max(80).default(4),
  /** Depth below the pocket deck, leaving at least the pocket's floor. */
  depthMm: z.number().finite().min(1).max(120).optional(),
  /** Custom centers are bin-local, y-up millimeters and are never translated. */
  centers: z.array(pointSchema).min(1).max(32).optional(),
}).strict().superRefine((access, context) => {
  if (access.placement === "custom" && !access.centers) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["centers"], message: "Custom finger access requires centers in bin-local millimeters." });
  }
  if (access.placement !== "custom" && access.centers) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["centers"], message: "Finger centers require placement: custom." });
  }
});

/** One upright SVG pocket; source geometry is already calibrated in millimeters. */
export const svgBinOptionsSchema = z.object({
  objectDepthMm: z.number().finite().positive().max(280),
  /** Highest part above the floor, including features outside the pocket body. */
  objectHeightMm: z.number().finite().positive().max(280).optional(),
  clearanceMm: z.number().finite().min(0).max(5).default(0.3),
  depthClearanceMm: z.number().finite().min(0).max(5).default(0.2),
  stackingClearanceMm: z.number().finite().min(0).max(20).default(0.8),
  /** Native Pocketry base is 7 mm; never expose its 4.75 mm socket profile. */
  minimumFloorMm: z.number().finite().min(BASE_PROFILE_HEIGHT + 1.2).max(100).default(BASE_HEIGHT),
  /** An explicit CCW rotation overrides automatic orientation search. */
  rotationDeg: z.number().finite().optional(),
  autoRotate: z.boolean().default(true),
  gridX: z.number().int().min(1).max(MAX_GRID).optional(),
  gridY: z.number().int().min(1).max(MAX_GRID).optional(),
  /** Exported bins use only whole 7 mm units, including explicit heights. */
  heightUnits: z.number().int().min(1).max(MAX_HEIGHT_UNITS).optional(),
  fingerAccess: svgFingerAccessOptionsSchema.default({}),
  lip: z.enum(["standard", "none"]).default("standard"),
  name: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((options, context) => {
  if (options.objectHeightMm !== undefined && options.objectHeightMm < options.objectDepthMm) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["objectHeightMm"], message: "Object height must include the entire pocket body depth." });
  }
  if (!["none", "custom"].includes(options.fingerAccess.placement)
      && options.fingerAccess.extensionMm + options.clearanceMm >= options.fingerAccess.diameterMm) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fingerAccess", "extensionMm"], message: "Finger extension plus clearance must be smaller than its diameter so the opening meets the object." });
  }
});

export type SvgBinOptionsInput = z.input<typeof svgBinOptionsSchema>;
export type SvgBinOptions = z.infer<typeof svgBinOptionsSchema>;

export interface SvgBinSummary {
  gridX: number;
  gridY: number;
  heightUnits: number;
  dimensionsMm: { widthMm: number; lengthMm: number; heightToRimMm: number; totalHeightMm: number };
  objectDimensionsMm: { widthMm: number; lengthMm: number };
  rotationDeg: number;
  pocketPositionMm: Point;
  pocketDepthMm: number;
  floorZMm: number;
  deckZMm: number;
  objectTopZMm: number;
  /** Nominal 7 mm Gridfinity mating plane; lip height is not credited as clearance. */
  stackingPlaneZMm: number;
  stackingClearanceMm: number;
  fingerPlacement: SvgBinOptions["fingerAccess"]["placement"];
  fingerCentersMm: Point[];
  warnings: string[];
}

export interface SvgBinPlan {
  project: ProjectDoc;
  summary: SvgBinSummary;
}

const EPSILON = 1e-7;
const PROTECTED_LAYOUT_CODES = new Set([
  "lip-collision", "finger-hole-lip-collision", "lip-support-clipped",
]);

function outlineBounds(outline: Outline): Bounds {
  const bounds = outline.map(part => ringBounds(part.outer)).filter((bound): bound is Bounds => bound !== null);
  if (!bounds.length) throw new Error("The SVG silhouette has no area.");
  return {
    minX: Math.min(...bounds.map(bound => bound.minX)), minY: Math.min(...bounds.map(bound => bound.minY)),
    maxX: Math.max(...bounds.map(bound => bound.maxX)), maxY: Math.max(...bounds.map(bound => bound.maxY)),
  };
}

function rotate(point: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}

function rotateOutline(outline: Outline, degrees: number): Outline {
  return outline.map(part => ({ outer: part.outer.map(point => rotate(point, degrees)), holes: part.holes.map(ring => ring.map(point => rotate(point, degrees))) }));
}

/** Intersections with actual outer edges, avoiding a bounding-box-only grip in empty concavities. */
function crossSection(rings: readonly Ring[], axis: "x" | "y", coordinate: number): number[] {
  const other = axis === "x" ? "y" : "x";
  const values: number[] = [];
  for (const ring of rings) for (let index = 0; index < ring.length; index++) {
    const start = ring[index], end = ring[(index + 1) % ring.length];
    if (Math.abs(start[axis] - end[axis]) < EPSILON) {
      if (Math.abs(coordinate - start[axis]) < EPSILON) values.push(start[other], end[other]);
      continue;
    }
    const fraction = (coordinate - start[axis]) / (end[axis] - start[axis]);
    if (fraction >= 0 && fraction <= 1) values.push(start[other] + fraction * (end[other] - start[other]));
  }
  return values;
}

function accessPair(outline: Outline, axis: "x" | "y", offset: number): Point[] {
  const bounds = outlineBounds(outline);
  const middle = axis === "x" ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2;
  const rings = outline.map(part => part.outer);
  // The central line is preferred. Disconnected silhouettes can have a gap there;
  // edge midpoints provide a deterministic nearby line that actually meets a shell.
  const candidates = [middle, ...rings.flatMap(ring => ring.map((point, index) => (point[axis] + ring[(index + 1) % ring.length][axis]) / 2))]
    .sort((left, right) => Math.abs(left - middle) - Math.abs(right - middle) || left - right);
  for (const coordinate of candidates) {
    const intersections = crossSection(rings, axis, coordinate);
    if (intersections.length < 2) continue;
    const minimum = Math.min(...intersections), maximum = Math.max(...intersections);
    if (maximum - minimum < EPSILON) continue;
    return axis === "x"
      ? [{ x: coordinate, y: minimum - offset }, { x: coordinate, y: maximum + offset }]
      : [{ x: minimum - offset, y: coordinate }, { x: maximum + offset, y: coordinate }];
  }
  throw new Error("Cannot place finger access against this silhouette.");
}

function automaticCenters(alignedOutline: Outline, options: SvgBinOptions): Point[] {
  const access = options.fingerAccess;
  const offset = options.clearanceMm + access.extensionMm - access.diameterMm / 2;
  return [
    ...(access.placement === "sides" || access.placement === "both" ? accessPair(alignedOutline, "x", offset) : []),
    ...(access.placement === "ends" || access.placement === "both" ? accessPair(alignedOutline, "y", offset) : []),
  ];
}

/** Positive overlap with the actual filled silhouette; holes remain excluded. */
function connectedToPocket(outline: Outline, center: Point, radiusMm: number): boolean {
  for (const part of outline) {
    if (pointInRing(part.outer, center) && !part.holes.some(ring => pointInRing(ring, center))) return true;
    for (const ring of [part.outer, ...part.holes]) for (let index = 0; index < ring.length; index++) {
      if (distanceToSegment(center, ring[index], ring[(index + 1) % ring.length]) < radiusMm - EPSILON) return true;
    }
  }
  return false;
}

function verticalSpec(options: SvgBinOptions): { heightUnits: number; fillHeightPercent: number; deckZMm: number; floorZMm: number } {
  const pocketDepth = options.objectDepthMm + options.depthClearanceMm;
  const objectHeight = options.objectHeightMm ?? options.objectDepthMm;
  const lipAllowance = options.lip === "standard" ? STACKING_LIP_SUPPORT_HEIGHT : 0;
  const heights = options.heightUnits === undefined
    ? Array.from({ length: MAX_HEIGHT_UNITS }, (_, index) => index + 1)
    : [options.heightUnits];
  for (const heightUnits of heights) {
    const rim = heightUnits * HEIGHT_UNIT_MM;
    const available = rim - lipAllowance - BASE_HEIGHT;
    if (available <= 0) {
      // An explicitly unstackable 1u bin can cut a shallow pocket into the
      // ordinary base itself, while preserving material above its socket.
      const floorZMm = BASE_HEIGHT - pocketDepth;
      if (options.lip === "none" && available === 0 && floorZMm >= options.minimumFloorMm - EPSILON
          && floorZMm + objectHeight + options.stackingClearanceMm <= rim + EPSILON) {
        return { heightUnits, fillHeightPercent: 100, deckZMm: BASE_HEIGHT, floorZMm };
      }
      continue;
    }
    const deckZMm = Math.max(options.minimumFloorMm + pocketDepth, BASE_HEIGHT + available * 0.01);
    const floorZMm = deckZMm - pocketDepth;
    if (deckZMm > rim - lipAllowance + EPSILON || floorZMm + objectHeight + options.stackingClearanceMm > rim + EPSILON) continue;
    return { heightUnits, fillHeightPercent: Math.min(100, Math.max(1, (deckZMm - BASE_HEIGHT) / available * 100)), deckZMm, floorZMm };
  }
  throw new Error(options.heightUnits === undefined
    ? "The object, pocket floor and stacking clearance exceed Pocketry's maximum whole-unit height."
    : "The requested whole-unit height cannot fit the object, pocket floor and stacking clearance.");
}

interface Candidate {
  spec: BinSpec;
  rotationDeg: number;
  position: Point;
  holes: FingerHole[];
  warnings: ValidationIssue[];
}

/**
 * Plan an editable Pocketry project without loading WASM. Orientation search
 * includes 0.5 degree samples and the exact oriented-bounding-box alignment;
 * minimum footprint means the smallest feasible full-grid candidate searched.
 * The existing layout validator and exact circular-boundary clearance protect
 * the ordinary wall and stacking lip. Final exports still run kernel validation.
 */
export function planSvgBin(inputShape: TracedShape, inputOptions: unknown): SvgBinPlan {
  const options = svgBinOptionsSchema.parse(inputOptions);
  const shape = tracedShapeSchema.parse(inputShape);
  if (shape.outlineMm.some(part => signedArea(part.outer) <= EPSILON || part.holes.some(ring => signedArea(ring) >= -EPSILON))) {
    throw new Error("SVG rings must have nonzero area, positive outer winding and negative hole winding.");
  }
  if (shape.sourceMmPerPx === null && shape.source !== "basic-shape") throw new Error("The SVG must be calibrated in millimeters.");
  const points = shape.outlineMm.flatMap(part => part.outer);
  const obb = minAreaObb(points);
  const aligned = rotateOutline(shape.outlineMm, obb.angleDeg);
  const rawCenters = automaticCenters(aligned, options);
  const vertical = verticalSpec(options);
  const pocketDepth = options.objectDepthMm + options.depthClearanceMm;
  const diameter = options.fingerAccess.diameterMm;
  const radius = diameter / 2;
  const requestedDepth = options.fingerAccess.depthMm ?? Math.min(120, Math.max(1, pocketDepth - 1));
  if (options.fingerAccess.placement !== "none" && requestedDepth > pocketDepth + EPSILON) {
    throw new Error("Finger access depth cannot extend below the pocket floor; shallow pockets may need finger access disabled.");
  }
  const normalized = (angle: number) => ((angle % 360) + 540) % 360 - 180;
  const angles = options.rotationDeg !== undefined ? [normalized(options.rotationDeg)] : !options.autoRotate ? [0]
    : [...new Set([obb.angleDeg, 0, ...Array.from({ length: options.fingerAccess.placement === "custom" ? 720 : 360 }, (_, index) => index * 0.5)]
      .map(angle => Math.round(normalized(angle) * 1e8) / 1e8))];
  let best: Candidate | null = null;
  const shapeMap = new Map([[shape.id, shape]]);
  const margin = options.lip === "standard" ? STACKING_LIP_DEPTH : D_WALL;
  const lipIntrusion = options.lip === "standard" ? STACKING_LIP_DEPTH - D_WALL : 0;

  for (const rotationDeg of angles) {
    const rotatedOutline = rotateOutline(shape.outlineMm, rotationDeg);
    const outlineBox = outlineBounds(rotatedOutline);
    let centers = options.fingerAccess.placement === "custom" ? options.fingerAccess.centers!
      : rawCenters.map(center => rotate(center, rotationDeg - obb.angleDeg));
    const envelope = {
      minX: Math.min(outlineBox.minX - options.clearanceMm, ...centers.map(center => center.x - radius)),
      maxX: Math.max(outlineBox.maxX + options.clearanceMm, ...centers.map(center => center.x + radius)),
      minY: Math.min(outlineBox.minY - options.clearanceMm, ...centers.map(center => center.y - radius)),
      maxY: Math.max(outlineBox.maxY + options.clearanceMm, ...centers.map(center => center.y + radius)),
    };
    const custom = options.fingerAccess.placement === "custom";
    const position = { x: -(custom ? outlineBox.minX + outlineBox.maxX : envelope.minX + envelope.maxX) / 2,
      y: -(custom ? outlineBox.minY + outlineBox.maxY : envelope.minY + envelope.maxY) / 2 };
    if (!custom) centers = centers.map(center => ({ x: center.x + position.x, y: center.y + position.y }));
    const placement = parseCutoutPlacement({ id: "svg-pocket", shapeId: shape.id, name: options.name ?? shape.name,
      position, rotationDeg, depth: { mode: "mm", value: pocketDepth }, clearanceMm: options.clearanceMm,
      cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
    const placedOutline = transformOutlinePlacement(shape.outlineMm, placement);
    if (centers.some(center => !connectedToPocket(placedOutline, center, radius + options.clearanceMm))) continue;
    const holes = centers.map((center, index) => fingerHoleSchema.parse({ id: `svg-finger-${index + 1}`, center,
      diameterMm: diameter, kind: "straight", depthMm: requestedDepth, topFilletMm: 0, bottomFilletMm: 0 }));
    const finalBox = outlineBounds(placedOutline);
    const spanX = 2 * Math.max(Math.abs(finalBox.minX) + options.clearanceMm, Math.abs(finalBox.maxX) + options.clearanceMm,
      ...centers.map(center => Math.abs(center.x) + radius));
    const spanY = 2 * Math.max(Math.abs(finalBox.minY) + options.clearanceMm, Math.abs(finalBox.maxY) + options.clearanceMm,
      ...centers.map(center => Math.abs(center.y) + radius));
    const requiredX = Math.max(1, Math.ceil((spanX + 2 * margin + BASE_GAP_MM - EPSILON) / GRID_DIMENSIONS_MM));
    const requiredY = Math.max(1, Math.ceil((spanY + 2 * margin + BASE_GAP_MM - EPSILON) / GRID_DIMENSIONS_MM));
    // One extra cell per axis covers a rounded-corner rejection of the bounding box.
    const xs = options.gridX === undefined ? [requiredX, requiredX + 1].filter(value => value <= MAX_GRID) : [options.gridX];
    const ys = options.gridY === undefined ? [requiredY, requiredY + 1].filter(value => value <= MAX_GRID) : [options.gridY];
    for (const gridX of xs) for (const gridY of ys) {
      if (best && gridX * gridY > best.spec.gridX * best.spec.gridY) continue;
      const spec = parseBinSpec({ gridX, gridY, heightUnits: vertical.heightUnits, lip: options.lip,
        fill: "solid", fillHeightPercent: vertical.fillHeightPercent, magnetHoles: false, screwHoles: false, labelTab: null });
      // Distance at the center checks the entire circle, including arc extrema
      // between the validator's finite polygon samples at rounded bin corners.
      if (centers.some(center => signedDistanceToInterior(center, spec) + EPSILON < radius + lipIntrusion)) continue;
      const issues = [...validateBinSpec(spec).issues, ...validateLayout(spec, [placement], shapeMap, holes)];
      if (issues.some(issue => issue.severity === "error" || PROTECTED_LAYOUT_CODES.has(issue.code))) continue;
      const candidate = { spec, rotationDeg, position, holes, warnings: issues.filter(issue => issue.severity === "warning") };
      const score = (value: Candidate) => [value.spec.gridX * value.spec.gridY, value.spec.gridX < value.spec.gridY ? 1 : 0,
        Math.abs(normalized(value.rotationDeg - obb.angleDeg)), value.spec.gridX + value.spec.gridY];
      const candidateScore = score(candidate), bestScore = best && score(best);
      if (!bestScore || candidateScore.some((value, index) => value < bestScore[index] && candidateScore.slice(0, index).every((previous, previousIndex) => previous === bestScore[previousIndex]))) best = candidate;
    }
  }
  if (!best) throw new Error("No full-grid bin fits the SVG pocket and finger access while preserving the wall and stacking lip. Check explicit dimensions, centers or finger diameter.");
  const spec = best.spec;
  const cutout = parseCutoutPlacement({ id: "svg-pocket", shapeId: shape.id, name: options.name ?? shape.name,
    position: best.position, rotationDeg: best.rotationDeg, depth: { mode: "mm", value: pocketDepth }, clearanceMm: options.clearanceMm,
    cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
  const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION, name: options.name ?? shape.name,
    shapes: [shape], spec, cutouts: [cutout], fingerHoles: best.holes });
  const deck = infillTopZ(spec), floor = deck - pocketDepth, plane = spec.heightUnits * HEIGHT_UNIT_MM;
  return { project, summary: {
    gridX: spec.gridX, gridY: spec.gridY, heightUnits: spec.heightUnits,
    dimensionsMm: { widthMm: binFootprintMm(spec.gridX), lengthMm: binFootprintMm(spec.gridY), heightToRimMm: plane,
      totalHeightMm: binTotalHeightMm(spec.heightUnits, spec.lip === "standard") },
    objectDimensionsMm: { widthMm: obb.widthMm, lengthMm: obb.heightMm }, rotationDeg: best.rotationDeg,
    pocketPositionMm: best.position, pocketDepthMm: pocketDepth, floorZMm: floor, deckZMm: deck,
    objectTopZMm: floor + (options.objectHeightMm ?? options.objectDepthMm), stackingPlaneZMm: plane,
    stackingClearanceMm: plane - floor - (options.objectHeightMm ?? options.objectDepthMm),
    fingerPlacement: options.fingerAccess.placement, fingerCentersMm: best.holes.map(hole => hole.center),
    warnings: best.warnings.map(issue => issue.message),
  } };
}
