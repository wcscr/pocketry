import { describe, expect, it } from "vitest";

import { boundsMaterialGrowth, preservesMaterial } from "./boundary-contract";
import { AUTO_STRAIGHTENING_DEPTH, straightenOutward } from "./outline-straightening";
import { signedArea } from "./rings";
import type { Outline, Point, Ring } from "./types";

const DEPTH = 0.5;
const W = 60, H = 30;

/**
 * A block whose bottom edge follows `profile`, given left to right from (0, 0) to (W, 0).
 * The ring has positive area, so the block is above that edge: a point of the profile
 * with y > 0 is a dip into the block.
 */
const block = (profile: Point[]): Ring => [...profile, { x: W, y: H }, { x: 0, y: H }];
const flat: Point[] = [{ x: 0, y: 0 }, { x: W, y: 0 }];
const shape = (outer: Ring, holes: Ring[] = []): Outline => [{ outer, holes }];
const key = (p: Point) => `${p.x},${p.y}`;

/** Teeth like a ribbed grip: a step in of `depth` just after each crest, then a ramp back out. */
function teeth(pitch: number, depth: number, crest: (x: number) => number = () => 0): Point[] {
  const profile: Point[] = [];
  for (let x = 0; x < W - 1e-9; x += pitch) {
    profile.push({ x, y: crest(x) });
    profile.push({ x: x + 0.2, y: crest(x + 0.2) + depth });
  }
  profile.push({ x: W, y: crest(W) });
  return profile;
}

/** Every pair of edges that are not neighbors stays apart. */
function isSimple(ring: Ring): boolean {
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < ring.length; i++) for (let j = i + 2; j < ring.length; j++) {
    if (i === 0 && j === ring.length - 1) continue;
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[j], d = ring[(j + 1) % ring.length];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
  }
  return true;
}

/** What every result must satisfy, whatever it did. */
function expectSafe(before: Outline, after: Outline, depth = DEPTH): void {
  expect(after.length).toBe(before.length);
  before.forEach((s, index) => {
    const rings: [Ring, Ring][] = [[s.outer, after[index].outer], ...s.holes.map((h, i): [Ring, Ring] => [h, after[index].holes[i]])];
    for (const [was, now] of rings) {
      // The points kept are points that were there, in the same order round the ring.
      const order = was.map(key);
      const places = now.map((p) => order.indexOf(key(p)));
      expect(places.every((at) => at >= 0)).toBe(true);
      const start = places.indexOf(Math.min(...places));
      const turned = [...places.slice(start), ...places.slice(0, start)];
      expect(turned.every((at, i) => i === 0 || at > turned[i - 1])).toBe(true);
      expect(Math.sign(signedArea(now))).toBe(Math.sign(signedArea(was)));
      expect(isSimple(now)).toBe(true);
    }
  });
  expectContained(before, after, depth);
}

/** No material is lost, and the boundary moves outward by no more than the depth. */
function expectContained(before: Outline, after: Outline, depth = DEPTH): void {
  expect(preservesMaterial(before, after, depth * 0.02)).toBe(true);
  expect(boundsMaterialGrowth(before, after, depth * 1.001)).toBe(true);
}

