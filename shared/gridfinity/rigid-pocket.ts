import { convexHull } from "../geometry/obb";
import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import { resolvePlacedPocketDepth, type CutoutPlacement, type DepthSpec, type TracedShape } from "./cutout";
import { placeObjectCells, placeObjectVertices, rotateObjectVector, sectionObjectCell, type ConvexObjectCell, type ObjectRotation, type Vec3 } from "./object-pose";
import { profileCells } from "./profile-bottom";
import { resolvePocketSplit } from "./pocket-split";
import type { BinSpec } from "./types";

export const hasRigidPocket = (p: { elevationMm?: number }): boolean => p.elevationMm !== undefined;
export const pocketRotation = (p: Pick<CutoutPlacement, "tilt" | "rotationDeg">): ObjectRotation => ({
  xDeg: p.tilt?.xDeg ?? 0, yDeg: p.tilt?.yDeg ?? 0, zDeg: p.rotationDeg,
});

/** Resolve the current dimensions once when starting a rigid edit. In particular,
 * each split seat uses its own outline when converting legacy floor clearance. */
export function rigidPocket(p: CutoutPlacement, shape: Pick<TracedShape, "outlineMm">, spec: BinSpec): CutoutPlacement {
  if (hasRigidPocket(p)) return p;
  const regions = p.split ? resolvePocketSplit(shape.outlineMm, p.split.boundary).regions : null;
  const resolved = (p.split?.depths ?? [p.depth]).map((d, i) => resolvePlacedPocketDepth(spec, d,
    { outlineMm: regions?.[i] ?? shape.outlineMm }, p));
  const freeze = (d: DepthSpec, i: number): DepthSpec => d.mode !== "remaining" ? d
    : { mode: "mm", value: Math.max(0.1, resolved[i].axialDepthMm ?? resolved[i].depthMm ?? 1) };
  return { ...p, zOffsetMm: undefined, elevationMm: Math.max(0, Math.min(300,
    Math.min(...resolved.map(r => r.floorZ ?? 0)))),
    depth: p.split ? p.depth : freeze(p.depth, 0),
    split: p.split ? { ...p.split, depths: [freeze(p.split.depths[0], 0), freeze(p.split.depths[1], 1)] } : undefined };
}

/** Source extrusion occupies [-depth, 0] on its own Z axis. Through sections
 * use a long two-sided tool; the builder sizes it to the actual bin. */
function sourceRegions(outline: Outline, p: CutoutPlacement, top: number, throughReach: number, nominalThrough: boolean) {
  if (p.layers && p.depth.mode === "mm") {
    const depth = p.depth.value;
    return p.layers.map(layer => ({ region: layer.outlineMm,
      limits: [(layer.bottom - 1) * depth, (layer.top - 1) * depth] }));
  }
  const regions = p.split ? resolvePocketSplit(outline, p.split.boundary).regions : null;
  return (regions ?? [outline]).map((region, i) => {
    const d = p.split?.depths[i] ?? p.depth;
    const depth = d.mode === "mm" ? d.value : d.mode === "remaining" ? Math.max(0.1, top - d.floorThicknessMm) : 1;
    const limits = d.mode === "through" ? nominalThrough ? [-1, 0] : [-throughReach, throughReach] : [-depth, 0];
    return { region, limits };
  });
}

/** Boundary loops for the immediate drag preview and nominal rotation anchor.
 * Internal scan-line cells never participate in drawing the source outline. */
export function pocketSourceRings(outline: Outline, p: CutoutPlacement, top = 0, nominalThrough = false): Vec3[][] {
  return sourceRegions(outline, p, top, 1000, nominalThrough).flatMap(({ region, limits }) =>
    region.flatMap(part => [part.outer, ...part.holes].flatMap(ring => limits.map(z => ring.map(v => ({
      x: v.x * p.scaleX * (p.mirrored ? -1 : 1), y: v.y * p.scaleY, z,
    }))))));
}

