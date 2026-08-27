import {
  circleRing,
  transformOutlinePlacement,
  transformPointPlacement,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { binFootprintMm, BASE_TOP_RADIUS } from "@shared/gridfinity/standard";
import type { BinSpec } from "@shared/gridfinity/types";
import { isValidRing } from "@shared/geometry/rings";
import type { Point, Ring } from "@shared/geometry/types";

import { budgetOutline } from "@/lib/gridfinity/cutouts";

import { dxfFromModelRings } from "./dxf";

/**
 * Top-down bin-layout export: the bin's footprint plus every placed pocket
 * outline and feature circle, in **bin-frame millimetres, y-up** — the CNC
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
): Ring[] {
  const rings: Ring[] = [
    roundedRectRing(
      binFootprintMm(spec.gridX, spec.gridPitch),
      binFootprintMm(spec.gridY, spec.gridPitch),
      BASE_TOP_RADIUS,
    ),
  ];

  for (const cutout of cutouts) {
    const shape = shapesById.get(cutout.shapeId);
    if (!shape) continue;
    const budgeted = budgetOutline(shape.outlineMm, EXPORT_VERTEX_BUDGET);
    for (const placedShape of transformOutlinePlacement(budgeted, cutout)) {
      rings.push(placedShape.outer, ...placedShape.holes);
    }
    for (const hole of cutout.fingerHoles) {
      rings.push(
        circleRing(
          transformPointPlacement(hole.center, cutout),
          hole.diameterMm / 2,
          CIRCLE_SEGMENTS,
        ),
      );
    }
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
  "Units: millimetres, bin top view (y-up) - pocket rings are tool silhouettes; per-pocket fit clearance and 3D edge rounds are applied at cut time, not baked in";

/** The layout as a DXF drawing (one closed LWPOLYLINE per ring). */
export function generateLayoutDXF(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
): string {
  return dxfFromModelRings(layoutRingsMm(spec, cutouts, shapesById), LAYOUT_COMMENT);
}

/**
 * The layout as a standalone SVG, sized in real millimetres. SVG is y-down,
 * so this is one of the exporters that flips — once, here.
 */
export function generateLayoutSVG(
  spec: BinSpec,
  cutouts: readonly CutoutPlacement[],
  shapesById: ReadonlyMap<string, TracedShape>,
): string {
  const widthMm = binFootprintMm(spec.gridX, spec.gridPitch);
  const lengthMm = binFootprintMm(spec.gridY, spec.gridPitch);
  const rings = layoutRingsMm(spec, cutouts, shapesById);

  const toView = (point: Point): Point => ({
    x: point.x + widthMm / 2,
    y: lengthMm / 2 - point.y,
  });
  const paths = rings.map((ring) => {
    const d = ring
      .map((point, index) => {
        const v = toView(point);
        return `${index === 0 ? "M" : "L"} ${v.x.toFixed(4)} ${v.y.toFixed(4)}`;
      })
      .join(" ");
    return `  <path d="${d} Z" fill="none" stroke="#000" stroke-width="0.2"/>`;
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${lengthMm}mm" viewBox="0 0 ${widthMm} ${lengthMm}">`,
    `  <!-- Pocketry bin layout - ${LAYOUT_COMMENT} -->`,
    ...paths,
    `</svg>`,
    ``,
  ].join("\n");
}
