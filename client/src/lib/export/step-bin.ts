import { strToU8, zipSync } from "fflate";
import { signedArea, ringBounds } from "@shared/geometry/rings";
import type { Point, Ring } from "@shared/geometry/types";
import { pocketName, resolvePocketDepth, transformOutlinePlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseProjectDoc, serializeProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { BASE_TOP_RADIUS, binFootprintMm, binHeightMm } from "@shared/gridfinity/standard";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";
import { circleStepLoop, polygonStepLoop, roundedRectangleStepLoop, writeStep, type StepBody, type StepLoop } from "./step";

export class StepUnsupportedError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`STEP export is not available for this design yet: ${reasons.join(" ")}`);
    this.name = "StepUnsupportedError";
  }
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface PreparedStepBin { body: StepBody; blank: StepBody; cutters: StepBody[] }
const EPSILON = 1e-7;
const MAX_STEP_VERTICES = 2000;

/** Recover only Pocketry's exact regular-circle construction, never fit traces. */
function authoredCircleRadius(shape: TracedShape): number | null {
  if (shape.source !== "basic-shape" || shape.outlineMm.length !== 1 || shape.outlineMm[0].holes.length) return null;
  const ring = shape.outlineMm[0].outer;
  if (ring.length < 32 || ring.length % 4 !== 0) return null;
  const radius = ring[0].x;
  if (radius <= 0) return null;
  const matches = ring.every((point, index) => {
    const angle = index * 2 * Math.PI / ring.length;
    return Math.hypot(point.x - radius * Math.cos(angle), point.y - radius * Math.sin(angle)) < 1e-8;
  });
  return matches ? radius : null;
}

/** Topological validation of authored straight boundaries; touching is rejected. */
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const on = (p: Point, q: Point, r: Point) => Math.abs(cross(p, q, r)) < EPSILON &&
    r.x >= Math.min(p.x, q.x) - EPSILON && r.x <= Math.max(p.x, q.x) + EPSILON &&
    r.y >= Math.min(p.y, q.y) - EPSILON && r.y <= Math.max(p.y, q.y) + EPSILON;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

function simpleRing(ring: Ring): boolean {
  if (ring.length < 3 || signedArea(ring) < EPSILON) return false;
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    if (Math.hypot(ring[i].x - ring[next].x, ring[i].y - ring[next].y) < EPSILON) return false;
    for (let j = i + 1; j < ring.length; j++) {
      if (j === next || (j + 1) % ring.length === i) continue;
      if (segmentsTouch(ring[i], ring[next], ring[j], ring[(j + 1) % ring.length])) return false;
    }
  }
  return true;
}

/** A conservative envelope also covers arcs between the preview's vertices. */
function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.maxX >= b.minX - EPSILON && b.maxX >= a.minX - EPSILON &&
    a.maxY >= b.minY - EPSILON && b.maxY >= a.minY - EPSILON;
}

