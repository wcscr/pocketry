import { distanceToSegment, pointInRing, signedArea } from "./rings";
import type { Outline, Point, Ring } from "./types";

/**
 * Outward-only straightening: small dips in an outline are replaced by the
 * straight line over them.
 *
 * A traced tool edge carries detail a pocket has no use for: the ribs of a
 * rubber grip, a mould line, a notch, the last wobble of the detector. A pocket
 * cut to that detail gets thin fins nobody wants, and the outline gets points
 * nobody wants to edit. Smoothing does not remove them, because it averages:
 * to lose a 0.3 mm rib it would also have to shave the crests either side.
 *
 * A *bridge* here is a straight line between two points of the same ring that
 * replaces what lies between them. It is taken only when all of this holds:
 *
 * 1. Nothing between the two points is outside the line, so no material is
 *    ever removed. The tool always still fits.
 * 2. Nothing between them is more than `depth` behind the line, each dip
 *    behind it is at most `width` wide along the line, and between two dips the
 *    outline comes back to within `touch` of the line. A broad hollow or a long
 *    shoulder is part of the tool's shape, not a ripple, and is left alone; and
 *    a line never passes over a crest, so ribs on a curve become short lines
 *    that follow the curve, not long flats across it.
 * 3. Both ends are convex corners of the ring and the line leaves each inside
 *    that corner's own turn. A smooth concave curve has no such corner, so it
 *    is never cut into flats; a dip is bridged from rim to rim or not at all.
 * 4. The line meets no other part of the outline, and no other ring sits in
 *    the space it closes.
 *
 * Every point kept is a point that was there, in the same order. Rings never
 * cross as a result, because each bridge is tested against the original edges
 * and the bridges already taken.
 *
 * The convention throughout: travelling along any ring, outer or hole, the
 * material is on the left. That follows from the orientation rule in
 * `./types`; a ring wound the other way is walked backwards. A dip in a hole's
 * edge is therefore bridged too, which makes the hole smaller and again never
 * removes material.
 */

/** Depth of dip the default cleanup ignores: half a millimeter, or five pixels when the photo has no scale. */
export const AUTO_STRAIGHTENING_DEPTH = { mm: .5, px: 5 } as const;

/** A dip is ignored only while it is narrow: at most this many times the depth, measured along the bridging line. */
export const STRAIGHTENING_WIDTH_PER_DEPTH = 20;

/** Within this share of the depth the outline counts as back at the line, which ends one dip and starts the next. */
export const STRAIGHTENING_TOUCH_SHARE = .2;

export interface StraighteningOptions {
  /** Greatest width of one dip along the bridging line. Defaults to {@link STRAIGHTENING_WIDTH_PER_DEPTH} depths. */
  width?: number;
  /** How close to the line counts as touching it. Defaults to {@link STRAIGHTENING_TOUCH_SHARE} of the depth. */
  touch?: number;
}

export interface StraighteningResult {
  /** The input object itself when nothing was bridged. */
  outline: Outline;
  /** Bridges taken. */
  bridges: number;
  /** Points dropped from the outline. */
  removed: number;
  /** The deepest dip bridged, in the outline's units. */
  maxDepth: number;
  /** Why nothing was attempted, when the outline was returned untouched for a reason other than having no dips. */
  reason?: string;
}

/**
 * Steps allowed before the outline is handed back unchanged. A traced tool
 * takes a few thousand; the ceiling bounds the time on an outline built to be
 * awkward.
 */
const MAX_WORK = 4_000_000;
const TOO_COMPLEX = Symbol("too complex");

/** A turn smaller than this, in radians, is treated as straight. */
const STRAIGHT = 1e-9;
/** Slack on the direction test that only shortlists a bridge; the exact test follows. */
const SHORTLIST_SLACK = 1e-7;

interface Segment { a: Point; b: Point; minX: number; minY: number; maxX: number; maxY: number }

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const segment = (a: Point, b: Point): Segment => ({ a, b, minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });

/** Whether two segments cross or come within `eps` of touching. */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point, eps: number): boolean {
  const abc = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y), abd = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  const cda = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y), cdb = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  if (abc * abd < 0 && cda * cdb < 0) return true;
  return distanceToSegment(a, c, d) < eps || distanceToSegment(b, c, d) < eps || distanceToSegment(c, a, b) < eps || distanceToSegment(d, a, b) < eps;
}

