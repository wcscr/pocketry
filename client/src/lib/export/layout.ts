import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
import { hasRigidPocket, rigidPocketFootprint } from "@shared/gridfinity/rigid-pocket";
import { resolvedPocketGeometry } from "@/lib/gridfinity/pocket-geometry";
import {
  fingerHoleFootprintRing,
  fingerHoleCircularSegments,
  FINGER_HOLE_EXPORT_CHORD_TOLERANCE_MM,
  transformOutlinePlacement,
  resolvePocketDepth,
  type CutoutPlacement,
  type FingerHole,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { BASE_TOP_RADIUS } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import { isValidRing } from "@shared/geometry/rings";
import type { Point, Ring } from "@shared/geometry/types";
import { footprintOuterRingMm } from "@shared/gridfinity/footprint";
import { profileFootprint } from "@shared/gridfinity/profile-bottom";
import { resolvedProfileFootprint } from "@/lib/gridfinity/profile-bottom";
import { withKernel, type Kernel } from "@/lib/manifold/runtime";

import type { Manifold } from "manifold-3d";
import { validateLayout } from "@shared/gridfinity/validate";
import { retainedUltim8PegCenters } from "@/lib/gridfinity/peg-bottom";
import { EXPORT_QUALITY } from "@/lib/gridfinity/bin";
import { buildCutoutCutters, buildFingerHoleCutters } from "@/lib/gridfinity/cutouts";

import { budgetOutline } from "@/lib/gridfinity/cutouts";

import { dxfFromModelRings } from "./dxf";

/**
 * Top-down bin-layout export: the bin's footprint plus every placed pocket
 * outline and independent finger access rim, in **bin-frame millimetres, y-up** — the CNC
 * shadow-board bridge from the design doc ("nearly free from the 2D
 * editor"). The pocket rings are the tool silhouettes at export vertex
 * budget, exactly the curves the pocket cutter starts from; fit clearance
 * and 3D edge rounds are applied at cut time instead of baked in, so a router
 * operator can choose their own offset.
 */

const EXPORT_VERTEX_BUDGET = 600;
const CIRCLE_SEGMENTS = 64;

/** All layout rings in bin-frame mm (y-up): footprint first, then pockets. */
export function layoutRingsMm(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  fingerHoles: readonly FingerHole[] = [],
  kernel?: Kernel,
): Ring[] {
  const rings: Ring[] = [
    spec.footprint.kind === "custom"
      ? footprintOuterRingMm(spec, CIRCLE_SEGMENTS)
      : roundedRectRing(
          binWidthMm(spec),
          binLengthMm(spec),
          BASE_TOP_RADIUS,
        ),
  ];

  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    if (!shape) continue;
    const budgeted = budgetOutline(shape.outlineMm, EXPORT_VERTEX_BUDGET);
    const outline = hasRigidPocket(cutout) ? kernel ? resolvedPocketGeometry(kernel, shape, cutout, spec).opening
      : rigidPocketFootprint(shape.outlineMm, cutout, resolvePocketDepth(spec, cutout.depth).infillTopZ) : cutout.profileBottom
      ? kernel ? resolvedProfileFootprint(kernel, shape.outlineMm, cutout, resolvePocketDepth(spec, { mode: "through" }).infillTopZ)
        : profileFootprint(shape.outlineMm, cutout, resolvePocketDepth(spec, { mode: "through" }).infillTopZ)
      : transformOutlinePlacement(budgeted, cutout);
    for (const placedShape of outline) {
      rings.push(placedShape.outer, ...placedShape.holes);
    }
  }

  for (const hole of fingerHoles) {
    rings.push(
      fingerHoleFootprintRing(
        hole,
        { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false },
        fingerHoleCircularSegments(hole, CIRCLE_SEGMENTS, FINGER_HOLE_EXPORT_CHORD_TOLERANCE_MM),
      ),
    );
  }

  return rings.filter((ring) => isValidRing(ring));
}

/** Centre-origin rounded rectangle, CCW, arcs sampled per corner. */
function roundedRectRing(
  widthMm: number,
  lengthMm: number,
  cornerRadiusMm: number,
  segmentsPerCorner = 16,
): Ring {
  const hw = widthMm / 2;
  const hl = lengthMm / 2;
  const r = Math.min(cornerRadiusMm, hw, hl);
  const corners: { cx: number; cy: number; start: number }[] = [
    { cx: hw - r, cy: -hl + r, start: -Math.PI / 2 },
    { cx: hw - r, cy: hl - r, start: 0 },
    { cx: -hw + r, cy: hl - r, start: Math.PI / 2 },
    { cx: -hw + r, cy: -hl + r, start: Math.PI },
  ];
  const ring: Point[] = [];
  for (const { cx, cy, start } of corners) {
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const angle = start + (Math.PI / 2) * (i / segmentsPerCorner);
      ring.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
  }
  return ring;
}

const LAYOUT_COMMENT =
  "Units: millimetres, bin top view (y-up) - pocket rings are nominal top openings (oblique sections for tilted pockets); per-pocket fit clearance and 3D edge rounds are applied at cut time, not baked in; 2D templates do not encode tilted depth or insertion paths";

/** The layout as a DXF drawing (one closed LWPOLYLINE per ring). */
export async function generateLayoutDXF(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  fingerHoles: readonly FingerHole[] = [],
): Promise<string> {
  return dxfFromModelRings(
    await exportLayoutRings(spec, cutouts, shapesById, fingerHoles),
    LAYOUT_COMMENT,
  );
}

