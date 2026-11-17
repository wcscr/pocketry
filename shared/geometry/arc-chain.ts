import type { Point, Ring } from "./types";

/**
 * Closed boundaries made of straight lines and circular arcs.
 *
 * A polygon ring describes a traced outline as hundreds of short segments. CAD
 * operations want the same boundary as a few lines and arcs: their offsets are
 * again lines and arcs, and the surfaces swept from them are planes, cylinders
 * and tori. This module holds that representation and its measurements. It is
 * dependency-free, like the rest of `shared/geometry`.
 *
 * A chain is a derived, export-time value. It is never stored in a project.
 */

/** A straight element from `a` to `b`. */
export interface LineElement {
  kind: "line";
  a: Point;
  b: Point;
}

/**
 * A circular element from `a` to `b` around `center`.
 *
 * `sweep` is the signed angle travelled in radians, positive when the element
 * turns toward `leftNormal` of its direction of travel. Its magnitude is at
 * most 2π; a full circle has `a` equal to `b`.
 */
export interface ArcElement {
  kind: "arc";
  a: Point;
  b: Point;
  center: Point;
  radius: number;
  sweep: number;
}

export type ChainElement = LineElement | ArcElement;

/**
 * A closed ring of elements; each starts where the previous one ends and the
 * last ends where the first starts.
 *
 * Orientation follows the ring convention in `./types`: an outer boundary has
 * positive signed area and a hole negative. In both cases the enclosed
 * material lies on the `leftNormal` side of every element.
 */
export type ArcChain = ChainElement[];

/** Sagitta below which an arc is indistinguishable from its chord (0.1 µm). */
const LINE_SAGITTA_MM = 1e-7;

const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });
const scale = (p: Point, s: number): Point => ({ x: p.x * s, y: p.y * s });
const dot = (p: Point, q: Point): number => p.x * q.x + p.y * q.y;
const cross = (p: Point, q: Point): number => p.x * q.y - p.y * q.x;
const norm = (p: Point): number => Math.hypot(p.x, p.y);

function unit(p: Point): Point {
  const length = norm(p);
  if (!(length > 0)) throw new Error("arc-chain: zero-length direction");
  return { x: p.x / length, y: p.y / length };
}

/** The direction 90° to the left of `direction` (toward the enclosed side). */
export function leftNormal(direction: Point): Point {
  return { x: -direction.y, y: direction.x };
}