/**
 * Replaces dips no deeper than `depth` (and no wider than `options.width`)
 * with the straight line over them. Lengths are in the outline's own units.
 *
 * The result contains the input: `preservesMaterial(input, result, tiny)` and
 * `boundsMaterialGrowth(input, result, depth)` both hold. An outline it cannot
 * work with (not finite, or too intricate for the step budget) comes back
 * unchanged, as the same object.
 */
export function straightenOutward(outline: Outline, depth: number, options: StraighteningOptions = {}): StraighteningResult {
  const untouched = (reason?: string): StraighteningResult => ({ outline, bridges: 0, removed: 0, maxDepth: 0, ...(reason ? { reason } : {}) });
  if (!(depth > 0) || !Number.isFinite(depth)) return untouched();
  const width = options.width ?? depth * STRAIGHTENING_WIDTH_PER_DEPTH, touch = options.touch ?? depth * STRAIGHTENING_TOUCH_SHARE;
  if (!(width > 0) || !(touch >= 0) || !(touch < depth)) return untouched();

  const rings = outline.flatMap((shape, shapeIndex) => [
    { ring: shape.outer, shapeIndex, holeIndex: -1 }, ...shape.holes.map((ring, holeIndex) => ({ ring, shapeIndex, holeIndex }))]);
  let extent = 1;
  for (const { ring } of rings) for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return untouched("The outline has a point that is not a number.");
    extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  }
  /** Rounding allowance on a distance: about a billionth of the outline's size. */
  const eps = extent * 1e-9;
  /** Neighbors closer than this say nothing reliable about which way the outline turns. */
  const distinct = Math.max(eps * 10, depth / 100);

  const original = rings.map(({ ring }) => ring.map((a, i) => segment(a, ring[(i + 1) % ring.length])));
  const bounds = rings.map(({ ring }) => ring.reduce((box, p) => ({ minX: Math.min(box.minX, p.x), minY: Math.min(box.minY, p.y), maxX: Math.max(box.maxX, p.x), maxY: Math.max(box.maxY, p.y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }));
  const taken: Segment[] = [];
  let work = 0, bridges = 0, removed = 0, maxDepth = 0;
  const spend = (steps: number) => { work += steps; if (work > MAX_WORK) throw TOO_COMPLEX; };

  const straighten = (ringIndex: number): Ring => {
    const ring = rings[ringIndex].ring, n = ring.length;
    if (n < 4) return ring;
    const area = signedArea(ring);
    if (!(Math.abs(area) > eps * eps)) return ring;
    // Walk the ring so that material is on the left: an outer ring forwards when its area is positive, a hole when negative.
    const forwards = (rings[ringIndex].holeIndex < 0) === (area > 0);
    const at = (q: number) => ring[forwards ? q : n - 1 - q];

    /** The nearest vertex in `direction` far enough from vertex `q` to give a direction, or -1. */
    const neighbor = (q: number, direction: 1 | -1): number => {
      const p = at(q);
      for (let step = 1; step < n; step++) {
        const other = (q + direction * step + n * step) % n, o = at(other);
        if (Math.hypot(o.x - p.x, o.y - p.y) > distinct) return other;
      }
      return -1;
    };
    const before = new Int32Array(n), after = new Int32Array(n), convex = new Uint8Array(n);
    for (let q = 0; q < n; q++) {
      before[q] = neighbor(q, -1); after[q] = neighbor(q, 1);
      if (before[q] < 0 || after[q] < 0) return ring;
      const p = at(q), b = at(before[q]), a = at(after[q]);
      const inX = p.x - b.x, inY = p.y - b.y, outX = a.x - p.x, outY = a.y - p.y;
      convex[q] = cross(inX, inY, outX, outY) > STRAIGHT * Math.hypot(inX, inY) * Math.hypot(outX, outY) ? 1 : 0;
    }
    spend(n);

    // Start at a convex corner. For an outer ring the lowest of the leftmost points is one that no bridge can pass over.
    let anchor = -1;
    for (let q = 0; q < n; q++) if (convex[q]) {
      const p = at(q), best = anchor < 0 ? null : at(anchor);
      if (!best || p.x < best.x || (p.x === best.x && p.y < best.y)) anchor = q;
    }
    if (anchor < 0) return ring;
    const index = (t: number) => (anchor + t) % n, point = (t: number) => at(index(t));

    /** Whether a bridge with direction (vx, vy) lies inside the convex turn at vertex `q`. */
    const withinTurn = (q: number, vx: number, vy: number): boolean => {
      const p = at(q), b = at(before[q]), a = at(after[q]), size = Math.hypot(vx, vy);
      const inX = p.x - b.x, inY = p.y - b.y, outX = a.x - p.x, outY = a.y - p.y;
      return cross(inX, inY, vx, vy) >= -STRAIGHT * Math.hypot(inX, inY) * size && cross(vx, vy, outX, outY) >= -STRAIGHT * Math.hypot(outX, outY) * size;
    };

    const own = Array.from({ length: n }, (_, q) => segment(at(q), at((q + 1) % n)));

    /** The exact test of a bridge from walk position i to k. Returns its depth, or -1 when it is not one. */
    const bridgeDepth = (i: number, k: number): number => {
      const a = point(i), b = point(k), vx = b.x - a.x, vy = b.y - a.y, length = Math.hypot(vx, vy);
      if (!(length > distinct)) return -1;
      spend(k - i);
      let deepest = 0, inDip = false, dipFrom = 0, dipTo = 0, lastS = 0, lastT = 0, peak = 0, valley = 0;
      for (let m = i + 1; m <= k; m++) {
        const p = point(m), end = m === k;
        // s: how far behind the line (material side); t: how far along it.
        const s = end ? 0 : cross(vx, vy, p.x - a.x, p.y - a.y) / length, t = end ? length : (vx * (p.x - a.x) + vy * (p.y - a.y)) / length;
        if (!(s >= -eps && s <= depth + eps && t >= -eps && t <= length + eps)) return -1;
        if (s > deepest) deepest = s;
        // A crest left behind the line: the outline came back towards the line by more than the touching
        // distance without reaching it, then went away again. Passing over one would flatten a curve of ribs.
        if (s <= touch) { peak = s; valley = s; }
        else {
          if (valley > touch && peak - valley > touch && s - valley > touch) return -1;
          if (s >= peak) { peak = s; valley = s; } else if (s < valley) valley = s;
        }
        // Where the outline passes the touching distance between the last point and this one.
        const passing = (level: number) => lastT + (t - lastT) * (level - lastS) / (s - lastS);
        if (s > touch) {
          if (!inDip) { inDip = true; dipFrom = dipTo = lastS < touch ? passing(touch) : lastT; }
          dipFrom = Math.min(dipFrom, t); dipTo = Math.max(dipTo, t);
        } else if (inDip) {
          const leaves = passing(touch);
          dipFrom = Math.min(dipFrom, leaves); dipTo = Math.max(dipTo, leaves);
          inDip = false;
        }
        if (dipTo - dipFrom > width + eps) return -1;
        lastS = s; lastT = t;
      }

      // Nothing else may meet the line. The edges it replaces and the two that share its ends are its own.
      const line = segment(a, b), first = index(i), last = index(k), span = k - i;
      const apart = (other: Segment) => other.maxX < line.minX - eps || other.minX > line.maxX + eps || other.maxY < line.minY - eps || other.minY > line.maxY + eps;
      const previous = (first + n - 1) % n;
      // A neighboring edge that folds back along the line would overlap it.
      if (distanceToSegment(at(previous), a, b) < eps || distanceToSegment(at((last + 1) % n), a, b) < eps) return -1;
      spend((n + taken.length) >> 2);
      for (let q = 0; q < n; q++) {
        const along = (q - first + n) % n;
        if (along < span || q === previous || q === last) continue;
        const edge = own[q];
        if (!apart(edge) && segmentsMeet(a, b, edge.a, edge.b, eps)) return -1;
      }
      for (const edge of taken) {
        if (apart(edge)) continue;
        // The bridge before this one ends where this one starts: only their far ends can interfere.
        const sharedA = edge.a === a || edge.a === b, sharedB = edge.b === a || edge.b === b;
        if (sharedA || sharedB) {
          const theirs = sharedA ? edge.b : edge.a, ours = edge.a === a || edge.b === a ? b : a;
          if (distanceToSegment(theirs, a, b) < eps || distanceToSegment(ours, edge.a, edge.b) < eps) return -1;
        } else if (segmentsMeet(a, b, edge.a, edge.b, eps)) return -1;
      }
      let cap: Ring | null = null;
      let capBox = { minX: line.minX, minY: line.minY, maxX: line.maxX, maxY: line.maxY };
      for (let r = 0; r < rings.length; r++) {
        if (r === ringIndex) continue;
        if (!cap) {
          cap = [];
          for (let m = i; m <= k; m++) {
            const p = point(m); cap.push(p);
            capBox = { minX: Math.min(capBox.minX, p.x), minY: Math.min(capBox.minY, p.y), maxX: Math.max(capBox.maxX, p.x), maxY: Math.max(capBox.maxY, p.y) };
          }
        }
        const box = bounds[r];
        if (box.maxX < capBox.minX - eps || box.minX > capBox.maxX + eps || box.maxY < capBox.minY - eps || box.minY > capBox.maxY + eps) continue;
        spend(original[r].length >> 2);
        for (const edge of original[r]) if (!apart(edge) && segmentsMeet(a, b, edge.a, edge.b, eps)) return -1;
        // A ring that does not meet the line is wholly on one side of it: inside the closed space, or not.
        spend(cap.length);
        if (pointInRing(cap, rings[r].ring[0])) return -1;
      }
      return deepest;
    };

    /** The farthest walk position that a bridge from position i reaches, with its depth, or null. */
    const farthest = (i: number): { k: number; depth: number } | null => {
      const a = point(i), shortlist: number[] = [];
      // Directions are measured as the angle turned since the first point after i, counterclockwise positive.
      let started = false, angle = 0, lowest = Infinity, floor = -Infinity, lastX = 0, lastY = 0;
      for (let k = i + 1; k <= n; k++) {
        spend(1);
        const p = point(k), vx = p.x - a.x, vy = p.y - a.y, distance = Math.hypot(vx, vy);
        // Points on top of the start give no direction; the outline coming back to the start ends the search.
        if (!(distance > distinct)) { if (!started) continue; break; }
        if (started) angle += Math.atan2(cross(lastX, lastY, vx, vy), lastX * vx + lastY * vy);
        started = true; lastX = vx; lastY = vy;
        // A bridge to k must not pass outside any point before it (no more counterclockwise than `lowest`),
        // nor leave any of them more than the depth behind (no more clockwise than `floor`).
        if (k >= i + 2 && angle <= lowest + SHORTLIST_SLACK && angle >= floor - SHORTLIST_SLACK
          && convex[index(k)] && withinTurn(index(i), vx, vy) && withinTurn(index(k), vx, vy)) shortlist.push(k);
        lowest = Math.min(lowest, angle);
        floor = Math.max(floor, angle - Math.asin(Math.min(1, depth / distance)));
        if (floor > lowest + SHORTLIST_SLACK) break;
      }
      spend(shortlist.length + 1);
      for (let c = shortlist.length - 1; c >= 0; c--) {
        const reached = bridgeDepth(i, shortlist[c]);
        if (reached >= 0) return { k: shortlist[c], depth: reached };
      }
      return null;
    };

    const keep = new Uint8Array(n).fill(1);
    const mine: Segment[] = [];
    let ringBridges = 0, ringRemoved = 0, ringDepth = 0;
    for (let i = 0; i < n;) {
      spend(1);
      const found = convex[index(i)] ? farthest(i) : null;
      if (!found) { i++; continue; }
      for (let m = i + 1; m < found.k; m++) keep[index(m)] = 0;
      const line = segment(point(i), point(found.k));
      taken.push(line); mine.push(line);
      ringBridges++; ringRemoved += found.k - i - 1; ringDepth = Math.max(ringDepth, found.depth);
      i = found.k;
    }
    if (!ringBridges) return ring;
    const result = ring.filter((_, original) => keep[forwards ? original : n - 1 - original]);
    // A ring that would lose its shape is left as it was, and its bridges no longer stand in the way of others.
    if (result.length < 3 || Math.sign(signedArea(result)) !== Math.sign(area)) {
      for (const line of mine) taken.splice(taken.indexOf(line), 1);
      return ring;
    }
    bridges += ringBridges; removed += ringRemoved; maxDepth = Math.max(maxDepth, ringDepth);
    return result;
  };

  let results: Ring[];
  try {
    results = rings.map((_, ringIndex) => straighten(ringIndex));
  } catch (error) {
    if (error === TOO_COMPLEX) return untouched("The outline is too intricate to straighten.");
    throw error;
  }
  if (!bridges) return untouched();
  let next = 0;
  const straightened = outline.map((shape) => {
    const outer = results[next++], holes = shape.holes.map(() => results[next++]);
    return outer === shape.outer && holes.every((hole, i) => hole === shape.holes[i]) ? shape : { ...shape, outer, holes };
  });
  return { outline: straightened, bridges, removed, maxDepth };
}
