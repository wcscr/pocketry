import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { buildRoundedFlatEndedScoopCutter, flatEndedScoopHalfWidthAtZ, flatEndedScoopRimGeometry } from "./flat-ended-scoop";

let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterAll(() => arena.dispose());

const cases = [
  { diameterMm: 30, depthMm: 1, topFilletMm: 0.5, lengthMm: 64 },
  { diameterMm: 30, depthMm: 5, topFilletMm: 1, lengthMm: 64 },
  { diameterMm: 30, depthMm: 14.75, topFilletMm: 5, lengthMm: 64 },
  { diameterMm: 30, depthMm: 15, topFilletMm: 1, lengthMm: 64 },
  { diameterMm: 30, depthMm: 15.25, topFilletMm: 1, lengthMm: 64 },
  { diameterMm: 30, depthMm: 16, topFilletMm: 1, lengthMm: 64 },
  { diameterMm: 30, depthMm: 20, topFilletMm: 1, lengthMm: 64 },
  { diameterMm: 6, depthMm: 120, topFilletMm: 5, lengthMm: 6 },
  { diameterMm: 80, depthMm: 1, topFilletMm: 0.5, lengthMm: 160 },
];

describe.each(cases)("tangent scoop rim $diameterMm wide, $depthMm deep, $topFilletMm round", (settings) => {
  const hole = fingerHoleSchema.parse({ id: "tangent", kind: "flat-ended-scoop", center: { x: 0, y: 0 }, ...settings });
  const rim = flatEndedScoopRimGeometry(hole, hole.topFilletMm);

  it("meets the cylinder at the same point and slope, and the top horizontally", () => {
    const y = rim.tangentHalfWidth;
    const z = rim.tangentZ;
    expect(flatEndedScoopHalfWidthAtZ(hole, rim, z)).toBeCloseTo(y, 8);
    if (!rim.verticalJoin) {
      expect(Math.hypot(y, z - rim.centerZ)).toBeCloseTo(rim.radius, 8);
      expect(Math.hypot(y - rim.openingHalfWidth, z + rim.rimRadius)).toBeCloseTo(rim.rimRadius, 8);
      const cylinderSlope = y / (rim.centerZ - z);
      const filletSlope = (rim.openingHalfWidth - y) / (z + rim.rimRadius);
      expect(Math.atan(filletSlope)).toBeCloseTo(Math.atan(cylinderSlope), 8);
    }
    const dz = Math.min(1e-6, -z / 10);
    expect(Math.abs(flatEndedScoopHalfWidthAtZ(hole, rim, -dz) - rim.openingHalfWidth)).toBeGreaterThan(0);
    expect(dz / (rim.openingHalfWidth - flatEndedScoopHalfWidthAtZ(hole, rim, -dz))).toBeLessThan(0.01);
  });

  it.each([24, 64])("emits a continuous tangent join at %s segments and preserves the flat ends", (circularSegments) => {
    const solid = buildRoundedFlatEndedScoopCutter(kernel, hole, 0, 2, {
      radiusMm: hole.topFilletMm, circularSegments, profileStepMm: circularSegments === 24 ? 0.5 : 0.1,
    });
    expect(solid.status()).toBe("NoError");
    const bounds = solid.boundingBox();
    expect(bounds.min[2]).toBeCloseTo(-hole.depthMm, 5);
    expect(bounds.max[0]).toBeCloseTo(hole.lengthMm! / 2 + hole.topFilletMm, 5);
    expect(bounds.max[1]).toBeCloseTo(rim.openingHalfWidth, 5);
    const halfWidthAt = (z: number) => {
      const section = arena.track(solid.slice(z));
      return Math.max(...section.toPolygons().flatMap(ring => ring.map(p => p[1])));
    };
    const epsilon = Math.min(0.0005, -rim.tangentZ / 4);
    const join = halfWidthAt(rim.tangentZ);
    const beforeSlope = Math.atan2(epsilon, join - halfWidthAt(rim.tangentZ - epsilon));
    const afterSlope = Math.atan2(epsilon, halfWidthAt(rim.tangentZ + epsilon) - join);
    // Preview facets may change by a few degrees; the old vertical flare changed by tens of degrees.
    expect(Math.abs(beforeSlope - afterSlope)).toBeLessThan(0.08);
    const endSection = arena.track(solid.slice(-hole.topFilletMm - 0.01));
    const maxX = Math.max(...endSection.toPolygons().flatMap(ring => ring.map(p => p[0])));
    expect(maxX).toBeCloseTo(hole.lengthMm! / 2, 5);
    const cornerSection = arena.track(solid.slice(-hole.topFilletMm / 2));
    const expectedEndX = hole.lengthMm! / 2 + hole.topFilletMm * (1 - Math.sqrt(0.75));
    const roundedEndX = Math.max(...cornerSection.toPolygons().flatMap(ring => ring.map(p => p[0])));
    expect(Math.abs(roundedEndX - expectedEndX)).toBeLessThan(0.01);
  });
});
