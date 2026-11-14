/** Independent geometric review aids for paired detector results. */
import { outsideSilhouettes } from "../client/src/lib/geometry/outline";
import { distanceToSegment, pointInRing } from "../shared/geometry/rings";
import type { Point, Ring } from "../shared/geometry/types";
import type { DetectResult } from "../client/src/lib/detect/types";
export interface Probe { name: string; kind: "body" | "feature"; object?: number; point: Point; radius: number }
interface AuditCase { width: number; height: number; probes: Probe[] }
type Result = Pick<DetectResult, "outline" | "rawOutline">;
function probe(rings: Ring[], p: Probe) {
  const shapes = rings.flatMap((ring, i) => pointInRing(ring, p.point) ? [i] : []);
  const distance = shapes.length ? 0 : Math.min(...rings.flatMap(ring => ring.map((a, i) => distanceToSegment(p.point, a, ring[(i + 1) % ring.length]))));
  return { shapes, distance: Number.isFinite(distance) ? distance : null, present: shapes.length > 0 || distance <= p.radius };
}
/** Scanline rasterization avoids repeated point-in-polygon work in the timed path. */
function raster(rings: Ring[], width: number, height: number) {
  const scale = Math.min(1, 512 / Math.max(width, height)), w = Math.ceil(width * scale), h = Math.ceil(height * scale);
  const mask = new Uint8Array(w * h);
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    for (let y = 0; y < h; y++) {
      const py = (y + .5) / scale, xs: number[] = [];
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length];
        if ((a.y > py) !== (b.y > py)) xs.push((a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)) * scale); }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.ceil(xs[i] - .5)); x < Math.min(w, Math.ceil(xs[i + 1] - .5)); x++) mask[y * w + x] = ri + 1;
    }
  }
  return mask;
}
export function auditOutlinePair(c: AuditCase, a: Result, b: Result) {
  const old = outsideSilhouettes(a.outline).map(s => s.outer), next = outsideSilhouettes(b.outline).map(s => s.outer);
  const denseOld = outsideSilhouettes(a.rawOutline).map(s => s.outer), denseNext = outsideSilhouettes(b.rawOutline).map(s => s.outer);
  const probes = c.probes.map(p => ({ ...p, before: probe(old, p), after: probe(next, p),
    denseBefore: probe(denseOld, p), denseAfter: probe(denseNext, p) }));
  const pairChecks = [];
  for (let i = 0; i < probes.length; i++) for (let j = i + 1; j < probes.length; j++) {
    const p = probes[i], q = probes[j];
    if (p.kind !== "body" || q.kind !== "body" || p.object === q.object) continue;
    const oldShared = p.before.shapes.some(s => q.before.shapes.includes(s));
    const newShared = p.after.shapes.some(s => q.after.shapes.includes(s));
    pairChecks.push({ names: [p.name, q.name], oldShared, newShared, newlyMerged: !oldShared && newShared });
  }
  const x = raster(old, c.width, c.height), y = raster(next, c.width, c.height);
  let lost = 0, gained = 0, retained = 0; const overlap: number[][] = old.map(() => next.map(() => 0));
  for (let i = 0; i < x.length; i++) { if (x[i] && y[i]) { retained++; overlap[x[i] - 1][y[i] - 1]++; }
    else if (x[i]) lost++; else if (y[i]) gained++; }
  return { denseUnchanged: JSON.stringify(a.rawOutline) === JSON.stringify(b.rawOutline), unchanged: JSON.stringify(a.outline) === JSON.stringify(b.outline), beforeShapes: old.length, afterShapes: next.length,
    probes, pairChecks, overlap, lostPixels: lost, gainedPixels: gained, retainedPixels: retained,
    lostFraction: lost / Math.max(1, lost + retained), iou: retained / Math.max(1, retained + lost + gained) };
}
