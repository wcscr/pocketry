import type { CrossSection, Manifold } from "manifold-3d";
import { ringBounds } from "@shared/geometry/rings";
import { labelTabSurfaces, labelTabWritingArea, type LabelTabSurface } from "@shared/gridfinity/label-tab-surfaces";
import type { BinSpec } from "@shared/gridfinity/types";
import type { ValidationIssue } from "@shared/gridfinity/validate";
import type { Kernel } from "@/lib/manifold/runtime";
import { roundedRectPolygon } from "./profiles";
import { surfaceTextOutline } from "./surface-text";

/** Cullenect v2 retaining profile, adapted from Cullen J Webb's MIT-licensed
 * OpenSCAD/Cullenect.scad (d6dc0bb2). See NOTICE. The label width is editable
 * so a shelf narrower than the standard 36 mm label can still use the latch. */
export const SNAP_LABEL_HEIGHT_MM = 11;
export const SNAP_LABEL_DEPTH_MM = 1.2;
const RIB_WIDTH_MM = 0.2;
const RIB_HEIGHT_MM = 0.4;
const RIB_BOTTOM_MM = 0.2;
const SHELF_MARGIN_MM = 0.8;
const BACKING_MM = 0.8;
const TEXT_HEIGHT_MM = 0.4;

export interface SnapLabelPart { text: string; solid: Manifold; widthMm: number; tabKey?: string }

function section(kernel: Kernel, width: number, height: number): CrossSection {
  return kernel.arena.track(new kernel.CrossSection([roundedRectPolygon(width, height, 0.5, 64)]));
}

function place(kernel: Kernel, solid: Manifold, x: number, y: number, z: number, angle: number): Manifold {
  return kernel.arena.track(kernel.arena.track(solid.rotate([0, 0, angle])).translate([x, y, z]));
}

function labelBase(kernel: Kernel, width: number): Manifold {
  const { arena, Manifold } = kernel;
  const full = section(kernel, width, SNAP_LABEL_HEIGHT_MM);
  const waist = section(kernel, width - 0.4, SNAP_LABEL_HEIGHT_MM - 0.4);
  return arena.track(Manifold.union([
    arena.track(full.extrude(0.2)),
    arena.track(waist.extrude(SNAP_LABEL_DEPTH_MM - 0.2)),
    arena.track(arena.track(full.extrude(SNAP_LABEL_DEPTH_MM - 0.8)).translate([0, 0, 0.8])),
  ]));
}

function socketCutter(kernel: Kernel, width: number, clearance: number): Manifold {
  const { arena, Manifold } = kernel;
  const cavityWidth = width + clearance, cavityHeight = SNAP_LABEL_HEIGHT_MM + clearance;
  const cavity = arena.track(section(kernel, cavityWidth, cavityHeight).extrude(SNAP_LABEL_DEPTH_MM + 0.02));
  const ribs = [-cavityHeight / 2, cavityHeight / 2 - RIB_WIDTH_MM].map(y =>
    arena.track(arena.track(Manifold.cube([cavityWidth, RIB_WIDTH_MM, RIB_HEIGHT_MM]))
      .translate([-cavityWidth / 2, y, RIB_BOTTOM_MM])));
  return arena.track(cavity.subtract(arena.track(Manifold.union(ribs))));
}

/** Build every socket against the finished bin. Failed shelves block export rather
 * than silently dropping a retaining cut when the user edits the bin size. */
