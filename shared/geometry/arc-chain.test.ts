import { describe, expect, it } from "vitest";

import {
  arcThrough,
  biarc,
  chainClosureGap,
  chainSignedArea,
  distanceToChain,
  distanceToElement,
  elementLength,
  endTangent,
  fitArcChain,
  flattenChain,
  junctionTurns,
  mergeChain,
  pointAlong,
  reverseChain,
  startTangent,
  type ArcChain,
  type ArcElement,
  type ChainElement,
} from "./arc-chain";
import { distanceToSegment, signedArea } from "./rings";
import type { Point, Ring } from "./types";

const point = (x: number, y: number): Point => ({ x, y });

/** Counter-clockwise quarter of the unit circle from (1, 0) to (0, 1). */
const quarter: ArcElement = {
  kind: "arc",
  a: point(1, 0),
  b: point(0, 1),
  center: point(0, 0),
  radius: 1,
  sweep: Math.PI / 2,
};

/**
 * A `width` × `height` rectangle with its corners rounded to `radius`, wound
 * counter-clockwise from the bottom edge.
 */
function roundedRectangle(width: number, height: number, radius: number): ArcChain {
  const corner = (cx: number, cy: number, from: number): ArcElement => ({
    kind: "arc",
    a: point(cx + radius * Math.cos(from), cy + radius * Math.sin(from)),
    b: point(
      cx + radius * Math.cos(from + Math.PI / 2),
      cy + radius * Math.sin(from + Math.PI / 2),
    ),
    center: point(cx, cy),
    radius,
    sweep: Math.PI / 2,
  });
  const corners = [
    corner(width - radius, radius, -Math.PI / 2),
    corner(width - radius, height - radius, 0),
    corner(radius, height - radius, Math.PI / 2),
    corner(radius, radius, Math.PI),
  ];
  const chain: ArcChain = [];
  corners.forEach((arc, index) => {
    const previous = corners[(index + 3) % 4];
    chain.push({ kind: "line", a: previous.b, b: arc.a }, arc);
  });
  return chain;
}