/**
 * The layout as a standalone SVG, sized in real millimetres. SVG is y-down,
 * so this is one of the exporters that flips — once, here.
 */
export async function generateLayoutSVG(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
  fingerHoles: readonly FingerHole[] = [],
): Promise<string> {
  const widthMm = binWidthMm(spec);
  const lengthMm = binLengthMm(spec);
  const rings = await exportLayoutRings(spec, cutouts, shapesById, fingerHoles);

  const paths = rings.map(ring => `  <path d="${svgRingPath(ring, widthMm, lengthMm)}" fill="none" stroke="#000" stroke-width="0.2"/>`);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${lengthMm}mm" viewBox="0 0 ${widthMm} ${lengthMm}">`,
    `  <!-- Pocketry bin layout - ${LAYOUT_COMMENT} -->`,
    ...paths,
    `</svg>`,
    ``,
  ].join("\n");
}

async function exportLayoutRings(spec: BinSpec, cutouts: readonly CutoutPlacement[], shapes: ReadonlyMap<string, TracedShape>, fingers: readonly FingerHole[]): Promise<Ring[]> {
  return cutouts.some(c => c.profileBottom || hasRigidPocket(c))
    ? withKernel(kernel => layoutRingsMm(spec, cutouts, shapes, fingers, kernel))
    : layoutRingsMm(spec, cutouts, shapes, fingers);
}

/** Millimetre top view of the installed jig, independent of pegs-up print
 * orientation. The document origin is the bin's upper-left bound, not a bed
 * origin: users register the actual peg circles to their calibrated mat. */
export async function generateUltim8JigSVG(
  spec: BinSpec, cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>, fingerHoles: readonly FingerHole[] = [],
): Promise<string> {
  if (!spec.pegBottom) throw new Error("ULTIM8 jig pegs are required for a jig layout SVG.");
  const error = validateLayout(spec, cutouts, shapesById, fingerHoles).find(issue => issue.severity === "error");
  if (error) throw new Error(error.message);
  const radius = spec.pegBottom.diameterMm / 2;
  const width = binWidthMm(spec), length = binLengthMm(spec);
  return withKernel(kernel => {
    const { arena, Manifold } = kernel;
    const built = buildCutoutCutters(kernel, shapesById, cutouts, spec, EXPORT_QUALITY);
    const cutterError = built.validationIssues?.find(issue => issue.severity === "error");
    if (cutterError) throw new Error(cutterError.message);
    if (built.reports.some(report => report.emptied)) throw new Error("A pocket has no usable geometry. Fix the pocket before exporting the jig layout.");
    const throughCutters = built.throughCutters ?? [];
    const through = throughCutters.length ? arena.track(Manifold.union(throughCutters)) : null;
    const pegs = retainedUltim8PegCenters(kernel, spec, EXPORT_QUALITY.circularSegments, through);
    if (!pegs.length) throw new Error("This layout has no fitting ULTIM8 pegs. Move or resize the pockets, or enlarge the footprint.");
    const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
    const openingRings = (cutters: readonly Manifold[]): Ring[] => {
      if (!cutters.length) return [];
      const solid = arena.track(Manifold.union(cutters));
      if (solid.isEmpty() || solid.boundingBox().min[2] >= top - 1e-8) return [];
      // Slice on the material side, matching the 3D opening inspection.
      return arena.track(solid.slice(top - 1e-7)).toPolygons()
        .map(ring => ring.map(([x, y]) => ({ x, y }))).filter(ring => isValidRing(ring));
    };
    const group = (id: string, color: string, rings: Ring[]) => [
      `  <g id="${id}" fill="none" stroke="${color}" stroke-width="0.2">`,
      ...rings.map(ring => `    <path d="${svgRingPath(ring, width, length)}"/>`),
      `  </g>`,
    ];
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${length}mm" viewBox="0 0 ${width} ${length}">`,
      `  <title>ULTIM8 jig layout</title>`,
      `  <desc>1:1 millimetres. Installed top view, not the pegs-up print orientation. Origin: top-left of the bin bounds. Align peg circles to matching holes in your zero-point-calibrated mat template; this SVG does not assign a bed position. Gray: bin outline. Black: pocket openings. Orange: finger access. Blue: retained peg shafts.</desc>`,
      ...group("bin-outline", "#64748b", [footprintOuterRingMm(spec, EXPORT_QUALITY.circularSegments)]),
      ...group("pocket-openings", "#000000", (built.cutterGroups ?? []).flatMap(group => openingRings(group.cutters))),
      ...group("finger-access", "#d97706", fingerHoles.flatMap(hole => openingRings(buildFingerHoleCutters(kernel, [hole], spec, EXPORT_QUALITY)))),
      `  <g id="peg-locations" fill="none" stroke="#2563eb" stroke-width="0.2">`,
      ...pegs.map(point => {
        const view = svgViewPoint(point, width, length);
        return `    <circle cx="${view.x.toFixed(4)}" cy="${view.y.toFixed(4)}" r="${radius.toFixed(4)}"/>`;
      }),
      `  </g>`,
      `</svg>`,
      ``,
    ].join("\n");
  });
}

/** Apply the bin-frame y-up to SVG y-down conversion exactly once. */
function svgViewPoint(point: Point, width: number, length: number): Point {
  return { x: point.x + width / 2, y: length / 2 - point.y };
}

function svgRingPath(ring: Ring, width: number, length: number): string {
  return ring.map((point, index) => {
    const view = svgViewPoint(point, width, length);
    return `${index === 0 ? "M" : "L"} ${view.x.toFixed(4)} ${view.y.toFixed(4)}`;
  }).join(" ") + " Z";
}
