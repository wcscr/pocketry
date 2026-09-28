import type { Manifold } from "manifold-3d";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { resolvePocketDepth, transformOutlinePlacement } from "@shared/gridfinity/cutout";
import { profileFootprint } from "@shared/gridfinity/profile-bottom";
import type { Outline } from "@shared/geometry/types";
import type { BinSpec } from "@shared/gridfinity/types";
import { toCrossSection, polygonsToOutline } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";
import { buildObjectCavity } from "./object-cavity";
import { rotateObjectVector } from "@shared/gridfinity/object-pose";

/** Subtract the finite profile extrusion at its rigid pose. Preview and export
 * share this source solid, so both the supporting contour and the surface section
 * stay independent of rendering quality. */
export function buildProfileBottomCutout(kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement,
  spec: BinSpec, floorInsertThicknessMm = 0,
): { cutters: Manifold[]; floorInserts: Manifold[]; floorRegions: Manifold[]; reports: { id: string; emptied: boolean }[] } {
  const { arena } = kernel, profile = cutout.profileBottom!;
  const { cutterTopZ, infillTopZ } = resolvePocketDepth(spec, { mode: "through" });
  const outline = transformOutlinePlacement(shape.outlineMm, {position:{x:0,y:0}, rotationDeg:0,
    scaleX:cutout.scaleX, scaleY:cutout.scaleY, mirrored:cutout.mirrored});
  const section = toCrossSection(kernel, outline);
  const extrusion = arena.track(section.extrude(profile.widthMm));
  const centered = arena.track(extrusion.translate([0, 0, -profile.widthMm / 2]));
  const edgeRotation: [number, number, number] = profile.edge === "bottom" ? [90,0,0]
    : profile.edge === "top" ? [-90,0,0] : profile.edge === "left" ? [0,-90,0] : [0,90,0];
  const source = arena.track(centered.rotate(edgeRotation));
  const pose = {position:cutout.position, elevationMm:profile.elevationMm,
    rotation:{xDeg:cutout.profileRotation?.xDeg ?? 0,yDeg:cutout.profileRotation?.yDeg ?? 0,zDeg:cutout.rotationDeg}};
  const cutter = buildObjectCavity(kernel, source, pose, cutterTopZ);
  const floorInserts: Manifold[] = [], floorRegions: Manifold[] = [];
  if (cutter && floorInsertThicknessMm > 0 && profile.elevationMm < infillTopZ) {
    const distance = Math.min(floorInsertThicknessMm, profile.elevationMm);
    // Express world-down in the source frame, then form the thin band before
    // posing it. Subtracting coincident rotated walls can create export seams.
    const axes = [{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}].map(v => rotateObjectVector(v, pose.rotation));
    const below = arena.track(source.translate(axes.map(v => -distance * v.z) as [number,number,number]));
    const band = arena.track(below.subtract(source));
    const insert = buildObjectCavity(kernel, band, pose, cutterTopZ, source);
    if (insert) floorInserts.push(insert);
    const region = buildObjectCavity(kernel, below, pose, cutterTopZ, source);
    if (region) floorRegions.push(region);
  }
  return { cutters: cutter ? [cutter] : [], floorInserts, floorRegions, reports: [{ id: cutout.id, emptied: source.isEmpty() }] };
}

/** Resolve projected source cells with the same kernel used by the cutter.
 * Hit testing may use their union directly; display/export need the boundary
 * without internal cell seams or overlapping SVG/DXF contours. */
export function resolvedProfileFootprint(kernel: Kernel, outline: Outline, cutout: CutoutPlacement, top = Infinity): Outline {
  const cells = profileFootprint(outline, cutout, top);
  return cells.length ? polygonsToOutline(toCrossSection(kernel, cells).toPolygons()) : cells;
}