describe("straightenOutward", () => {
  it("leaves convex outlines alone, and hands back the same object", () => {
    const square = shape(block(flat));
    expect(straightenOutward(square, DEPTH).outline).toBe(square);
    const round = shape(Array.from({ length: 90 }, (_, i) => ({ x: 20 * Math.cos(i * Math.PI / 45), y: 20 * Math.sin(i * Math.PI / 45) })));
    const result = straightenOutward(round, DEPTH);
    expect(result.outline).toBe(round);
    expect(result.bridges).toBe(0);
  });

  it("bridges a notch no deeper than the limit and keeps a deeper one", () => {
    const notch = (depth: number) => shape(block([{ x: 0, y: 0 }, { x: 28, y: 0 }, { x: 30, y: depth }, { x: 32, y: 0 }, { x: W, y: 0 }]));
    const shallow = notch(0.3), result = straightenOutward(shallow, DEPTH);
    expect(result.outline[0].outer).toEqual(block(flat));
    expect(result.bridges).toBe(1);
    expect(result.maxDepth).toBeCloseTo(0.3, 9);
    expectSafe(shallow, result.outline);
    const deep = notch(0.8);
    expect(straightenOutward(deep, DEPTH).outline).toBe(deep);
  });

  it("replaces grip teeth on a straight edge with the line over their crests", () => {
    const ribbed = shape(block(teeth(5.7, 0.3)));
    const result = straightenOutward(ribbed, DEPTH);
    expect(result.outline[0].outer).toEqual(block(flat));
    expectSafe(ribbed, result.outline);
  });

  it("follows the crests of teeth that sit in a broad dip, without filling the dip beyond the limit", () => {
    // Crests on a shallow curve 0.74 deep over the edge, as on the tape measure's grip.
    const dip = (x: number) => 0.74 * 4 * (x / W) * (1 - x / W);
    const ribbed = shape(block(teeth(5.7, 0.3, dip)));
    const result = straightenOutward(ribbed, DEPTH);
    const kept = result.outline[0].outer;
    expect(kept.length).toBeLessThan(ribbed[0].outer.length / 2);
    // Only crests are kept: no point at the bottom of a tooth survives.
    for (const p of kept) if (p.y < H && p.x > 0 && p.x < W) expect(p.y).toBeCloseTo(dip(p.x), 9);
    expect(result.maxDepth).toBeLessThanOrEqual(DEPTH);
    expectSafe(ribbed, result.outline);
  });

  /** A smooth bay from x = from to x = to in an otherwise flat edge, `depth` at its middle. */
  const smoothBay = (depth: number, from = 0, to = W) => shape(block([
    ...(from > 0 ? [{ x: 0, y: 0 }] : []),
    ...Array.from({ length: 121 }, (_, i) => ({ x: from + i * (to - from) / 120, y: i % 120 ? depth * Math.sin(Math.PI * i / 120) : 0 })),
    ...(to < W ? [{ x: W, y: 0 }] : [])]));

  it("does not facet a smooth bay deeper than the limit", () => {
    const bay = smoothBay(2);
    expect(straightenOutward(bay, DEPTH).outline).toBe(bay);
    const narrow = smoothBay(2, 26, 34);
    expect(straightenOutward(narrow, DEPTH).outline).toBe(narrow);
  });

  it("turns a narrow smooth bay shallower than the limit into a straight edge", () => {
    const bay = smoothBay(0.4, 26, 34);
    const result = straightenOutward(bay, DEPTH);
    expect(result.outline[0].outer).toEqual(block(flat));
    expectSafe(bay, result.outline);
  });

  it("is not fooled into cutting a smooth bay by points that sit on top of one another", () => {
    const bay = smoothBay(2)[0].outer;
    // A repeated point, and a near-repeat nudged the way a crest would turn, at two places round the curve.
    const doubled = bay.flatMap((p, i) => i === 30 || i === 80 ? [{ x: p.x - 1e-4, y: p.y - 1e-4 }, p, { ...p }] : [p]);
    const before = shape(doubled), result = straightenOutward(before, DEPTH);
    expectContained(before, result.outline);
    // Whatever it tidies at the repeats themselves, it leaves the curve between them.
    expect(result.maxDepth).toBeLessThan(0.01);
    expect(result.outline[0].outer.length).toBeGreaterThan(doubled.length - 6);
  });

  it("follows a curve over its ribs with short lines, not long flats", () => {
    // Ribs 0.3 deep every 3 mm along an edge that curves into the block on a 30 mm radius.
    const radius = 30, center = { x: W / 2, y: -Math.sqrt(radius * radius - (W / 2 - 5) ** 2) };
    const curve = (x: number) => center.y + Math.sqrt(radius * radius - (x - center.x) ** 2);
    const profile: Point[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    for (let x = 5; x < W - 5 - 1e-9; x += 3) profile.push({ x, y: curve(x) }, { x: x + 1.5, y: curve(x + 1.5) + 0.3 });
    profile.push({ x: W - 5, y: 0 }, { x: W, y: 0 });
    const before = shape(block(profile)), result = straightenOutward(before, DEPTH);
    expectSafe(before, result.outline);
    expect(result.bridges).toBeGreaterThan(4);
    const kept = result.outline[0].outer;
    for (let i = 0; i < kept.length; i++) {
      const a = kept[i], b = kept[(i + 1) % kept.length];
      if (a.y < H && b.y < H && a.x >= 5 && b.x <= W - 5) expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(10);
    }
    // Every rib's crest stays within a fifth of the depth of the new edge.
    for (const p of profile) if (Math.abs(p.y - curve(p.x)) < 1e-9 && p.x > 5 && p.x < W - 5) {
      const gap = Math.min(...kept.map((a, i) => { const b = kept[(i + 1) % kept.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }));
      expect(gap).toBeLessThanOrEqual(DEPTH / 5 + 1e-9);
    }
  });

  it("keeps a hollow that is shallow but wide: that is the tool's shape, not a ripple", () => {
    const hollow = smoothBay(0.4);
    expect(straightenOutward(hollow, DEPTH).outline).toBe(hollow);
    // Asked to, it will bridge it.
    const result = straightenOutward(hollow, DEPTH, { width: W });
    expect(result.outline[0].outer).toEqual(block(flat));
    expectSafe(hollow, result.outline);
  });

  it("runs a line from the top of a small step to a corner close by, and keeps a shoulder with a long run after it", () => {
    const step = (height: number, at: number) => shape(block([{ x: 0, y: 0 }, { x: at, y: 0 }, { x: at + 0.1, y: height }, { x: W, y: height }]));
    const near = step(0.4, 50), result = straightenOutward(near, DEPTH);
    expect(result.outline[0].outer).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: W, y: 0.4 }, { x: W, y: H }, { x: 0, y: H }]);
    expectSafe(near, result.outline);
    const shoulder = step(0.4, 20);
    expect(straightenOutward(shoulder, DEPTH).outline).toBe(shoulder);
    const tall = step(0.8, 50);
    expect(straightenOutward(tall, DEPTH).outline).toBe(tall);
  });

  it("bridges a shallow bay that is wider inside than at its mouth only from points that span all of it", () => {
    const undercut = (depth: number) => shape(block([{ x: 0, y: 0 }, { x: 28, y: 0 }, { x: 26, y: depth / 2 }, { x: 26, y: depth },
      { x: 34, y: depth }, { x: 34, y: depth / 2 }, { x: 32, y: 0 }, { x: W, y: 0 }]));
    // A line across the mouth alone would leave the bay's sides behind it; the line between the corners does not.
    const shallow = undercut(0.4), result = straightenOutward(shallow, DEPTH);
    expect(result.outline[0].outer).toEqual(block(flat));
    expectSafe(shallow, result.outline);
    const deep = undercut(0.8);
    expect(straightenOutward(deep, DEPTH).outline).toBe(deep);
  });

  it("does not bridge across another part of the outline", () => {
    // A separate sliver stands in the notch: a line across the notch's mouth would cut through it.
    const notched = block([{ x: 0, y: 0 }, { x: 26, y: 0 }, { x: 30, y: 0.4 }, { x: 34, y: 0 }, { x: W, y: 0 }]);
    const sliver: Ring = [{ x: 29.9, y: -5 }, { x: 30.1, y: -5 }, { x: 30.1, y: 0.2 }, { x: 29.9, y: 0.2 }];
    const both: Outline = [{ outer: notched, holes: [] }, { outer: sliver, holes: [] }];
    expect(straightenOutward(both, DEPTH).outline).toBe(both);
    // Without the sliver the same notch is bridged.
    expect(straightenOutward(shape(notched), DEPTH).bridges).toBe(1);
  });

  it("bridges a dip in a hole's edge, which makes the hole smaller, and leaves a plain hole alone", () => {
    const outer: Ring = [{ x: -10, y: -10 }, { x: 70, y: -10 }, { x: 70, y: 40 }, { x: -10, y: 40 }];
    // A hole is wound the other way. This one has a small pocket of air let into its right-hand wall.
    const plain: Ring = [{ x: 10, y: 5 }, { x: 10, y: 25 }, { x: 50, y: 25 }, { x: 50, y: 5 }];
    const pocketed: Ring = [{ x: 10, y: 5 }, { x: 10, y: 25 }, { x: 50, y: 25 }, { x: 50, y: 17 }, { x: 50.3, y: 15 }, { x: 50, y: 13 }, { x: 50, y: 5 }];
    expect(signedArea(pocketed)).toBeLessThan(0);
    const before = shape(outer, [pocketed]), result = straightenOutward(before, DEPTH);
    // The points either side of the pocket stay; a hole's own corners are never where a line may end.
    expect(result.outline[0].holes[0]).toEqual(pocketed.filter((p) => p.x <= 50));
    expect(result.outline[0].outer).toBe(outer);
    expectSafe(before, result.outline);
    const untouched = shape(outer, [plain]);
    expect(straightenOutward(untouched, DEPTH).outline).toBe(untouched);
  });

  it("gives the same shape wherever the ring happens to start", () => {
    const ring = block(teeth(5.7, 0.3, (x) => 0.3 * Math.sin(x / 9) ** 2));
    const reference = new Set(straightenOutward(shape(ring), DEPTH).outline[0].outer.map(key));
    for (const shift of [1, 7, 13, ring.length - 2]) {
      const turned = [...ring.slice(shift), ...ring.slice(0, shift)];
      expect(new Set(straightenOutward(shape(turned), DEPTH).outline[0].outer.map(key))).toEqual(reference);
    }
  });

  it("is safe on irregular outlines", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 60; round++) {
      // A wobbly loop with ripples of several sizes and a few sharp teeth.
      const count = 40 + Math.floor(random() * 160), phase = random() * 6, lobes = 2 + Math.floor(random() * 4);
      const ring: Ring = Array.from({ length: count }, (_, i) => {
        const angle = 2 * Math.PI * i / count;
        const radius = 30 + 6 * Math.sin(lobes * angle + phase) + 0.25 * Math.sin(23 * angle) + (random() < 0.15 ? -random() * 0.6 : 0) + random() * 0.05;
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      });
      const before = shape(ring), result = straightenOutward(before, DEPTH);
      expectSafe(before, result.outline);
      expect(result.maxDepth).toBeLessThanOrEqual(DEPTH * (1 + 1e-9));
    }
  });

  it("returns the input for outlines and depths it cannot work with", () => {
    const triangle = shape([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]);
    expect(straightenOutward(triangle, DEPTH).outline).toBe(triangle);
    const notched = shape(block([{ x: 0, y: 0 }, { x: 28, y: 0 }, { x: 30, y: 0.3 }, { x: 32, y: 0 }, { x: W, y: 0 }]));
    for (const depth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(straightenOutward(notched, depth).outline).toBe(notched);
    const broken = shape(block([{ x: 0, y: 0 }, { x: 28, y: Number.NaN }, { x: W, y: 0 }]));
    expect(straightenOutward(broken, DEPTH).outline).toBe(broken);
    expect(straightenOutward([], DEPTH).outline).toEqual([]);
  });

  it("stays quick on a long, finely sampled outline", () => {
    // 24,000 points of fine sawtooth round a large block: far more than a traced tool has.
    const profile: Point[] = [];
    for (let i = 0; i < 12_000; i++) profile.push({ x: i * 0.05, y: i % 2 ? 0.1 : 0 });
    const ring: Ring = [...profile, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 }];
    const began = performance.now(), result = straightenOutward(shape(ring), DEPTH);
    expect(result.outline[0].outer).toEqual([{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 }]);
    expect(performance.now() - began).toBeLessThan(2000);
  });

  it("names its default depth for both units", () => {
    expect(AUTO_STRAIGHTENING_DEPTH).toEqual({ mm: 0.5, px: 5 });
  });
});