export function buildSnapSockets(kernel: Kernel, spec: BinSpec, body: Manifold): {
  body: Manifold; issues: ValidationIssue[];
} {
  const snap = spec.labelTab?.snap;
  if (!snap) return { body, issues: [] };
  const { arena, Manifold } = kernel;
  const surfaces = labelTabSurfaces(spec);
  const issues: ValidationIssue[] = [];
  if (!surfaces.length) {
    return { body, issues: [{ code: "snap-label-socket", severity: "error",
      message: "Snap-in labels need a usable label tab. Increase the tab depth or bin height." }] };
  }
  const cutters: Manifold[] = [];
  for (const surface of surfaces) {
    const bounds = ringBounds(surface.ring);
    if (!bounds) continue;
    const x = (bounds.minX + bounds.maxX) / 2, y = (bounds.minY + bounds.maxY) / 2;
    const clearance = snap.clearanceByTab?.[surface.key] ?? snap.clearanceMm;
    const width = snap.widthMm + clearance, height = SNAP_LABEL_HEIGHT_MM + clearance;
    const z = surface.z - SNAP_LABEL_DEPTH_MM;
    const outer = arena.track(new kernel.CrossSection([surface.ring.map(p => [p.x, p.y] as [number, number])], "NonZero"));
    const clip = arena.track(new kernel.CrossSection([surface.clip.map(p => [p.x, p.y] as [number, number])], "NonZero"));
    const usable = arena.track(outer.intersect(clip));
    const margin = arena.track(arena.track(section(kernel, width + 2 * SHELF_MARGIN_MM,
      height + 2 * SHELF_MARGIN_MM).rotate(surface.rotationDeg)).translate([x, y]));
    const outsideMm2 = arena.track(margin.subtract(usable)).area();
    const backing = place(kernel, arena.track(section(kernel, width, height)
      .extrude(SNAP_LABEL_DEPTH_MM + BACKING_MM)), x, y, z - BACKING_MM, surface.rotationDeg);
    const missingBackingMm3 = arena.track(backing.subtract(body)).volume();
    if (outsideMm2 > 1e-5 || missingBackingMm3 > 0.001) {
      issues.push({ code: "snap-label-socket", severity: "error",
        message: `Snap socket ${surface.key} does not fit its shelf with ${SHELF_MARGIN_MM} mm edge and ${BACKING_MM} mm backing. Increase tab depth or bin height, or reduce label width.` });
      continue;
    }
    cutters.push(place(kernel, socketCutter(kernel, snap.widthMm, clearance), x, y, z, surface.rotationDeg));
  }
  return { body: cutters.length ? arena.track(body.subtract(arena.track(Manifold.union(cutters)))) : body, issues };
}

function faceSection(kernel: Kernel, spec: BinSpec, surface: LabelTabSurface, face: NonNullable<NonNullable<BinSpec["labelTab"]>["snap"]>["face"] & {}): CrossSection {
  const { arena } = kernel;
  const bounds = ringBounds(surface.ring)!;
  const x = (bounds.minX + bounds.maxX) / 2, y = (bounds.minY + bounds.maxY) / 2;
  const outer = arena.track(new kernel.CrossSection([surface.ring.map(p => [p.x, p.y] as [number, number])], "NonZero"));
  const writing = labelTabWritingArea(spec, surface, face.thicknessMm + TEXT_HEIGHT_MM);
  if (!writing) throw new Error(`Tab ${surface.key} has no usable area above the shelf.`);
  const clip = arena.track(new kernel.CrossSection([writing.clip.map(p => [p.x, p.y] as [number, number])], "NonZero"));
  const usable = arena.track(outer.intersect(clip));
  const safe = face.marginMm ? arena.track(usable.offset(-face.marginMm, "Round", 2, 24)) : usable;
  if (safe.isEmpty()) throw new Error(`Tab ${surface.key} has no room for the requested face margin.`);
  if (face.mode === "auto") return arena.track(arena.track(safe.translate([-x, -y])).rotate(-surface.rotationDeg));
  const manual = section(kernel, face.widthMm, face.heightMm);
  const placed = arena.track(arena.track(manual.rotate(surface.rotationDeg)).translate([x, y]));
  if (arena.track(placed.subtract(safe)).area() > 1e-4) {
    throw new Error(`The ${face.widthMm} × ${face.heightMm} mm face does not fit tab ${surface.key} with its ${face.marginMm} mm margin.`);
  }
  return manual;
}

