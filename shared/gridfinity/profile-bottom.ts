import { z } from "zod";
import type { Outline, Point, Ring } from "../geometry/types";
import type { CutoutPlacement } from "./cutout";
import { convexHull } from "../geometry/obb";
import { dedupeRing, signedArea } from "../geometry/rings";
import { sectionObjectCell, placeObjectCells, type ConvexObjectCell, type Vec3 } from "./object-pose";

/** A side silhouette swept across a straight slot. Ordinary depth/tilt settings
 * remain stored but inactive so switching modes never destroys the old pocket. */
export const profileBottomSchema = z.object({
  edge: z.enum(["bottom", "top", "left", "right"]),
  widthMm: z.number().finite().min(0.1).max(300),
  elevationMm: z.number().finite().min(0).max(300),
}).strict();
export type ProfileBottom = z.infer<typeof profileBottomSchema>;
export type ProfilePlacement = Pick<CutoutPlacement, "position" | "rotationDeg" | "mirrored">
  & Partial<Pick<CutoutPlacement, "scaleX" | "scaleY" | "profileBottom" | "profileRotation">>;
export interface ProfileSegment { a: Point; b: Point }
const EPS = 1e-8;
const cache = new WeakMap<Outline, Map<ProfileBottom["edge"], readonly ProfileSegment[]>>();

/** X is distance along the slot and Y is height, before placement. */
function edgePoint(p: Point, edge: ProfileBottom["edge"]): Point {
  switch (edge) {
    case "bottom": return { x: p.x, y: p.y };
    case "top": return { x: p.x, y: -p.y };
    case "left": return { x: p.y, y: p.x };
    case "right": return { x: p.y, y: -p.x };
  }
}
const at = (s: ProfileSegment, x: number): number => s.a.y + (s.b.y - s.a.y) * (x - s.a.x) / (s.b.x - s.a.x);

/** Exact piecewise-linear lower envelope. Vertex events keep only crossing
 * edges active; intersection events also handle overlapping outline components.
 * Cache the source envelope, not mutable placement dimensions or elevation. */
function sourceEnvelope(outline: Outline, edge: ProfileBottom["edge"]): readonly ProfileSegment[] {
  let byEdge = cache.get(outline);
  const found = byEdge?.get(edge);
  if (found) return found;
  const events = new Map<number, { start: ProfileSegment[]; end: ProfileSegment[] }>();
  const event = (x: number) => {
    let value = events.get(x);
    if (!value) { value = { start: [], end: [] }; events.set(x, value); }
    return value;
  };
  for (const shape of outline) for (let i = 0; i < shape.outer.length; i++) {
    let a = edgePoint(shape.outer[i], edge), b = edgePoint(shape.outer[(i + 1) % shape.outer.length], edge);
    if (Math.abs(a.x - b.x) < EPS) continue;
    if (a.x > b.x) [a, b] = [b, a];
    const segment = { a, b };
    event(a.x).start.push(segment); event(b.x).end.push(segment);
  }
  const xs = [...events.keys()].sort((a, b) => a - b);
  const active = new Set<ProfileSegment>();
  const result: ProfileSegment[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const left = xs[i], right = xs[i + 1], changes = events.get(left)!;
    changes.end.forEach(s => active.delete(s)); changes.start.forEach(s => active.add(s));
    const candidates = [...active], breaks = [left, right];
    for (let j = 0; j < candidates.length; j++) for (let k = j + 1; k < candidates.length; k++) {
      const d0 = at(candidates[j], left) - at(candidates[k], left);
      const d1 = at(candidates[j], right) - at(candidates[k], right);
      if (d0 * d1 < 0) breaks.push(left + (right - left) * d0 / (d0 - d1));
    }
    breaks.sort((a, b) => a - b);
    for (let j = 0; j < breaks.length - 1 && candidates.length; j++) {
      const a = breaks[j], b = breaks[j + 1];
      if (b - a < EPS) continue;
      const mid = (a + b) / 2;
      const lowest = candidates.reduce((best, s) => at(s, mid) < at(best, mid) ? s : best);
      const next = { a: { x: a, y: at(lowest, a) }, b: { x: b, y: at(lowest, b) } };
      const previous = result[result.length - 1];
      if (previous && Math.abs(previous.b.x - a) < EPS && Math.abs(previous.b.y - next.a.y) < EPS
        && Math.abs((previous.b.y - previous.a.y) * (b - a) - (next.b.y - next.a.y) * (previous.b.x - previous.a.x)) < EPS) {
        previous.b = next.b;
      } else result.push(next);
    }
  }
  if (!byEdge) { byEdge = new Map(); cache.set(outline, byEdge); }
  byEdge.set(edge, result);
  return result;
}

