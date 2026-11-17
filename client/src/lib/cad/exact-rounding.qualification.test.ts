import { beforeAll, describe, expect, it } from "vitest";

import type { ArcChain, ArcElement } from "@shared/geometry/arc-chain";
import { roundingInset } from "@shared/geometry/inset-rounding";
import type { Point } from "@shared/geometry/types";

import { CadContext, type CadShape } from "./adapter";
import { clipBelow } from "./construction";
import { roundBottomExact, roundMouthExact, type ExactRoundingStats } from "./exact-rounding";
import { extrudeSection } from "./profile-operations";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { sectionSlab, type SectionRegion } from "./section-chain";

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await loadCad();
}, 60_000);

const DEPTH = 12;
const point = (x: number, y: number): Point => ({ x, y });

/** Lines through the given corners, counter-clockwise. */
function polygonChain(corners: Point[]): ArcChain {
  return corners.map((a, index) => ({
    kind: "line",
    a,
    b: corners[(index + 1) % corners.length],
  }));
}

/** A `width` × `height` rectangle with corners rounded to `radius`, counter-clockwise. */
function roundedRectangle(width: number, height: number, radius: number): ArcChain {
  const corner = (cx: number, cy: number, from: number): ArcElement => ({
    kind: "arc",
    a: point(cx + radius * Math.cos(from), cy + radius * Math.sin(from)),
    b: point(cx + radius * Math.cos(from + Math.PI / 2), cy + radius * Math.sin(from + Math.PI / 2)),
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
    chain.push({ kind: "line", a: corners[(index + 3) % 4].b, b: arc.a }, arc);
  });
  return chain;
}

/** Volume the rounding rule removes, from the exact area of each inset section. */
function removedByRule(area: (inset: number) => number, radius: number): number {
  const steps = 40_000;
  let removed = 0;
  for (let step = 0; step < steps; step++) {
    const height = (radius * (step + 0.5)) / steps;
    removed += (area(0) - area(roundingInset(radius, height))) * (radius / steps);
  }
  return removed;
}

function surfaceKinds(c: CadContext, solid: CadShape): Set<string> {
  const kinds = new Set<string>();
  for (const shape of c.subshapes(solid, "face")) {
    const surface = c.own(new c.oc.BRepAdaptor_Surface(c.own(c.oc.TopoDS.Face(shape)), true));
    const type = surface.GetType();
    const types = c.oc.GeomAbs_SurfaceType;
    kinds.add(
      type === types.GeomAbs_Plane ? "plane"
        : type === types.GeomAbs_Cylinder ? "cylinder"
          : type === types.GeomAbs_Torus ? "torus"
            : type === types.GeomAbs_SurfaceOfRevolution ? "revolution"
              : "other",
    );
  }
  return kinds;
}

/** Rounds a pocket of the given section and reports what the rule should have removed. */
function round(regions: SectionRegion[], radius: number) {
  const c = new CadContext(oc);
  try {
    const prism = extrudeSection(c, sectionSlab(c, regions), -DEPTH, 0);
    const stats: ExactRoundingStats = { bands: 0, recut: 0, witnesses: 0, maxWitnessErrorMm: 0 };
    const rounded = roundBottomExact(c, prism, regions, -DEPTH, radius, "test rounding", stats);
    return {
      valid: c.valid(rounded),
      removed: c.volume(prism) - c.volume(rounded),
      kinds: surfaceKinds(c, rounded),
      maxTolerance: c.maxNativeToleranceMm,
      stats,
    };
  } finally {
    c.dispose();
  }
}