/** Separate, flat-on-bed label solids. A face is assigned to a real shelf; the
 * measured latch profile stays unchanged beneath it. */
export function buildSnapLabels(kernel: Kernel, spec: BinSpec, body?: Manifold): {
  parts: SnapLabelPart[]; issues: ValidationIssue[];
} {
  const snap = spec.labelTab?.snap;
  if (!snap) return { parts: [], issues: [] };
  const { arena } = kernel;
  const surfaces = labelTabSurfaces(spec);
  const parts: SnapLabelPart[] = [], issues: ValidationIssue[] = [];
  for (const [index, text] of snap.labels.entries()) {
    try {
      const surface = surfaces.find(tab => tab.key === (snap.tabKeys?.[index] ?? surfaces[index % surfaces.length]?.key));
      if (snap.face && !surface) throw new Error(`Snap label “${text}” needs an existing tab assignment.`);
      const face = snap.face && surface ? faceSection(kernel, spec, surface, snap.face) : null;
      const outline = surfaceTextOutline({ id: text, text, font: "helvetiker-bold", sizeMm: snap.face?.textSizeMm ?? 3.2,
        heightMm: TEXT_HEIGHT_MM, position: { x: 0, y: 0 }, rotationDeg: 0 });
      const rings = outline.flatMap(shape => [shape.outer, ...shape.holes]);
      const letters = arena.track(new kernel.CrossSection(rings.map(ring => ring.map(p =>
        [p.x, p.y] as [number, number])), "NonZero"));
      const bounds = letters.bounds();
      if (face) {
        const safeText = arena.track(face.offset(-0.8, "Round", 2, 24));
        if (safeText.isEmpty() || arena.track(letters.subtract(safeText)).area() > 1e-4) {
          throw new Error(`Snap label “${text}” text does not fit inside the face on tab ${surface!.key}.`);
        }
      } else if (bounds.max[0] - bounds.min[0] > snap.widthMm - 2 ||
          bounds.max[1] - bounds.min[1] > SNAP_LABEL_HEIGHT_MM - 2) {
        throw new Error(`Snap label “${text}” is too large for its ${snap.widthMm} mm base.`);
      }
      const raised = arena.track(arena.track(letters.extrude(TEXT_HEIGHT_MM))
        .translate([0, 0, SNAP_LABEL_DEPTH_MM + (snap.face?.thicknessMm ?? 0)]));
      const base = labelBase(kernel, snap.widthMm);
      const plate = face ? arena.track(arena.track(face.extrude(snap.face!.thicknessMm))
        .translate([0, 0, SNAP_LABEL_DEPTH_MM])) : null;
      const solid = arena.track(base.add(plate ? arena.track(plate.add(raised)) : raised));
      if (solid.status() !== "NoError" || solid.isEmpty()) throw new Error(`Could not build snap label “${text}”.`);
      if (solid.decompose().map(part => arena.track(part)).filter(part => part.volume() > 1e-5).length !== 1) {
        throw new Error(`Snap label “${text}” is not one connected printable part.`);
      }
      if (face && surface && body) {
        const tabBounds = ringBounds(surface.ring)!;
        const seated = place(kernel, solid, (tabBounds.minX + tabBounds.maxX) / 2,
          (tabBounds.minY + tabBounds.maxY) / 2, surface.z - SNAP_LABEL_DEPTH_MM, surface.rotationDeg);
        if (arena.track(seated.intersect(body)).volume() > 0.001) {
          throw new Error(`Snap label “${text}” face collides with the bin at tab ${surface.key}.`);
        }
      }
      const faceBounds = face?.bounds();
      parts.push({ text, solid, widthMm: faceBounds ? faceBounds.max[0] - faceBounds.min[0] : snap.widthMm,
        ...(surface ? { tabKey: surface.key } : {}) });
    } catch (cause) {
      issues.push({ code: "snap-label-text", severity: "error",
        message: cause instanceof Error ? cause.message : `Could not build snap label “${text}”.` });
    }
  }
  return { parts, issues };
}