export function rigidPocketVertices(outline: Outline, p: CutoutPlacement, top = 0): Vec3[] {
  return placeObjectVertices(pocketSourceRings(outline, p, top).flat(), {
    rotation: pocketRotation(p), position: p.position, elevationMm: p.elevationMm ?? 0,
  }, pocketSourceRings(outline, p, top, true).flat());
}

export function pocketSourceCells(outline: Outline, p: CutoutPlacement, top = 0, throughReach = 1000, nominalThrough = false): ConvexObjectCell[] {
  return sourceRegions(outline, p, top, throughReach, nominalThrough).flatMap(({ region, limits }) => {
    return profileCells(region).map(ring => {
      const n = ring.length, edges: [number, number][] = [];
      for (let j = 0; j < n; j++) edges.push([j, (j + 1) % n], [j + n, (j + 1) % n + n], [j, j + n]);
      return { edges, vertices: limits.flatMap(z => ring.map(v => ({
        x: v.x * p.scaleX * (p.mirrored ? -1 : 1), y: v.y * p.scaleY, z,
      }))) };
    });
  });
}

export function rigidPocketCells(outline: Outline, p: CutoutPlacement, top = 0): ConvexObjectCell[] {
  return placeObjectCells(pocketSourceCells(outline, p, top), {
    rotation: pocketRotation(p), position: p.position, elevationMm: p.elevationMm ?? 0,
  }, pocketSourceCells(outline, p, top, 1000, true));
}

/** Immediate conservative footprint; final boundaries come from the generated solid. */
export function rigidPocketFootprint(outline: Outline, p: CutoutPlacement, top = Infinity): Outline {
  return rigidPocketCells(outline, p).flatMap(cell => {
    const points = Number.isFinite(top) ? sectionObjectCell(cell, top) : cell.vertices;
    const outer = convexHull(points.map(({ x, y }) => ({ x, y })));
    return outer.length >= 3 && signedArea(outer) > 1e-8 ? [{ outer, holes: [] }] : [];
  });
}

/** Preserve the finite solid from the old profile prototype, including its
 * centered extrusion. Composition is matrix-based to handle exact 90° poses. */
export function migrateProfilePocket(p: CutoutPlacement): CutoutPlacement {
  if (!p.profileBottom) return p;
  const profile = p.profileBottom;
  const edge = { xDeg: profile.edge === "bottom" ? 90 : profile.edge === "top" ? -90 : 0,
    yDeg: profile.edge === "left" ? -90 : profile.edge === "right" ? 90 : 0, zDeg: 0 };
  const rotation = { xDeg: p.profileRotation?.xDeg ?? 0, yDeg: p.profileRotation?.yDeg ?? 0, zDeg: p.rotationDeg };
  const [x, y, z] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
    .map(v => rotateObjectVector(rotateObjectVector(v, edge), rotation));
  const ry = Math.asin(Math.max(-1, Math.min(1, -x.z)));
  const rx = Math.abs(x.z) < 0.9999999999 ? Math.atan2(y.z, z.z) : 0;
  const rz = Math.abs(x.z) < 0.9999999999 ? Math.atan2(x.y, x.x) : Math.atan2(-y.x, y.y);
  return { ...p, profileBottom: undefined, profileRotation: undefined, zOffsetMm: undefined,
    elevationMm: profile.elevationMm, tilt: { xDeg: rx * 180 / Math.PI, yDeg: ry * 180 / Math.PI }, rotationDeg: rz * 180 / Math.PI,
    position: { x: p.position.x + z.x * profile.widthMm / 2, y: p.position.y + z.y * profile.widthMm / 2 },
    depth: { mode: "mm", value: profile.widthMm }, split: undefined,
    clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 };
}

/** Clear only pitch and roll. Keep the current lowest point and Z heading. */
export function resetPocketPlane(p: CutoutPlacement, shape: Pick<TracedShape, "outlineMm">, spec: BinSpec): CutoutPlacement {
  return { ...rigidPocket(migrateProfilePocket(p), shape, spec), tilt: { xDeg: 0, yDeg: 0 } };
}
