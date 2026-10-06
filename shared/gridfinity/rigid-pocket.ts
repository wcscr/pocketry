import { convexHull } from "../geometry/obb";
import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import { resolvePlacedPocketDepth, resolvePocketDepth, type CutoutPlacement, type DepthSpec, type TracedShape } from "./cutout";
import { placeObjectCells, placeObjectVertices, rotateObjectVector, sectionObjectCell, type ConvexObjectCell, type ObjectRotation, type Vec3 } from "./object-pose";
import { profileCells } from "./profile-bottom";
import { resolvePocketSplit } from "./pocket-split";
import type { BinSpec } from "./types";
import { pocketInsertionAxis } from "./pocket-insertion";

export const hasRigidPocket = (p: { elevationMm?: number }): boolean => p.elevationMm !== undefined;
export const pocketRotation = (p: Pick<CutoutPlacement, "tilt" | "rotationDeg">): ObjectRotation => ({
  xDeg: p.tilt?.xDeg ?? 0, yDeg: p.tilt?.yDeg ?? 0, zDeg: p.rotationDeg,
});

/** Resolve the current dimensions once when starting a rigid edit. In particular,
 * each split seat uses its own outline when converting legacy floor clearance. */
export function rigidPocket(p: CutoutPlacement, shape: Pick<TracedShape, "outlineMm">, spec: BinSpec): CutoutPlacement {
  const alreadyRigid = hasRigidPocket(p);
  if (alreadyRigid && (p.split?.depths ?? [p.depth]).every(d => d.mode === "mm" || d.sourceDepthMm !== undefined)) return p;
  const regions = p.split ? resolvePocketSplit(shape.outlineMm, p.split.boundary).regions : null;
  const resolved = (p.split?.depths ?? [p.depth]).map((d, i) => resolvePlacedPocketDepth(spec, d,
    { outlineMm: regions?.[i] ?? shape.outlineMm }, p));
  const freeze = (d: DepthSpec, i: number): DepthSpec => d.mode === "mm" ? d
    : { ...d, sourceDepthMm: d.sourceDepthMm ?? Math.max(0.1, resolved[i].axialDepthMm ?? resolved[i].depthMm ?? resolvePocketDepth(spec,d).infillTopZ) };
  return { ...p, zOffsetMm: undefined, elevationMm: p.elevationMm ?? Math.max(0, Math.min(300,
    Math.min(...resolved.map(r => r.floorZ ?? 0)))),
    depth: p.split ? p.depth : freeze(p.depth, 0),
    split: p.split ? { ...p.split, depths: [freeze(p.split.depths[0], 0), freeze(p.split.depths[1], 1)] } : undefined };
}

/** Every depth mode retains a finite source extrusion on its own Z axis.
 * Through disables floor protection; it never changes the object into a shaft. */
function sourceRegions(outline: Outline, p: CutoutPlacement, top: number) {
  const regions = p.split ? resolvePocketSplit(outline, p.split.boundary).regions : null;
  return (regions ?? [outline]).map((region, i) => {
    const d = p.split?.depths[i] ?? p.depth;
    const depth = d.mode === "mm" ? d.value : d.mode === "remaining" ? d.sourceDepthMm ?? Math.max(0.1, top - d.floorThicknessMm) : d.sourceDepthMm ?? Math.max(0.1,top);
    const limits = [-depth, 0];
    return { region, limits };
  });
}

/** Boundary loops for the immediate drag preview and nominal rotation anchor.
 * Internal scan-line cells never participate in drawing the source outline. */
export function pocketSourceRings(outline: Outline, p: CutoutPlacement, top = 0): Vec3[][] {
  return sourceRegions(outline, p, top).flatMap(({ region, limits }) =>
    region.flatMap(part => [part.outer, ...part.holes].flatMap(ring => limits.map(z => ring.map(v => ({
      x: v.x * p.scaleX * (p.mirrored ? -1 : 1), y: v.y * p.scaleY, z,
    }))))));
}

export function rigidPocketVertices(outline: Outline, p: CutoutPlacement, top = 0): Vec3[] {
  return placeObjectVertices(pocketSourceRings(outline, p, top).flat(), {
    rotation: pocketRotation(p), position: p.position, elevationMm: p.elevationMm ?? 0,
  });
}

export function pocketSourceCells(outline: Outline, p: CutoutPlacement, top = 0): ConvexObjectCell[] {
  return sourceRegions(outline, p, top).flatMap(({ region, limits }) => {
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
  });
}

/** Immediate conservative footprint; final boundaries come from the generated solid. */
export function rigidPocketFootprint(outline: Outline, p: CutoutPlacement, top = Infinity, sourceTop = Number.isFinite(top) ? top : 0): Outline {
  return rigidPocketCells(outline,p,sourceTop).flatMap(cell => {
    const axis = pocketInsertionAxis(p);
    const points = !Number.isFinite(top) || p.insertionMode === "vertical" ? cell.vertices
      : p.insertionMode === "axis" && axis.z >= 0.01
        ? cell.vertices.filter(v => v.z <= top).map(v => ({
          x:v.x+axis.x*(top-v.z)/axis.z, y:v.y+axis.y*(top-v.z)/axis.z, z:top,
        })).concat(sectionObjectCell(cell,top))
        : sectionObjectCell(cell,top);
    const outer = convexHull(points.map(({ x, y }) => ({ x, y })));
    return outer.length >= 3 && signedArea(outer) > 1e-8 ? [{ outer, holes: [] }] : [];
  });
}

/** Source boundary loops move with the original object, including through
 * pockets. Cutters and bin surfaces never become transform handles. */
export function rigidPocketPreviewWires(outline: Outline, p: CutoutPlacement, spec: BinSpec): Vec3[][] {
  const top = resolvePocketDepth(spec,p.depth).infillTopZ;
  const rings = pocketSourceRings(outline,p,top);
  const posed = rigidPocketVertices(outline,p,top);
  const wires: Vec3[][] = [];
  let offset = 0;
  for (let i = 0; i < rings.length; i += 2) {
    const n = rings[i].length;
    if (n) {
      const bottom = posed.slice(offset,offset+n), upper = posed.slice(offset+n,offset+2*n);
      wires.push([...bottom,bottom[0]],[...upper,upper[0]]);
      for (let j = 0; j < n; j += Math.max(1,Math.ceil(n/8))) wires.push([bottom[j],upper[j]]);
    }
    offset += n*2;
  }
  return wires;
}

/** Reserve the entire seated pocket and its path, without dividing by a horizontal axis. */
export function rigidPocketOccupiedFootprint(outline: Outline, p: CutoutPlacement, top: number, sourceTop = top): Outline {
  if (p.insertionMode === "axis") {
    const axis = pocketInsertionAxis(p);
    if (axis.z >= 0.01) return rigidPocketCells(outline,p,sourceTop).flatMap(cell => {
      const points = cell.vertices.flatMap(v => [v, ...(v.z < top ? [{
        x:v.x+axis.x*(top-v.z)/axis.z, y:v.y+axis.y*(top-v.z)/axis.z,
      }] : [])]);
      const outer = convexHull(points);
      return outer.length >= 3 ? [{outer,holes:[]}] : [];
    });
  }
  const mouth = rigidPocketFootprint(outline, p, top, sourceTop);
  const source = rigidPocketFootprint(outline, p, Infinity, sourceTop);
  return [...source, ...mouth];
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
