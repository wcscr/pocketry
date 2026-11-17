import { beforeAll, describe, expect, it } from "vitest";

import { fingerHoleSchema, type FingerHole } from "@shared/gridfinity/cutout";

import {
  buildRoundedFingerAccessCutter,
  fingerAccessHalfWidthAtZ,
  fingerAccessRimGeometry,
} from "@/lib/gridfinity/finger-access-rounding";
import { withKernel } from "@/lib/manifold/runtime";

import { CadContext, type CadShape } from "./adapter";
import { clipBelow } from "./construction";
import { buildCadFingerAccess } from "./finger-access";
import { loadCad, type OpenCascadeInstance } from "./runtime";

/**
 * Curved-bottom finger access too shallow for a vertical shaft, where the rim
 * rounding is part of the scoop's own profile. The print path's mesh for the
 * same hole is the independent reference.
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await loadCad();
}, 60_000);

const FILL_Z = 30;
const hole = (input: Record<string, unknown>): FingerHole =>
  fingerHoleSchema.parse({ id: "access", center: { x: 0, y: 0 }, topFilletMm: 1, ...input });

/** Volume of the print path's cutter for `access`, finely sampled, up to 1 mm above the surface. */
function printedVolume(access: FingerHole): Promise<number> {
  return withKernel((kernel) =>
    buildRoundedFingerAccessCutter(kernel, access, FILL_Z, FILL_Z + 1, {
      radiusMm: access.topFilletMm,
      profileStepMm: 0.01,
      circularSegments: 512,
    }).volume(),
  );
}

function withCutter<T>(access: FingerHole, work: (c: CadContext, cutter: CadShape) => T): T {
  const c = new CadContext(oc);
  try {
    // The bin top equals the fill surface here, so the cutter stops 1 mm above it like the reference.
    return work(c, buildCadFingerAccess(c, access, FILL_Z, FILL_Z).cutter);
  } finally {
    c.dispose();
  }
}

/** Distance from a point to the surface of `solid`. */
function distance(c: CadContext, solid: CadShape, x: number, y: number, z: number): number {
  const vertex = c.own(c.own(new c.oc.BRepBuilderAPI_MakeVertex(c.point(x, y, z))).Vertex());
  return Math.min(
    ...c.subshapes(solid, "shell").map((shell) => c.own(new c.oc.BRepExtrema_DistShapeShape(vertex, shell)).Value()),
  );
}