/** Rotates `p` about the origin by `angle` radians. */
function rotate(p: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Length along the element. */
export function elementLength(element: ChainElement): number {
  return element.kind === "line"
    ? norm(sub(element.b, element.a))
    : element.radius * Math.abs(element.sweep);
}

/** Unit direction of travel where the element starts. */
export function startTangent(element: ChainElement): Point {
  if (element.kind === "line") return unit(sub(element.b, element.a));
  const radial = sub(element.a, element.center);
  return unit(scale(leftNormal(radial), Math.sign(element.sweep)));
}

/** Unit direction of travel where the element ends. */
export function endTangent(element: ChainElement): Point {
  if (element.kind === "line") return unit(sub(element.b, element.a));
  const radial = sub(element.b, element.center);
  return unit(scale(leftNormal(radial), Math.sign(element.sweep)));
}

/** The point a fraction `t` (0 at `a`, 1 at `b`) along the element. */
export function pointAlong(element: ChainElement, t: number): Point {
  if (element.kind === "line") {
    return add(element.a, scale(sub(element.b, element.a), t));
  }
  return add(
    element.center,
    rotate(sub(element.a, element.center), element.sweep * t),
  );
}

/** The same element travelled from `b` to `a`. */
export function reverseElement(element: ChainElement): ChainElement {
  return element.kind === "line"
    ? { kind: "line", a: element.b, b: element.a }
    : { ...element, a: element.b, b: element.a, sweep: -element.sweep };
}

/** The same boundary travelled the other way, which flips its orientation. */
export function reverseChain(chain: ArcChain): ArcChain {
  return chain.map(reverseElement).reverse();
}

/**
 * The element that leaves `a` along unit `tangent` and ends at `b`: the unique
 * circular arc with that start direction, or a line when the arc would be
 * flatter than {@link LINE_SAGITTA_MM}.
 */
export function arcThrough(a: Point, tangent: Point, b: Point): ChainElement {
  const chord = sub(b, a);
  const length = norm(chord);
  const offset = dot(chord, leftNormal(tangent));
  const signedRadius = (length * length) / (2 * offset);
  const sagitta = (length * length) / (8 * Math.abs(signedRadius));
  if (!Number.isFinite(signedRadius) || sagitta < LINE_SAGITTA_MM) {
    return { kind: "line", a, b };
  }
  return {
    kind: "arc",
    a,
    b,
    center: add(a, scale(leftNormal(tangent), signedRadius)),
    radius: Math.abs(signedRadius),
    // The chord makes half the swept angle with the start tangent.
    sweep: 2 * Math.atan2(cross(tangent, chord), dot(tangent, chord)),
  };
}

/**
 * The two-arc curve from `p0` (leaving along unit `t0`) to `p1` (arriving
 * along unit `t1`) whose arcs meet tangentially and have equal control
 * lengths. Returns `null` when no such curve with a positive control length
 * exists, for example when the tangents point away from the chord.
 */
export function biarc(
  p0: Point,
  t0: Point,
  p1: Point,
  t1: Point,
): [ChainElement, ChainElement] | null {
  const chord = sub(p1, p0);
  const tangentSum = add(t0, t1);
  const chordSquared = dot(chord, chord);
  const along = dot(chord, tangentSum);
  const denominator = 2 * (1 - dot(t0, t1));
  let control: number;
  if (Math.abs(denominator) < 1e-12) {
    // Parallel tangents: the quadratic for the control length is linear.
    const projected = dot(chord, t1);
    if (Math.abs(projected) < 1e-12) return null;
    control = chordSquared / (4 * projected);
  } else {
    control =
      (-along + Math.sqrt(along * along + denominator * chordSquared)) /
      denominator;
  }
  if (!(control > 0) || !Number.isFinite(control)) return null;
  const q0 = add(p0, scale(t0, control));
  const q1 = sub(p1, scale(t1, control));
  const between = sub(q1, q0);
  if (!(norm(between) > 1e-12)) return null;
  const join = scale(add(q0, q1), 0.5);
  return [arcThrough(p0, t0, join), arcThrough(join, unit(between), p1)];
}

/** Shortest distance from `p` to the element. */
export function distanceToElement(p: Point, element: ChainElement): number {
  if (element.kind === "line") {
    const direction = sub(element.b, element.a);
    const lengthSquared = dot(direction, direction);
    const t = lengthSquared
      ? Math.max(0, Math.min(1, dot(sub(p, element.a), direction) / lengthSquared))
      : 0;
    return norm(sub(p, add(element.a, scale(direction, t))));
  }
  const from = sub(element.a, element.center);
  const to = sub(p, element.center);
  // Angle of `p` measured from the arc's start, in the arc's own direction.
  let angle = Math.atan2(cross(from, to), dot(from, to));
  if (element.sweep > 0 && angle < 0) angle += 2 * Math.PI;
  if (element.sweep < 0 && angle > 0) angle -= 2 * Math.PI;
  const within =
    element.sweep > 0 ? angle <= element.sweep : angle >= element.sweep;
  return within
    ? Math.abs(norm(to) - element.radius)
    : Math.min(norm(sub(p, element.a)), norm(sub(p, element.b)));
}

/** Shortest distance from `p` to any element of the chain. */
export function distanceToChain(p: Point, chain: ArcChain): number {
  let best = Infinity;
  for (const element of chain) {
    best = Math.min(best, distanceToElement(p, element));
  }
  return best;
}

/**
 * Signed tangent turn where each element meets the next, in radians. Zero is
 * a smooth join; a positive turn bends toward the enclosed side (a convex
 * corner of the enclosed region) and a negative one away from it (an inside
 * corner).
 */
export function junctionTurns(chain: ArcChain): number[] {
  return chain.map((element, index) => {
    const leaving = endTangent(element);
    const entering = startTangent(chain[(index + 1) % chain.length]);
    return Math.atan2(cross(leaving, entering), dot(leaving, entering));
  });
}

/** Largest gap between one element's end and the next one's start. */
export function chainClosureGap(chain: ArcChain): number {
  let worst = 0;
  chain.forEach((element, index) => {
    const next = chain[(index + 1) % chain.length];
    worst = Math.max(worst, norm(sub(next.a, element.b)));
  });
  return worst;
}

/**
 * Exact signed area enclosed by the chain: the polygon through the element
 * ends plus the circular segment each arc adds or removes.
 */
export function chainSignedArea(chain: ArcChain): number {
  let doubled = 0;
  for (const element of chain) {
    doubled += cross(element.a, element.b);
    if (element.kind === "arc") {
      const segment = element.sweep - Math.sin(element.sweep);
      doubled += element.radius * element.radius * segment;
    }
  }
  return doubled / 2;
}

/**
 * Samples the chain as a polygon ring whose chords stay within
 * `chordToleranceMm` of every arc. Element end points are always kept.
 */
export function flattenChain(chain: ArcChain, chordToleranceMm: number): Ring {
  if (!(chordToleranceMm > 0)) {
    throw new Error("arc-chain: chord tolerance must be positive");
  }
  const ring: Ring = [];
  for (const element of chain) {
    ring.push(element.a);
    if (element.kind !== "arc") continue;
    // A chord spanning angle θ sags by r(1 - cos(θ/2)).
    const ratio = Math.min(1, chordToleranceMm / element.radius);
    const maxStep = 2 * Math.acos(1 - ratio);
    const steps = Math.max(1, Math.ceil(Math.abs(element.sweep) / maxStep));
    for (let step = 1; step < steps; step++) {
      ring.push(pointAlong(element, step / steps));
    }
  }
  return ring;
}

/**
 * Joins neighbors that lie on one line or one circle back into a single
 * element. `epsilonMm` bounds how far apart two centers or radii may be and
 * still count as the same circle. Joined arcs stay under a half turn so each
 * remains unambiguous from its ends and start direction.
 */
export function mergeChain(chain: ArcChain, epsilonMm = 1e-5): ArcChain {
  const merged: ArcChain = [];
  for (const element of chain) {
    const last = merged[merged.length - 1];
    if (last && last.kind === "line" && element.kind === "line") {
      const before = startTangent(last);
      const after = startTangent(element);
      if (Math.abs(cross(before, after)) < 1e-9 && dot(before, after) > 0) {
        merged[merged.length - 1] = { kind: "line", a: last.a, b: element.b };
        continue;
      }
    }
    if (
      last &&
      last.kind === "arc" &&
      element.kind === "arc" &&
      Math.sign(last.sweep) === Math.sign(element.sweep) &&
      Math.abs(last.radius - element.radius) < epsilonMm &&
      norm(sub(last.center, element.center)) < epsilonMm &&
      Math.abs(last.sweep + element.sweep) < 0.9 * Math.PI
    ) {
      const joined = arcThrough(last.a, startTangent(last), element.b);
      if (joined.kind === "arc") {
        merged[merged.length - 1] = joined;
        continue;
      }
    }
    merged.push(element);
  }
  return merged;
}

/** How {@link fitArcChain} turns a polygon ring into lines and arcs. */
export interface ChainFitOptions {
  /** Largest distance allowed between the ring and the fitted chain, measured both ways. */
  toleranceMm: number;
  /**
   * A vertex that turns by more than this (radians) is kept as a sharp corner
   * outright. Gentler vertices are smoothed through when the tolerance allows
   * and otherwise keep their own segments. Default 30°.
   */
  cornerTurn?: number;
  /**
   * Vertices closer than this to the line through their kept neighbors are
   * not fitted through, which keeps trace noise from producing sliver
   * elements. The result is still checked against every vertex. Default 40%
   * of the tolerance.
   */
  simplifyMm?: number;
  /** Segments at least this long are kept as exact lines. Default 0.5 mm. */
  longSegmentMm?: number;
  /** Points closer together than this are treated as one. Default 0.005 mm. */
  clusterMm?: number;
}

export interface ChainFit {
  chain: ArcChain;
  /** Measured distance between ring and chain, the larger of the two directions. */
  maxDeviationMm: number;
  /** Length of the shortest element, for callers that reject sliver-prone fits. */
  shortestElementMm: number;
}

/** Tangent at `p` of the circle through `prev`, `p` and `next`, pointing from `prev` toward `next`. */
function threePointTangent(prev: Point, p: Point, next: Point): Point {
  const a = sub(p, prev);
  const b = sub(next, p);
  return unit(add(scale(a, 1 / dot(a, a)), scale(b, 1 / dot(b, b))));
}

/** Tangent at `p` of the circle through `p`, `q` and `r`, pointing toward `q`. */
function endPointTangent(p: Point, q: Point, r: Point): Point {
  // Inverting about `p` maps the circle to the line through the images of q and r.
  const a = sub(q, p);
  const b = sub(r, p);
  const direction = sub(scale(b, 1 / dot(b, b)), scale(a, 1 / dot(a, a)));
  if (norm(direction) < 1e-12) return unit(a);
  const tangent = unit(direction);
  return dot(tangent, a) >= 0 ? tangent : scale(tangent, -1);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distanceToElement(p, { kind: "line", a, b });
}

/**
 * Chooses which vertices of a closed ring to fit through: Douglas-Peucker
 * within `epsilon`, always keeping both ends of every segment at least
 * `longSegmentMm` long so exact lines and the arcs tangent to them survive
 * untouched. Returns the kept indices in order. Samples of a circle stay on
 * that circle, so thinning does not disturb its recovery.
 */
function simplifyBetweenLines(points: readonly Point[], longSegmentMm: number, epsilon: number): number[] {
  const count = points.length;
  if (!(epsilon > 0) || count < 4) return points.map((_, index) => index);
  const length = (index: number) => norm(sub(points[(index + 1) % count], points[index]));
  const anchored = points.map((_, index) => length(index) >= longSegmentMm || length((index + count - 1) % count) >= longSegmentMm);
  if (!anchored.includes(true)) {
    // No straight run to hold on to: anchor the two vertices farthest apart.
    let far = 1;
    for (let index = 2; index < count; index++) {
      if (norm(sub(points[index], points[0])) > norm(sub(points[far], points[0]))) far = index;
    }
    anchored[0] = anchored[far] = true;
  }
  const keep = anchored.slice();
  const anchors = anchored.flatMap((held, index) => (held ? [index] : []));
  anchors.forEach((start, position) => {
    const end = anchors[(position + 1) % anchors.length];
    const span = ((end - start + count) % count) || count;
    // Indices run start, start + 1, ... start + span, wrapping around the ring.
    const stack: [number, number][] = [[0, span]];
    while (stack.length) {
      const [from, to] = stack.pop()!;
      if (to - from < 2) continue;
      const a = points[(start + from) % count];
      const b = points[(start + to) % count];
      let worst = 0;
      let split = -1;
      for (let offset = from + 1; offset < to; offset++) {
        const distance = distanceToSegment(points[(start + offset) % count], a, b);
        if (distance > worst) {
          worst = distance;
          split = offset;
        }
      }
      if (worst > epsilon) {
        keep[(start + split) % count] = true;
        stack.push([from, split], [split, to]);
      }
    }
  });
  return keep.flatMap((kept, index) => (kept ? [index] : []));
}

/**
 * Fits a closed polygon ring with lines and circular arcs.
 *
 * The ring is expected to be a boundary whose curved parts are finely sampled
 * arcs (as an offset with round joins produces) and whose corners are real.
 * Vertices that turn sharply stay as corners; segments of at least
 * `longSegmentMm` stay as exact lines; everything between is first thinned of
 * noise and then covered by the longest tangent-continuous arc pairs that keep
 * within tolerance. Arcs that came from one circle are recovered as that
 * circle.
 *
 * The tolerance is enforced in both directions against the ring's segments,
 * not only at its vertices, and a bound on the result is returned.
 * Orientation is preserved.
 */
export function fitArcChain(ring: Ring, options: ChainFitOptions): ChainFit {
  const tolerance = options.toleranceMm;
  if (!(tolerance > 0)) throw new Error("arc-chain: fit tolerance must be positive");
  const cornerTurn = options.cornerTurn ?? (30 * Math.PI) / 180;
  const longSegmentMm = options.longSegmentMm ?? 0.5;
  const clusterMm = options.clusterMm ?? 0.005;
  const simplifyMm = Math.min(options.simplifyMm ?? 0.4 * tolerance, 0.9 * tolerance);

  // Collapse point clusters (an offset leaves a fan of them at an inside corner).
  const dense: Point[] = [];
  for (const p of ring) {
    if (!dense.length || norm(sub(p, dense[dense.length - 1])) >= clusterMm) dense.push(p);
  }
  while (dense.length > 3 && norm(sub(dense[0], dense[dense.length - 1])) < clusterMm) dense.pop();
  if (dense.length < 3) throw new Error("arc-chain: ring has fewer than three distinct points");

  // Fit through a thinned set of vertices, but measure against all of them.
  const denseIndex = simplifyBetweenLines(dense, longSegmentMm, simplifyMm);
  const points = denseIndex.map((index) => dense[index]);
  const count = points.length;
  if (count < 3) throw new Error("arc-chain: ring has fewer than three distinct points");

  const at = (index: number): Point => points[((index % count) + count) % count];
  const segment = (index: number): Point => sub(at(index + 1), at(index));
  // An exact line is one long segment of the ring itself, not a chord that
  // thinning drew across several of them.
  const isLong = (index: number): boolean => {
    const here = denseIndex[((index % count) + count) % count];
    const next = denseIndex[(((index + 1) % count) + count) % count];
    return (next - here + dense.length) % dense.length === 1 && norm(segment(index)) >= longSegmentMm;
  };
  const turnAt = (index: number): number => {
    const before = segment(index - 1);
    const after = segment(index);
    return Math.atan2(cross(before, after), dot(before, after));
  };

  // A corner is a sharp turn, or any real turn between two exact lines.
  const corner = points.map((_, index) => {
    const turn = Math.abs(turnAt(index));
    return turn > cornerTurn || (isLong(index - 1) && isLong(index) && turn > 1e-9);
  });
  // Spans stop at corners and at both ends of every exact line.
  const stop = points.map((_, index) => corner[index] || isLong(index - 1) || isLong(index));

  // Tangents are estimated from the ring a short way to either side rather
  // than from the adjacent vertices, so trace noise averages out. Samples of a
  // true circle still give that circle's tangent exactly.
  const window = Math.max(0.25, 20 * tolerance);
  const total = dense.length;
  const densePoint = (index: number): Point => dense[((index % total) + total) % total];
  const fitted = (index: number): number => ((index % count) + count) % count;
  /**
   * The ring vertex about `distance` along the full ring from fitted vertex
   * `index`, not passing fitted vertex `limit`. Always a vertex, never a point
   * interpolated along a chord: three samples of one circle then return that
   * circle's tangent exactly, which is what lets its arcs merge back into one.
   */
  const walk = (index: number, direction: 1 | -1, distance: number, limit: number): Point => {
    let position = denseIndex[fitted(index)];
    const end = denseIndex[fitted(limit)];
    let here = densePoint(position);
    let travelled = 0;
    for (let guard = 0; guard < total; guard++) {
      const next = densePoint(position + direction);
      travelled += norm(sub(next, here));
      here = next;
      position += direction;
      if (travelled >= distance || ((position % total) + total) % total === end) break;
    }
    return here;
  };
  /** Nearest stop at or beyond fitted vertex `index` in `direction`, or the vertex opposite when the ring has none. */
  const nextStop = (index: number, direction: 1 | -1): number => {
    for (let offset = 1; offset < count; offset++) {
      if (stop[fitted(index + direction * offset)]) return index + direction * offset;
    }
    return index + direction * Math.floor(count / 2);
  };
  const smoothTangent = (index: number): Point => {
    const before = walk(index, -1, window, nextStop(index, -1));
    const after = walk(index, 1, window, nextStop(index, 1));
    return threePointTangent(before, at(index), after);
  };

  /** Direction of travel leaving vertex `index` toward `index + 1`. */
  const leaving = (index: number): Point => {
    if (isLong(index)) return unit(segment(index));
    if (!corner[fitted(index)]) {
      return isLong(index - 1) ? unit(segment(index - 1)) : smoothTangent(index);
    }
    if (corner[fitted(index + 1)] || isLong(index + 1)) return unit(segment(index));
    const limit = nextStop(index, 1);
    const near = walk(index, 1, window / 2, limit);
    const far = walk(index, 1, window, limit);
    return near === far ? unit(sub(near, at(index))) : endPointTangent(at(index), near, far);
  };
  /** Direction of travel arriving at vertex `index` from `index - 1`. */
  const arriving = (index: number): Point => {
    if (isLong(index - 1)) return unit(segment(index - 1));
    if (!corner[fitted(index)]) {
      return isLong(index) ? unit(segment(index)) : smoothTangent(index);
    }
    if (corner[fitted(index - 1)] || isLong(index - 2)) return unit(segment(index - 1));
    const limit = nextStop(index, -1);
    const near = walk(index, -1, window / 2, limit);
    const far = walk(index, -1, window, limit);
    return near === far ? unit(sub(at(index), near)) : scale(endPointTangent(at(index), near, far), -1);
  };

  /**
   * Largest two-way distance between `elements` and the stretch of the full
   * ring from fitted vertex `from` to fitted vertex `to`, or Infinity as soon
   * as it passes the tolerance.
   */
  const deviation = (from: number, to: number, elements: readonly ChainElement[]): number => {
    const first = denseIndex[fitted(from)];
    let last = denseIndex[fitted(to)];
    if (last <= first) last += total;
    const point = (index: number): Point => dense[index % total];
    let worst = 0;
    for (let index = first; index < last; index++) {
      const p = point(index);
      const q = point(index + 1);
      const samples = index === first ? [scale(add(p, q), 0.5)] : [p, scale(add(p, q), 0.5)];
      for (const sample of samples) {
        let nearest = Infinity;
        for (const element of elements) nearest = Math.min(nearest, distanceToElement(sample, element));
        worst = Math.max(worst, nearest);
        if (worst > tolerance) return Infinity;
      }
    }
    for (const element of elements) {
      const steps = Math.max(4, Math.min(64, Math.ceil(elementLength(element) / 0.05)));
      for (let step = 1; step < steps; step++) {
        const sample = pointAlong(element, step / steps);
        let nearest = Infinity;
        for (let index = first; index < last && nearest > 1e-12; index++) {
          nearest = Math.min(nearest, distanceToSegment(sample, point(index), point(index + 1)));
        }
        worst = Math.max(worst, nearest);
        if (worst > tolerance) return Infinity;
      }
    }
    return worst;
  };

  const span = (from: number, to: number): { elements: ChainElement[]; worst: number } | null => {
    if (to === from + 1 && (isLong(from) || (corner[from % count] && corner[to % count]))) {
      const line: ChainElement = { kind: "line", a: at(from), b: at(to) };
      return { elements: [line], worst: deviation(from, to, [line]) };
    }
    const pair = biarc(at(from), leaving(from), at(to), arriving(to));
    if (!pair) return null;
    if (pair.some((element) => element.kind === "arc" && Math.abs(element.sweep) > 0.75 * Math.PI)) return null;
    const elements = pair.filter((element) => elementLength(element) > 1e-9);
    const worst = deviation(from, to, elements);
    return Number.isFinite(worst) ? { elements, worst } : null;
  };

  /**
   * A rounded corner between two exact lines, as one arc tangent to both.
   *
   * This is the common case (a round join between two straight edges) and the
   * one where a pair of arcs does harm: the pair's two centers land microns
   * apart, which a solid modeler handles badly when it revolves about them.
   * The tangent points slide along the lines to make the corner symmetric, so
   * the lines stay exact and the joins stay smooth.
   */
  const filletBetweenLines = (from: number, to: number): { arc: ChainElement; a: Point; b: Point; worst: number } | null => {
    const t0 = unit(segment(from - 1));
    const t1 = unit(segment(to));
    const turn = cross(t0, t1);
    if (Math.abs(turn) < 1e-9) return null;
    const between = sub(at(to), at(from));
    const ahead = cross(between, t1) / turn;
    const behind = -cross(between, t0) / turn;
    if (!(ahead > 0) || !(behind > 0)) return null;
    const tangentLength = (ahead + behind) / 2;
    // Do not slide a tangent point past the far end of its line.
    if (tangentLength - ahead >= norm(segment(from - 1)) || tangentLength - behind >= norm(segment(to))) return null;
    const vertex = add(at(from), scale(t0, ahead));
    const a = sub(vertex, scale(t0, tangentLength));
    const b = add(vertex, scale(t1, tangentLength));
    const arc = arcThrough(a, t0, b);
    if (arc.kind !== "arc") return null;
    const elements: ChainElement[] = [
      { kind: "line", a: at(from - 1), b: a },
      arc,
      { kind: "line", a: b, b: at(to + 1) },
    ];
    const worst = deviation(from - 1, to + 1, elements);
    return Number.isFinite(worst) ? { arc, a, b, worst } : null;
  };

  // Start at a stop so no span has to wrap around the ring's seam.
  const first = Math.max(0, stop.indexOf(true));
  const chain: ArcChain = [];
  let maxDeviationMm = 0;
  let index = first;
  const last = first + count;
  while (index < last) {
    let limit = index + 1;
    while (limit < last && !stop[limit % count]) limit++;
    if (isLong(index - 1) && isLong(limit) && !corner[fitted(index)] && !corner[fitted(limit)]) {
      const fillet = filletBetweenLines(index, limit);
      if (fillet) {
        // Slide the two tangent points; the line already emitted before this corner follows.
        const previous = chain[chain.length - 1];
        if (previous?.kind === "line") chain[chain.length - 1] = { kind: "line", a: previous.a, b: fillet.a };
        points[fitted(index)] = fillet.a;
        points[fitted(limit)] = fillet.b;
        // The stretch that closes the ring ends where the first line began.
        if (limit === last && chain[0]?.kind === "line") chain[0] = { kind: "line", a: fillet.b, b: chain[0].b };
        chain.push(fillet.arc);
        maxDeviationMm = Math.max(maxDeviationMm, fillet.worst);
        index = limit;
        continue;
      }
    }
    // Whether a span fits is not monotonic in its length: a noisy tangent at
    // one vertex can spoil a span that a longer one, ending elsewhere, clears.
    // So keep reaching past a few misses before settling, then refine between
    // the farthest fit and the first miss beyond it.
    let best: { elements: ChainElement[]; worst: number } | null = null;
    let reach = index + 1;
    let low = index;
    let high = -1;
    let misses = 0;
    for (let step = 1; ; step += Math.max(1, step >> 1)) {
      const candidate = Math.min(limit, index + step);
      const fit = span(index, candidate);
      if (fit) {
        best = fit;
        reach = low = candidate;
        high = -1;
        misses = 0;
      } else {
        if (high < 0) high = candidate;
        if (++misses >= 4) break;
      }
      if (candidate === limit) break;
    }
    while (best && high >= 0 && high - low > 1) {
      const middle = (low + high) >> 1;
      const fit = span(index, middle);
      if (fit) {
        best = fit;
        reach = low = middle;
      } else high = middle;
    }
    if (!best) {
      // No smooth pair reaches even the next vertex: keep the straight segment,
      // which thinning already holds within its own allowance of the ring.
      const line: ChainElement = { kind: "line", a: at(index), b: at(index + 1) };
      best = { elements: [line], worst: deviation(index, index + 1, [line]) };
      reach = index + 1;
    }
    chain.push(...best.elements);
    maxDeviationMm = Math.max(maxDeviationMm, best.worst);
    index = reach;
  }

  const merged = mergeChain(chain);
  if (chainClosureGap(merged) > 1e-9) throw new Error("arc-chain: fitted boundary does not close");
  return {
    chain: merged,
    maxDeviationMm,
    shortestElementMm: Math.min(...merged.map(elementLength)),
  };
}
