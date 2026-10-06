import { convexHull } from "../geometry/obb";
import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import { resolvePlacedPocketDepth, resolvePocketDepth, type CutoutPlacement, type DepthSpec, type TracedShape } from "./cutout";
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
  const alreadyRigid = hasRigidPocket(p);
  if (alreadyRigid && (p.split?.depths ?? [p.depth]).every(d => d.mode !== "remaining" || d.sourceDepthMm !== undefined)) return p;
  const regions = p.split ? resolvePocketSplit(shape.outlineMm, p.split.boundary).regions : null;
  const resolved = (p.split?.depths ?? [p.depth]).map((d, i) => resolvePlacedPocketDepth(spec, d,
    { outlineMm: regions?.[i] ?? shape.outlineMm }, p));
  const freeze = (d: DepthSpec, i: number): DepthSpec => d.mode !== "remaining" ? d
    : { ...d, sourceDepthMm: d.sourceDepthMm ?? Math.max(0.1, resolved[i].axialDepthMm ?? resolved[i].depthMm ?? 1) };
  return { ...p, zOffsetMm: undefined, elevationMm: p.elevationMm ?? Math.max(0, Math.min(300,
    Math.min(...resolved.map(r => r.floorZ ?? 0)))),
    depth: p.split ? p.depth : freeze(p.depth, 0),
    split: p.split ? { ...p.split, depths: [freeze(p.split.depths[0], 0), freeze(p.split.depths[1], 1)] } : undefined };
}

/** Source extrusion occupies [-depth, 0] on its own Z axis. Through sections
 * use a long two-sided tool; the builder sizes it to the actual bin. */
function sourceRegions(outline: Outline, p: CutoutPlacement, top: number, throughReach: number, nominalThrough: boolean) {
  const regions = p.split ? resolvePocketSplit(outline, p.split.boundary).regions : null;
  return (regions ?? [outline]).map((region, i) => {
    const d = p.split?.depths[i] ?? p.depth;
    const depth = d.mode === "mm" ? d.value : d.mode === "remaining" ? d.sourceDepthMm ?? Math.max(0.1, top - d.floorThicknessMm) : 1;
    const limits = d.mode === "through" ? nominalThrough ? [-1, 0] : [-throughReach, throughReach] : [-depth, 0];
    return { region, limits, through: d.mode === "through" };
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

export function pocketSourceCells(outline: Outline, p: CutoutPlacement, top = 0, throughReach = 1000, nominalThrough = false): (ConvexObjectCell & { through: boolean })[] {
  return sourceRegions(outline, p, top, throughReach, nominalThrough).flatMap(({ region, limits, through }) => {
    return profileCells(region).map(ring => {
      const n = ring.length, edges: [number, number][] = [];
      for (let j = 0; j < n; j++) edges.push([j, (j + 1) % n], [j + n, (j + 1) % n + n], [j, j + n]);
      return { edges, through, vertices: limits.flatMap(z => ring.map(v => ({
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
export function rigidPocketFootprint(outline: Outline, p: CutoutPlacement, top = Infinity, sourceTop = Number.isFinite(top) ? top : 0): Outline {
  const source = pocketSourceCells(outline, p, sourceTop);
  const cells = placeObjectCells(source, {
    rotation: pocketRotation(p), position: p.position, elevationMm: p.elevationMm ?? 0,
  }, pocketSourceCells(outline, p, sourceTop, 1000, true));
  return cells.flatMap((cell, i) => {
    const boundedThrough = source[i].through && p.insertionMode === "vertical" && sourceTop > 0;
    const points = boundedThrough
      ? [...cell.vertices.filter(v => v.z >= 0 && v.z <= sourceTop), ...sectionObjectCell(cell, 0), ...sectionObjectCell(cell, sourceTop)]
      : !Number.isFinite(top) || p.insertionMode === "vertical" ? cell.vertices : sectionObjectCell(cell, top);
    const outer = convexHull(points.map(({ x, y }) => ({ x, y })));
    return outer.length >= 3 && signedArea(outer) > 1e-8 ? [{ outer, holes: [] }] : [];
  });
}

/** Finite source wires stay intact. Through-pocket side faces stop at the bin.
 * Clipping boundary faces also works for sideways and inverted shafts without
 * dividing by the insertion axis or exposing the Boolean helper's end caps. */
export function rigidPocketPreviewWires(outline: Outline, p: CutoutPlacement, spec: BinSpec): Vec3[][] {
  const top = resolvePocketDepth(spec, p.depth).infillTopZ;
  const regions = sourceRegions(outline, p, top, 1000, false);
  const posed = rigidPocketVertices(outline, p, top);
  const wires: Vec3[][] = [];
  const planes: [keyof Vec3, number, number][] = [["z",0,1],["z",top,-1],
    ["x",-spec.gridX*21,1],["x",spec.gridX*21,-1],["y",-spec.gridY*21,1],["y",spec.gridY*21,-1]];
  let offset = 0;
  for (const { region, through } of regions) for (const part of region) for (const ring of [part.outer, ...part.holes]) {
    const n = ring.length;
    if (!through && n) {
      const bottom = posed.slice(offset,offset+n), upper = posed.slice(offset+n,offset+2*n);
      wires.push([...bottom,bottom[0]],[...upper,upper[0]]);
      for (let j = 0; j < n; j += Math.max(1,Math.ceil(n/8))) wires.push([bottom[j],upper[j]]);
    }
    if (through) for (let j = 0; j < n; j++) {
      let face = [posed[offset+j], posed[offset+(j+1)%n], posed[offset+n+(j+1)%n], posed[offset+n+j]];
      for (const [axis, limit, sign] of planes) {
        const clipped: Vec3[] = [];
        for (let k = 0; k < face.length; k++) {
          const a = face[k], b = face[(k+1)%face.length];
          const insideA = (a[axis]-limit)*sign >= 0, insideB = (b[axis]-limit)*sign >= 0;
          if (insideA) clipped.push(a);
          if (insideA !== insideB) {
            const t = (limit-a[axis])/(b[axis]-a[axis]);
            clipped.push({ x:a.x+t*(b.x-a.x), y:a.y+t*(b.y-a.y), z:a.z+t*(b.z-a.z), [axis]:limit });
          }
        }
        face = clipped;
      }
      if (face.length >= 3) wires.push([...face,face[0]]);
    }
    offset += n*2;
  }
  return wires;
}

/** Reserve the entire seated pocket and its path, without dividing by a horizontal axis. */
export function rigidPocketOccupiedFootprint(outline: Outline, p: CutoutPlacement, top: number, sourceTop = top): Outline {
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