/** Profile length follows local X for top/bottom and local Y for left/right. */
export function profileAlongX(profile: ProfileBottom): boolean {
  return profile.edge === "bottom" || profile.edge === "top";
}

/** Lowest contour point is exactly elevationMm, independently of outline size. */
export function profileFloorSegments(outline: Outline, placement: ProfilePlacement): ProfileSegment[] {
  const profile = placement.profileBottom;
  if (!profile) return [];
  const alongX = profileAlongX(profile);
  const edge = !alongX && placement.mirrored ? (profile.edge === "left" ? "right" : "left") : profile.edge;
  const source = sourceEnvelope(outline, edge);
  if (!source.length) return [];
  const min = Math.min(...source.flatMap(s => [s.a.y, s.b.y]));
  const lengthScale = (alongX ? placement.scaleX : placement.scaleY) ?? 1;
  const heightScale = (alongX ? placement.scaleY : placement.scaleX) ?? 1;
  const flip = alongX && placement.mirrored ? -1 : 1;
  const point = (p: Point): Point => ({ x: p.x * lengthScale * flip, y: (p.y - min) * heightScale + profile.elevationMm });
  return source.map(s => { const a = point(s.a), b = point(s.b); return a.x < b.x ? { a, b } : { a: b, b: a }; }).sort((a, b) => a.a.x - b.a.x);
}