describe("element measurements", () => {
  it("measures lines and arcs along their length", () => {
    expect(elementLength({ kind: "line", a: point(0, 0), b: point(3, 4) })).toBeCloseTo(5, 12);
    expect(elementLength(quarter)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("reports the direction of travel at both ends of an arc", () => {
    expect(startTangent(quarter).x).toBeCloseTo(0, 12);
    expect(startTangent(quarter).y).toBeCloseTo(1, 12);
    expect(endTangent(quarter).x).toBeCloseTo(-1, 12);
    expect(endTangent(quarter).y).toBeCloseTo(0, 12);
  });

  it("flips the tangents of a clockwise arc", () => {
    const clockwise: ArcElement = { ...quarter, a: quarter.b, b: quarter.a, sweep: -Math.PI / 2 };
    expect(startTangent(clockwise).x).toBeCloseTo(1, 12);
    expect(endTangent(clockwise).y).toBeCloseTo(-1, 12);
  });

  it("walks an arc through its midpoint", () => {
    const middle = pointAlong(quarter, 0.5);
    expect(middle.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(middle.y).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe("arcThrough", () => {
  it("recovers the circle from a start direction and an end point", () => {
    const element = arcThrough(point(1, 0), point(0, 1), point(0, 1));
    expect(element.kind).toBe("arc");
    const arc = element as ArcElement;
    expect(arc.center.x).toBeCloseTo(0, 12);
    expect(arc.center.y).toBeCloseTo(0, 12);
    expect(arc.radius).toBeCloseTo(1, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 12);
  });

  it("turns the other way when the end point lies to the right", () => {
    const arc = arcThrough(point(0, 0), point(1, 0), point(1, -1)) as ArcElement;
    expect(arc.kind).toBe("arc");
    expect(arc.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(arc.center.y).toBeCloseTo(-1, 12);
  });

  it("returns a line when the end point is straight ahead", () => {
    expect(arcThrough(point(0, 0), point(1, 0), point(5, 0)).kind).toBe("line");
  });
});

describe("biarc", () => {
  it("stays on the circle when both ends are tangent to one", () => {
    const at = (angle: number) => point(7 * Math.cos(angle), 7 * Math.sin(angle));
    const tangent = (angle: number) => point(-Math.sin(angle), Math.cos(angle));
    const pair = biarc(at(0.2), tangent(0.2), at(1.1), tangent(1.1));
    expect(pair).not.toBeNull();
    for (const element of pair!) {
      expect(element.kind).toBe("arc");
      const arc = element as ArcElement;
      expect(arc.radius).toBeCloseTo(7, 9);
      expect(Math.hypot(arc.center.x, arc.center.y)).toBeLessThan(1e-9);
    }
  });

  it("joins its two arcs without a kink", () => {
    const pair = biarc(point(0, 0), point(1, 0), point(4, 3), point(0, 1))!;
    const leaving = endTangent(pair[0]);
    const entering = startTangent(pair[1]);
    expect(leaving.x * entering.y - leaving.y * entering.x).toBeCloseTo(0, 12);
    expect(pair[0].b).toEqual(pair[1].a);
    expect(endTangent(pair[1]).y).toBeCloseTo(1, 12);
  });

  it("builds an S-curve between parallel offset tangents", () => {
    const pair = biarc(point(0, 0), point(1, 0), point(4, 2), point(1, 0))!;
    const [first, second] = pair as [ArcElement, ArcElement];
    expect(Math.sign(first.sweep)).toBe(-Math.sign(second.sweep));
  });

  it("reduces to lines along a straight run", () => {
    const pair = biarc(point(0, 0), point(1, 0), point(9, 0), point(1, 0))!;
    expect(pair.map((element) => element.kind)).toEqual(["line", "line"]);
  });
});

describe("distanceToElement", () => {
  it("measures radially inside an arc's sweep and to its ends outside it", () => {
    expect(distanceToElement(point(2, 2), quarter)).toBeCloseTo(Math.hypot(2, 2) - 1, 12);
    expect(distanceToElement(point(0.2, 0.2), quarter)).toBeCloseTo(1 - Math.hypot(0.2, 0.2), 12);
    // Below the x axis the nearest point is the arc's start.
    expect(distanceToElement(point(1, -3), quarter)).toBeCloseTo(3, 12);
  });

  it("clamps to the ends of a line", () => {
    const line: ChainElement = { kind: "line", a: point(0, 0), b: point(10, 0) };
    expect(distanceToElement(point(4, 3), line)).toBeCloseTo(3, 12);
    expect(distanceToElement(point(13, 4), line)).toBeCloseTo(5, 12);
  });
});

describe("closed chains", () => {
  const chain = roundedRectangle(30, 20, 3);

  it("closes exactly and joins smoothly", () => {
    expect(chainClosureGap(chain)).toBeLessThan(1e-12);
    for (const turn of junctionTurns(chain)) expect(Math.abs(turn)).toBeLessThan(1e-12);
  });

  it("computes the exact enclosed area", () => {
    expect(chainSignedArea(chain)).toBeCloseTo(30 * 20 - (4 - Math.PI) * 9, 9);
  });

  it("changes the sign of the area when reversed", () => {
    const reversed = reverseChain(chain);
    expect(chainSignedArea(reversed)).toBeCloseTo(-chainSignedArea(chain), 9);
    expect(chainClosureGap(reversed)).toBeLessThan(1e-12);
  });

  it("flattens within the requested chord tolerance", () => {
    const ring = flattenChain(chain, 0.001);
    for (const vertex of ring) expect(distanceToChain(vertex, chain)).toBeLessThan(1e-9);
    // Chords cut inside each arc, so the polygon is smaller by at most the sag times the arc length.
    const loss = chainSignedArea(chain) - signedArea(ring);
    expect(loss).toBeGreaterThan(0);
    expect(loss).toBeLessThan(0.001 * 2 * Math.PI * 3);
  });

  it("reports sharp corners by the side they turn toward", () => {
    // An L: five convex corners and one inside corner, counter-clockwise.
    const corners = [point(0, 0), point(6, 0), point(6, 2), point(2, 2), point(2, 5), point(0, 5)];
    const outline: ArcChain = corners.map((a, index) => ({
      kind: "line",
      a,
      b: corners[(index + 1) % corners.length],
    }));
    const turns = junctionTurns(outline);
    expect(turns.filter((turn) => turn > 0)).toHaveLength(5);
    expect(turns.filter((turn) => turn < 0)).toHaveLength(1);
    // The inside corner is where the third edge meets the fourth.
    expect(turns[2]).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("mergeChain", () => {
  it("rejoins pieces of one circle and one line", () => {
    const half = pointAlong(quarter, 0.5);
    const split: ArcChain = [
      { kind: "line", a: point(1, -4), b: point(1, -2) },
      { kind: "line", a: point(1, -2), b: point(1, 0) },
      { ...quarter, b: half, sweep: Math.PI / 4 },
      { ...quarter, a: half, sweep: Math.PI / 4 },
    ];
    const merged = mergeChain(split);
    expect(merged.map((element) => element.kind)).toEqual(["line", "arc"]);
    expect((merged[1] as ArcElement).sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(elementLength(merged[0])).toBeCloseTo(4, 12);
  });

  it("keeps arcs of different circles apart", () => {
    const other: ArcElement = {
      kind: "arc",
      a: point(0, 1),
      b: point(-2, 3),
      center: point(0, 3),
      radius: 2,
      sweep: -Math.PI / 2,
    };
    expect(mergeChain([quarter, other])).toHaveLength(2);
  });
});

/** Largest distance between a ring and a chain, measured densely in both directions. */
function hausdorff(ring: Ring, chain: ArcChain): number {
  let worst = 0;
  ring.forEach((p, index) => {
    const q = ring[(index + 1) % ring.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.005));
    for (let step = 0; step < steps; step++) {
      const sample = point(p.x + ((q.x - p.x) * step) / steps, p.y + ((q.y - p.y) * step) / steps);
      worst = Math.max(worst, distanceToChain(sample, chain));
    }
  });
  for (const element of chain) {
    const steps = Math.max(2, Math.ceil(elementLength(element) / 0.005));
    for (let step = 0; step <= steps; step++) {
      const sample = pointAlong(element, step / steps);
      let nearest = Infinity;
      ring.forEach((p, index) => {
        nearest = Math.min(nearest, distanceToSegment(sample, p, ring[(index + 1) % ring.length]));
      });
      worst = Math.max(worst, nearest);
    }
  }
  return worst;
}

describe("fitArcChain", () => {
  it("recovers the lines and circles of a finely sampled rounded rectangle", () => {
    const source = roundedRectangle(30, 20, 3);
    const ring = flattenChain(source, 1e-5);
    expect(ring.length).toBeGreaterThan(500);
    const { chain, maxDeviationMm } = fitArcChain(ring, { toleranceMm: 0.01 });
    expect(chain.filter((element) => element.kind === "line")).toHaveLength(4);
    const arcs = chain.filter((element): element is ArcElement => element.kind === "arc");
    expect(arcs).toHaveLength(4);
    for (const arc of arcs) {
      expect(arc.radius).toBeCloseTo(3, 6);
      expect(arc.sweep).toBeCloseTo(Math.PI / 2, 6);
    }
    expect(maxDeviationMm).toBeLessThan(2e-5);
    expect(chainClosureGap(chain)).toBeLessThan(1e-12);
    for (const turn of junctionTurns(chain)) expect(Math.abs(turn)).toBeLessThan(1e-6);
    expect(chainSignedArea(chain)).toBeCloseTo(chainSignedArea(source), 6);
  });

  it("keeps a polygon's corners and edges exactly", () => {
    const corners = [point(0, 0), point(60, 0), point(60, 20), point(20, 20), point(20, 40), point(0, 40)];
    const { chain, maxDeviationMm } = fitArcChain(corners, { toleranceMm: 0.01 });
    expect(chain.map((element) => element.kind)).toEqual(Array(6).fill("line"));
    expect(maxDeviationMm).toBeLessThan(1e-12);
    expect(chainSignedArea(chain)).toBeCloseTo(signedArea(corners), 12);
    expect(junctionTurns(chain).filter((turn) => turn < -1)).toHaveLength(1);
  });

  it("keeps a short edge between two sharp corners instead of blending across it", () => {
    // A 0.4 mm jog between long edges, at about 56 degrees to each.
    const ring = [point(0, 0), point(30, 0), point(30, 10), point(30.33, 10.23), point(30.33, 25), point(0, 25)];
    const { chain, maxDeviationMm } = fitArcChain(ring, { toleranceMm: 0.01 });
    expect(chain.map((element) => element.kind)).toEqual(Array(6).fill("line"));
    expect(maxDeviationMm).toBeLessThan(1e-12);
    expect(hausdorff(ring, chain)).toBeLessThan(1e-12);
  });

  it("collapses the fan of points an offset leaves at an inside corner", () => {
    const fan = Array.from({ length: 6 }, (_, index) => point(20 - 1e-5 * index, 20 + 1e-5 * index));
    const ring = [point(0, 0), point(60, 0), point(60, 20), ...fan, point(20, 40), point(0, 40)];
    const { chain } = fitArcChain(ring, { toleranceMm: 0.01 });
    expect(chain).toHaveLength(6);
    expect(Math.min(...chain.map(elementLength))).toBeGreaterThan(1);
  });

  it("stays within tolerance of a noisy curve, measured both ways", () => {
    const ring: Ring = Array.from({ length: 314 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 314;
      const radius = 10 + 0.003 * Math.sin(17 * angle) + 0.002 * Math.cos(41 * angle);
      return point(radius * Math.cos(angle), radius * Math.sin(angle));
    });
    const { chain, maxDeviationMm } = fitArcChain(ring, { toleranceMm: 0.01 });
    expect(chain.length).toBeLessThan(ring.length / 4);
    expect(chainClosureGap(chain)).toBeLessThan(1e-9);
    const measured = hausdorff(ring, chain);
    expect(measured).toBeLessThanOrEqual(0.01 + 1e-6);
    // The reported value must not understate what an independent dense check finds.
    expect(maxDeviationMm).toBeGreaterThanOrEqual(measured - 5e-4);
  });

  it("preserves the winding of a hole", () => {
    const ring = flattenChain(reverseChain(roundedRectangle(12, 8, 2)), 1e-5);
    expect(signedArea(ring)).toBeLessThan(0);
    const { chain } = fitArcChain(ring, { toleranceMm: 0.01 });
    expect(chainSignedArea(chain)).toBeLessThan(0);
    expect(chain.filter((element) => element.kind === "arc").every((arc) => (arc as ArcElement).sweep < 0)).toBe(true);
  });

  it("closes exactly when the corner that wraps the ring's seam is made symmetric", () => {
    // Nudge one tangent point so the corner's two tangent lengths differ, as offset rounding leaves them.
    const ring = flattenChain(roundedRectangle(24, 16, 1.8), 1e-5);
    ring[0] = point(ring[0].x + 0.004, ring[0].y);
    const { chain, maxDeviationMm } = fitArcChain(ring, { toleranceMm: 0.01 });
    expect(chain).toHaveLength(8);
    expect(chainClosureGap(chain)).toBeLessThan(1e-12);
    for (const turn of junctionTurns(chain)) expect(Math.abs(turn)).toBeLessThan(1e-9);
    expect(maxDeviationMm).toBeLessThan(0.01);
  });

  it("joins arcs to the lines they are tangent to without a kink", () => {
    // Mixed radii, as clearance and corner rounding leave them.
    const source = roundedRectangle(40, 12, 0.3);
    const { chain } = fitArcChain(flattenChain(source, 1e-6), { toleranceMm: 0.01 });
    expect(chain).toHaveLength(8);
    for (const turn of junctionTurns(chain)) expect(Math.abs(turn)).toBeLessThan(1e-5);
  });
});