describe("exact floor rounding", () => {
  it("matches the rule where the corners are tighter than the rounding radius", () => {
    // 1 mm corners under a 2.8 mm floor radius: no rolling-ball fillet exists here.
    const result = round([{ outer: roundedRectangle(30, 30, 1), holes: [] }], 2.8);
    const expected = removedByRule(
      (inset) => (30 - 2 * inset) ** 2 - (4 - Math.PI) * Math.max(1 - inset, 0) ** 2,
      2.8,
    );
    expect(result.valid).toBe(true);
    expect(result.removed).toBeCloseTo(expected, 3);
    // The kernel only calls a revolved arc a torus when its axis lies outside the arc's circle;
    // around these tight corners it does not, so the face is a surface of revolution of that arc.
    expect(result.kinds).toEqual(new Set(["plane", "cylinder", "revolution"]));
    expect(result.stats.bands).toBe(8);
    expect(result.stats.recut).toBe(0);
    expect(result.stats.witnesses).toBeGreaterThan(8);
    expect(result.stats.maxWitnessErrorMm).toBeLessThan(1e-6);
  }, 60_000);

  it("matches the rule when corners are wider than the rounding radius", () => {
    const result = round([{ outer: roundedRectangle(30, 30, 4), holes: [] }], 2.8);
    const expected = removedByRule(
      (inset) => (30 - 2 * inset) ** 2 - (4 - Math.PI) * (4 - inset) ** 2,
      2.8,
    );
    expect(result.valid).toBe(true);
    expect(result.removed).toBeCloseTo(expected, 3);
  }, 60_000);

  it("lets a slot narrower than twice the radius close up at the floor", () => {
    const result = round([{ outer: roundedRectangle(40, 4, 1), holes: [] }], 2.8);
    const expected = removedByRule((inset) => {
      if (inset >= 2) return 0;
      return (40 - 2 * inset) * (4 - 2 * inset) - (4 - Math.PI) * Math.max(1 - inset, 0) ** 2;
    }, 2.8);
    expect(result.valid).toBe(true);
    expect(result.removed).toBeCloseTo(expected, 3);
  }, 60_000);

  it("rounds around a sharp inside corner", () => {
    const outline = polygonChain([point(0, 0), point(60, 0), point(60, 20), point(20, 20), point(20, 40), point(0, 40)]);
    const result = round([{ outer: outline, holes: [] }], 2);
    // Inset of an L: five convex right angles each give back inset², the inside corner removes a quarter disk.
    const expected = removedByRule((inset) => 1600 - 200 * inset + 5 * inset ** 2 - (Math.PI / 4) * inset ** 2, 2);
    expect(result.valid).toBe(true);
    expect(result.removed).toBeCloseTo(expected, 3);
    expect(result.stats.bands).toBe(7);
  }, 60_000);

  it("rounds the floor around a hole in the section", () => {
    const start = point(21, 15);
    const hole: ArcChain = [{ kind: "arc", a: start, b: start, center: point(15, 15), radius: 6, sweep: -2 * Math.PI }];
    const result = round([{ outer: polygonChain([point(0, 0), point(30, 0), point(30, 30), point(0, 30)]), holes: [hole] }], 2);
    const expected = removedByRule(
      (inset) => (30 - 2 * inset) ** 2 - Math.PI * (6 + inset) ** 2,
      2,
    );
    expect(result.valid).toBe(true);
    expect(result.removed).toBeCloseTo(expected, 3);
    // Around a hole the wall curves away from the pocket, which gives a true torus.
    expect(result.kinds).toEqual(new Set(["plane", "cylinder", "torus"]));
  }, 60_000);

  it("keeps the kernel's boundary tolerance within the export ceiling", () => {
    const result = round([{ outer: roundedRectangle(30, 30, 1), holes: [] }], 2.8);
    expect(result.maxTolerance).toBeLessThanOrEqual(0.00001);
  }, 60_000);

  it("refuses to return a solid whose surface is not where the section says", () => {
    const c = new CadContext(oc);
    try {
      // The described section is wider than the solid, so the band along its far wall has
      // nothing to cut: the same outcome as a cut the kernel silently skips.
      const built: SectionRegion[] = [{ outer: roundedRectangle(24, 30, 1), holes: [] }];
      const described: SectionRegion[] = [{ outer: roundedRectangle(30, 30, 1), holes: [] }];
      const prism = extrudeSection(c, sectionSlab(c, built), -DEPTH, 0);
      expect(() => roundBottomExact(c, prism, described, -DEPTH, 2.8, "mismatched rounding")).toThrow(
        /rounding bands did not take/,
      );
    } finally {
      c.dispose();
    }
  }, 60_000);
});