/** Rigid placement of the already-scaled slot, with Z rotation applied last. */
export function placeProfilePoint(u: number, v: number, placement: ProfilePlacement): Point {
  const alongX = profileAlongX(placement.profileBottom!);
  const x = alongX ? u : v, y = alongX ? v : u;
  const angle = placement.rotationDeg * Math.PI / 180;
  return { x: placement.position.x + x * Math.cos(angle) - y * Math.sin(angle), y: placement.position.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

/** Sections of the actual object at top; Infinity gives the full editable footprint,
 * which stays selectable even after lifting the contour clear of the bin. */
export function profileFootprint(outline: Outline, placement: ProfilePlacement, top = Infinity): Outline {
  const profile = placement.profileBottom;
  if (!profile) return [];
  if (Number.isFinite(top) || hasProfileRotation(placement)) return profilePrisms(outline, placement).flatMap(prism => {
    const outer = convexHull((Number.isFinite(top) ? sectionObjectCell(prism, top) : prism.vertices).map(({ x, y }) => ({ x, y })));
    return outer.length >= 3 && signedArea(outer) > EPS ? [{ outer, holes: [] }] : [];
  });
  const spans: [number, number][] = [];
  for (const { a, b } of profileFloorSegments(outline, placement)) {
    if (Math.min(a.y, b.y) >= top - EPS) continue;
    const left = a.y > top ? a.x + (b.x - a.x) * (top - a.y) / (b.y - a.y) : a.x;
    const right = b.y > top ? a.x + (b.x - a.x) * (top - a.y) / (b.y - a.y) : b.x;
    const previous = spans[spans.length - 1];
    if (previous && Math.abs(previous[1] - left) < EPS) previous[1] = right;
    else if (right - left > EPS) spans.push([left, right]);
  }
  return spans.map(([left, right]) => {
    const half = profile.widthMm / 2;
    const ring = [[left, -half], [right, -half], [right, half], [left, half]].map(([u, v]) => placeProfilePoint(u, v, placement));
    return { outer: profileAlongX(profile) ? ring : ring.reverse(), holes: [] };
  });
}

export function hasProfileRotation(placement: Pick<ProfilePlacement, "profileBottom" | "profileRotation">): boolean {
  return !!placement.profileBottom && ((placement.profileRotation?.xDeg ?? 0) !== 0 || (placement.profileRotation?.yDeg ?? 0) !== 0);
}

/** Convex cells of the source silhouette, retaining concavities, holes and gaps.
 * Only immutable source geometry is cached. A scanline pairs each entry with
 * its matching exit across the outer boundary and all interior rings. */
const cellCache = new WeakMap<Outline, readonly Ring[]>();
export function profileCells(outline: Outline): readonly Ring[] {
  const cached = cellCache.get(outline);
  if (cached) return cached;
  const cells: Ring[] = [];
  for (const { outer, holes } of outline) {
    const events = new Map<number, { start: ProfileSegment[]; end: ProfileSegment[] }>();
    const event = (x: number) => {
      let value = events.get(x);
      if (!value) { value = { start: [], end: [] }; events.set(x, value); }
      return value;
    };
    for (const ring of [outer, ...holes]) ring.forEach((p, i) => {
      let a = p, b = ring[(i + 1) % ring.length];
      if (Math.abs(a.x - b.x) < EPS) return;
      if (a.x > b.x) [a, b] = [b, a];
      const s = { a, b };
      event(a.x).start.push(s); event(b.x).end.push(s);
    });
    const xs = [...events.keys()].sort((a, b) => a - b), active = new Set<ProfileSegment>();
    for (let i = 0; i < xs.length - 1; i++) {
      const left = xs[i], right = xs[i + 1], changes = events.get(left)!;
      changes.end.forEach(s => active.delete(s)); changes.start.forEach(s => active.add(s));
      const edges = [...active].sort((a, b) => at(a, (left + right) / 2) - at(b, (left + right) / 2));
      for (let j = 0; j + 1 < edges.length; j += 2) {
        const ring = dedupeRing([
          { x: left, y: at(edges[j], left) }, { x: right, y: at(edges[j], right) },
          { x: right, y: at(edges[j + 1], right) }, { x: left, y: at(edges[j + 1], left) },
        ]);
        if (ring.length >= 3 && signedArea(ring) > EPS) cells.push(ring);
      }
    }
  }
  cellCache.set(outline, cells);
  return cells;
}

/** Both caps of a convex, constant-thickness piece of the rotated object. */
export interface ProfilePrism extends ConvexObjectCell { capSize: number }

/** Rotate the complete extruded silhouette, then put its lowest point at the
 * requested elevation. X/Y rotation is independent of the dormant pocket tilt;
 * the existing Z heading is applied last. This supports exact 90/180° poses. */
export function profilePrisms(outline: Outline, placement: ProfilePlacement): ProfilePrism[] {
  const profile = placement.profileBottom;
  if (!profile) return [];
  const alongX = profileAlongX(profile), half = profile.widthMm / 2;
  const point = (p: Point, v: number): Vec3 => {
    const scaled = { x: p.x * (placement.scaleX ?? 1) * (placement.mirrored ? -1 : 1), y: p.y * (placement.scaleY ?? 1) };
    const edge = edgePoint(scaled, profile.edge);
    return { x: alongX ? edge.x : v, y: alongX ? v : edge.x, z: edge.y };
  };
  const cells = profileCells(outline).map(ring => {
    const n = ring.length, edges: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push([i, j], [i + n, j + n], [i, i + n]);
    }
    return { capSize: n, edges, vertices: [-half, half].flatMap(v => ring.map(p => point(p, v))) };
  });
  const placed = placeObjectCells(cells, { position: placement.position, elevationMm: profile.elevationMm,
    rotation: { xDeg: placement.profileRotation?.xDeg ?? 0, yDeg: placement.profileRotation?.yDeg ?? 0, zDeg: placement.rotationDeg } });
  return placed.map((c, i) => ({ ...c, capSize: cells[i].capSize }));
}