/** Strict subset: no approximation, dropped feature, or mesh fallback. */
export function prepareStepBin(doc: ProjectDoc): PreparedStepBin {
  const { spec } = doc;
  const reasons: string[] = [];
  if (!spec.flatBottom) reasons.push("Gridfinity feet are not supported; use a flat bottom.");
  if (spec.lip !== "none") reasons.push("Stacking rims are not supported.");
  if (spec.footprint.kind !== "rectangle") reasons.push("Custom bin footprints are not supported.");
  if (spec.fill !== "solid" || spec.fillHeightPercent !== 100) reasons.push("Use solid fill at 100% height.");
  if (spec.labelTab) reasons.push("Label tabs are not supported.");
  if (spec.surfaceTexts.length) reasons.push("Surface text is not supported.");
  if (doc.fingerHoles.length) reasons.push("Finger access features are not supported.");
  // Flat bottoms currently omit base hardware in the mesh path too, but reject
  // retained settings so future changes cannot silently create export drift.
  if (spec.magnetHoles || spec.screwHoles) reasons.push("Base hardware holes are not supported.");
  const shapeMap = new Map(doc.shapes.map(shape => [shape.id, shape]));
  const vertices = doc.cutouts.reduce((sum, cutout) => sum + (shapeMap.get(cutout.shapeId)?.outlineMm
    .reduce((count, shape) => count + shape.outer.length + shape.holes.reduce((n, hole) => n + hole.length, 0), 0) ?? 0), 0);
  if (vertices > MAX_STEP_VERTICES) reasons.push(`This early exporter supports at most ${MAX_STEP_VERTICES} outline vertices.`);
  if (reasons.length) throw new StepUnsupportedError(reasons);
  const width = binFootprintMm(spec.gridX, spec.gridPitch);
  const length = binFootprintMm(spec.gridY, spec.gridPitch);
  const topZ = binHeightMm(spec.heightUnits);
  const outerLoop = roundedRectangleStepLoop(width, length, BASE_TOP_RADIUS);
  const blank: StepBody = { id: "bin-blank", name: "Bin blank", loop: outerLoop, bottomZ: 0, topZ };
  const cutters: StepBody[] = [];
  const bounds: Bounds[] = [];
  for (const cutout of doc.cutouts) {
    const shape = shapeMap.get(cutout.shapeId);
    const name = pocketName(cutout, shape);
    const prefix = `“${name}”: `;
    if (!shape) { reasons.push(prefix + "The outline is missing."); continue; }
    if (cutout.split || cutout.profileBottom || cutout.profileRotation || cutout.elevationMm !== undefined ||
        cutout.insertionMode || (cutout.zOffsetMm ?? 0) !== 0 ||
        (cutout.tilt?.xDeg ?? 0) !== 0 || (cutout.tilt?.yDeg ?? 0) !== 0) {
      reasons.push(prefix + "Only upright, surface-anchored pockets with one depth are supported."); continue;
    }
    if (cutout.clearanceMm !== 0 || cutout.cornerRoundMm !== 0 || cutout.topFilletMm !== 0 || cutout.bottomFilletMm !== 0) {
      reasons.push(prefix + "Clearance and edge rounding must be zero for this version."); continue;
    }
    if (cutout.fingerHoles.length || shape.outlineMm.length !== 1 || shape.outlineMm[0].holes.length) {
      reasons.push(prefix + "Outline islands, multiple outlines and attached finger holes are not supported."); continue;
    }
    const radius = authoredCircleRadius(shape);
    if (radius !== null && Math.abs(cutout.scaleX - cutout.scaleY) > 1e-10) {
      reasons.push(prefix + "Nonuniformly scaled circles need ellipse support."); continue;
    }
    const ring = transformOutlinePlacement(shape.outlineMm, cutout)[0].outer;
    if (!simpleRing(ring)) { reasons.push(prefix + "The outline must be simple, without touching or crossing edges."); continue; }
    let loop: StepLoop;
    let envelope: Bounds;
    if (radius !== null) {
      const scaled = radius * cutout.scaleX;
      loop = circleStepLoop(cutout.position, scaled);
      envelope = { minX: cutout.position.x - scaled, maxX: cutout.position.x + scaled,
        minY: cutout.position.y - scaled, maxY: cutout.position.y + scaled };
    } else {
      loop = polygonStepLoop(ring);
      envelope = ringBounds(ring)!;
    }
    // Keep each whole envelope inside the rounded body. This conservative rule
    // rules out both outside/tangent cuts and arcs protruding between samples.
    const x = Math.max(Math.abs(envelope.minX), Math.abs(envelope.maxX));
    const y = Math.max(Math.abs(envelope.minY), Math.abs(envelope.maxY));
    const dx = Math.max(0, x - (width / 2 - BASE_TOP_RADIUS));
    const dy = Math.max(0, y - (length / 2 - BASE_TOP_RADIUS));
    if (x >= width / 2 - EPSILON || y >= length / 2 - EPSILON || Math.hypot(dx, dy) >= BASE_TOP_RADIUS - EPSILON) {
      reasons.push(prefix + "The pocket envelope must lie strictly inside the bin."); continue;
    }
    if (bounds.some(previous => boundsOverlap(previous, envelope))) {
      reasons.push(prefix + "Pocket envelopes overlap or touch; intersecting cuts are not supported."); continue;
    }
    const depth = resolvePocketDepth(spec, cutout.depth);
    const floorZ = depth.floorZ ?? 0;
    if (floorZ > 0 && floorZ < 1e-6) {
      reasons.push(prefix + "The remaining floor is below this exporter's CAD tolerance."); continue;
    }
    if (floorZ >= topZ - 1e-6) { reasons.push(prefix + "The pocket has no positive depth."); continue; }
    cutters.push({ id: cutout.id, name, loop, bottomZ: floorZ, topZ });
    bounds.push(envelope);
  }
  if (reasons.length) throw new StepUnsupportedError(reasons);
  const errors = [...validateBinSpec(spec).issues, ...validateLayout(spec, doc.cutouts, shapeMap, doc.fingerHoles)]
    .filter(issue => issue.severity === "error");
  if (errors.length) throw new StepUnsupportedError(errors.map(issue => issue.message));
  return {
    blank, cutters,
    body: { ...blank, id: "bin", name: doc.name ?? "Pocketry bin", pockets: cutters.map(cutter => ({
      name: cutter.name, loop: cutter.loop, floorZ: cutter.bottomZ,
    })) },
  };
}

/** Complete tray + source solids + editable source, packaged as one download. */
export function writeStepBinPackage(input: ProjectDoc): Uint8Array {
  const doc = parseProjectDoc(input);
  if (!doc) throw new Error("The Pocketry project is invalid.");
  const { body, blank, cutters } = prepareStepBin(doc);
  const title = doc.name ?? "Pocketry bin";
  const source = serializeProjectDoc(doc);
  const files = {
    "bin.step": strToU8(writeStep([body], title)),
    "design-objects.step": strToU8(writeStep([blank, ...cutters], `${title} — design objects`)),
    "design.pocketry.json": strToU8(JSON.stringify(source, null, 2)),
    "README.txt": strToU8(
      "Pocketry STEP CAD package (early support)\n\n" +
      "bin.step: finished tray with pockets subtracted, in millimetres.\n" +
      "design-objects.step: named bin blank and individual pocket cutter solids in the same coordinates. " +
      "These overlap intentionally; use them for CAD reconstruction, not printing.\n" +
      "design.pocketry.json: original editable Pocketry project.\n\n" +
      "STEP preserves boundary geometry and named bodies, not a native parametric feature history. " +
      "Pocket tools are negative volumes, not physical parts.\n" +
      "Authored circles and bin corners are analytic arcs/cylinders. Traced contours retain their " +
      "original straight outline segments; no triangle mesh is converted.\n"),
    "objects.json": strToU8(JSON.stringify({ version: 1, units: "mm", coordinateFrame: "bin-centred, Y-up, bottom Z=0",
      objects: [{ id: blank.id, name: blank.name, role: "bin-blank" }, ...cutters.map(cutter => ({
        id: cutter.id, name: cutter.name, role: "pocket-cutter", shapeId: doc.cutouts.find(c => c.id === cutter.id)!.shapeId,
      }))],
    }, null, 2)),
  };
  return zipSync(files);
}