describe("exact mouth rounding", () => {
  /** Distance from a point to the surface of `solid`. */
  function distance(c: CadContext, solid: CadShape, x: number, y: number, z: number): number {
    const vertex = c.own(c.own(new c.oc.BRepBuilderAPI_MakeVertex(c.point(x, y, z))).Vertex());
    return Math.min(
      ...c.subshapes(solid, "shell").map((shell) => c.own(new c.oc.BRepExtrema_DistShapeShape(vertex, shell)).Value()),
    );
  }

  /** A pocket cutter over `regions` from 10 mm below the surface (z = 0) to 5 mm above, with its mouth rounded. */
  function mouth(regions: SectionRegion[], radius: number) {
    const c = new CadContext(oc);
    const cutter = extrudeSection(c, sectionSlab(c, regions), -10, 5);
    const stats: ExactRoundingStats = { bands: 0, recut: 0, witnesses: 0, maxWitnessErrorMm: 0 };
    const rounded = roundMouthExact(c, cutter, regions, 0, radius, "test mouth", stats);
    return { c, cutter, rounded, stats };
  }

  /** Volume the top-edge rule adds below the surface, from the exact area of each widened section. */
  function addedByRule(extraArea: (outset: number) => number, radius: number): number {
    const steps = 40_000;
    let added = 0;
    for (let step = 0; step < steps; step++) {
      const depth = (radius * (step + 0.5)) / steps;
      added += extraArea(roundingInset(radius, depth)) * (radius / steps);
    }
    return added;
  }

  it("rounds the top edge over rather than cutting a cove", () => {
    const { c, rounded } = mouth([{ outer: polygonChain([point(-10, -10), point(10, -10), point(10, 10), point(-10, 10)]), holes: [] }], 2);
    try {
      expect(c.valid(rounded)).toBe(true);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const angle = (fraction * Math.PI) / 2;
        // The print path's profile: a quarter circle centered one radius out and one radius down.
        expect(distance(c, rounded, 10 + 2 - 2 * Math.cos(angle), 0, -2 + 2 * Math.sin(angle))).toBeLessThan(1e-6);
        // A fillet of the widened prism would instead put the surface on a circle centered on the wall's top edge.
        expect(distance(c, rounded, 10 + 2 * Math.sin(angle), 0, -2 * Math.cos(angle))).toBeGreaterThan(0.5);
      }
    } finally {
      c.dispose();
    }
  }, 60_000);

  it("adds exactly the volume of the rule, including around sharp corners", () => {
    const { c, cutter, rounded, stats } = mouth([{ outer: polygonChain([point(-10, -6), point(10, -6), point(10, 6), point(-10, 6)]), holes: [] }], 1.5);
    try {
      // A 20 x 12 rectangle widened by e gains perimeter * e + pi * e^2.
      const expected = addedByRule((outset) => 64 * outset + Math.PI * outset ** 2, 1.5);
      const below = (solid: CadShape) => c.volume(clipBelow(c, solid, 0, "below the surface"));
      expect(below(rounded) - below(cutter)).toBeCloseTo(expected, 3);
      // Four walls and the fans around the four corners.
      expect(stats.bands).toBe(8);
      expect(stats.maxWitnessErrorMm).toBeLessThan(1e-6);
      expect(c.maxNativeToleranceMm).toBeLessThanOrEqual(0.00001);
    } finally {
      c.dispose();
    }
  }, 60_000);

  it("follows rounded corners and an island of material inside the pocket", () => {
    const start = point(3, 0);
    const island: ArcChain = [{ kind: "arc", a: start, b: start, center: point(0, 0), radius: 3, sweep: -2 * Math.PI }];
    const { c, cutter, rounded } = mouth([{ outer: roundedRectangle(30, 20, 4).map(shift(-15, -10)), holes: [island] }], 1);
    try {
      // The outer boundary grows by e; the island of material shrinks by e.
      const expected = addedByRule(
        (outset) => (2 * (22 + 12) + 2 * Math.PI * 4) * outset + Math.PI * outset ** 2 + Math.PI * (9 - (3 - outset) ** 2),
        1,
      );
      const below = (solid: CadShape) => c.volume(clipBelow(c, solid, 0, "below the surface"));
      expect(c.valid(rounded)).toBe(true);
      expect(below(rounded) - below(cutter)).toBeCloseTo(expected, 3);
    } finally {
      c.dispose();
    }
  }, 60_000);
});

/** Moves every point of a chain element by a fixed offset. */
function shift(dx: number, dy: number) {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return (element: ArcChain[number]): ArcChain[number] =>
    element.kind === "line"
      ? { kind: "line", a: move(element.a), b: move(element.b) }
      : { ...element, a: move(element.a), b: move(element.b), center: move(element.center) };
}