describe("shallow curved finger access with a rounded rim", () => {
  it("revolves the print path's profile for a round scoop", () => {
    const access = hole({ kind: "deep-scoop", diameterMm: 30, depthMm: 6 });
    const rim = fingerAccessRimGeometry(access, 1);
    expect(rim.verticalJoin).toBe(false);
    withCutter(access, (c, cutter) => {
      expect(c.valid(cutter)).toBe(true);
      // Exact volume of the solid of revolution below the surface, from the print path's own width rule.
      const steps = 60_000;
      let expected = 0;
      for (let step = 0; step < steps; step++) {
        const z = (-rim.depth * (step + 0.5)) / steps;
        expected += (Math.PI * fingerAccessHalfWidthAtZ(access, rim, z) ** 2 * rim.depth) / steps;
      }
      expect(c.volume(clipBelow(c, cutter, FILL_Z, "below the surface"))).toBeCloseTo(expected, 2);
      // The rim meets the surface where the print path says, and passes through the tangent point.
      expect(distance(c, cutter, rim.openingHalfWidth, 0, FILL_Z)).toBeLessThan(1e-6);
      expect(distance(c, cutter, rim.tangentHalfWidth, 0, FILL_Z + rim.tangentZ)).toBeLessThan(1e-6);
      expect(distance(c, cutter, 0, 0, FILL_Z - rim.depth)).toBeLessThan(1e-6);
      expect(c.maxNativeToleranceMm).toBeLessThanOrEqual(0.00001);
    });
  }, 60_000);

  it.each([
    ["a slot with rounded ends", { kind: "oblong-deep-scoop", diameterMm: 24, depthMm: 8.777, lengthMm: 52 }],
    ["a long, wide slot", { kind: "oblong-deep-scoop", diameterMm: 32.4, depthMm: 8.777, lengthMm: 116.8, rotationDeg: 270.4 }],
    ["a slot whose scoop center is just below the surface", { kind: "oblong-deep-scoop", diameterMm: 22.4, depthMm: 12, lengthMm: 50 }],
    ["a round scoop", { kind: "scoop", diameterMm: 26, depthMm: 5 }],
  ])("matches the printed cutter for %s", async (_label, input) => {
    const access = hole(input);
    const printed = await printedVolume(access);
    withCutter(access, (c, cutter) => {
      expect(c.valid(cutter)).toBe(true);
      const built = c.volume(cutter);
      // The mesh is inscribed in the smooth surface, so it is very slightly smaller.
      expect(built).toBeGreaterThan(printed);
      expect((built - printed) / printed).toBeLessThan(0.002);
      expect(c.maxNativeToleranceMm).toBeLessThanOrEqual(0.00001);
    });
  }, 120_000);

  it("stops a flat-ended scoop with end walls whose top edge is rounded over", async () => {
    const access = hole({ kind: "flat-ended-scoop", diameterMm: 23, depthMm: 9, lengthMm: 34, cornerRoundMm: 0 });
    const rim = fingerAccessRimGeometry(access, 1);
    const printed = await printedVolume(access);
    withCutter(access, (c, cutter) => {
      expect(c.valid(cutter)).toBe(true);
      const built = c.volume(cutter);
      // The two differ only in how the four plan corners blend just under the rim (see finger-access.ts).
      expect(Math.abs(built - printed) / printed).toBeLessThan(0.002);
      // Mid-length, the side follows the scoop profile.
      expect(distance(c, cutter, 0, rim.tangentHalfWidth, FILL_Z + rim.tangentZ)).toBeLessThan(1e-6);
      // The end wall is vertical below the rim and rounded over above it.
      expect(distance(c, cutter, 17, 0, FILL_Z - 4)).toBeLessThan(1e-6);
      expect(distance(c, cutter, 17 + 1 - Math.SQRT1_2, 0, FILL_Z - 1 + Math.SQRT1_2)).toBeLessThan(1e-6);
    });
  }, 120_000);

  it.each([
    ["a deep round scoop", { kind: "deep-scoop", diameterMm: 22, depthMm: 19 }],
    ["a deep slot with rounded ends", { kind: "oblong-deep-scoop", diameterMm: 32, depthMm: 18.5, lengthMm: 118 }],
    ["a deep flat-ended scoop", { kind: "flat-ended-scoop", diameterMm: 20, depthMm: 16, lengthMm: 40, cornerRoundMm: 0 }],
  ])("rounds the mouth of %s over as the print path does", async (_label, input) => {
    // Deep enough for a vertical shaft: the rim is an ordinary rounded-over mouth.
    const access = hole(input);
    expect(fingerAccessRimGeometry(access, 1).verticalJoin).toBe(true);
    const printed = await printedVolume(access);
    withCutter(access, (c, cutter) => {
      expect(c.valid(cutter)).toBe(true);
      // A cove in place of the round-over would add several percent here.
      expect(Math.abs(c.volume(cutter) - printed) / printed).toBeLessThan(0.002);
      expect(c.maxNativeToleranceMm).toBeLessThanOrEqual(0.00001);
    });
  }, 120_000);

  it("still declines a shallow flat-ended scoop with rounded plan corners", () => {
    const access = hole({ kind: "flat-ended-scoop", diameterMm: 23, depthMm: 9, lengthMm: 34, cornerRoundMm: 3 });
    const c = new CadContext(oc);
    try {
      expect(() => buildCadFingerAccess(c, access, FILL_Z, FILL_Z)).toThrow(/rounded plan corners are not supported/);
    } finally {
      c.dispose();
    }
  });
});
