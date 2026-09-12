import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveFingerHoleDepthMm, fingerHoleFootprintRing, fingerHoleSchema, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { signedArea } from "@shared/geometry/rings";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { buildFingerHoleCutters } from "./cutouts";
import { fingerAccessRimGeometry } from "./finger-access-rounding";

let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterAll(() => arena.dispose());
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid" });
const cases = [
  { kind: "straight", depthMm: 1 }, { kind: "straight", depthMm: 20 },
  { kind: "scoop", depthMm: 1 }, { kind: "scoop", depthMm: 5 }, { kind: "scoop", depthMm: 20 },
  { kind: "deep-scoop", depthMm: 1 }, { kind: "deep-scoop", depthMm: 12.5 }, { kind: "deep-scoop", depthMm: 20 },
  { kind: "oblong-deep-scoop", depthMm: 1 }, { kind: "oblong-deep-scoop", depthMm: 12.5 }, { kind: "oblong-deep-scoop", depthMm: 20 },
  { kind: "flat-ended-scoop", depthMm: 1 }, { kind: "flat-ended-scoop", depthMm: 5 }, { kind: "flat-ended-scoop", depthMm: 20 },
  { kind: "oblong-straight", depthMm: 1 }, { kind: "oblong-straight", depthMm: 20 },
  { kind: "flat-ended-straight", depthMm: 1 }, { kind: "flat-ended-straight", depthMm: 20 },
  { kind: "flat-ended-scoop", depthMm: 1, cornerRoundMm: 3 },
  { kind: "flat-ended-scoop", depthMm: 5, cornerRoundMm: 3 },
  { kind: "flat-ended-scoop", depthMm: 20, cornerRoundMm: 3 },
  { kind: "flat-ended-straight", depthMm: 1, cornerRoundMm: 3 },
  { kind: "flat-ended-straight", depthMm: 20, cornerRoundMm: 3 },
];

describe.each(cases)("$kind at requested depth $depthMm", (settings) => {
  const hole = fingerHoleSchema.parse({
    id: "rounding", center: { x: 3, y: -2 }, diameterMm: 24,
    lengthMm: 40, rotationDeg: 37, topFilletMm: 2, ...settings,
  });
  const depth = effectiveFingerHoleDepthMm(hole);
  const r = Math.min(hole.topFilletMm, depth / 2);
  const rim = fingerAccessRimGeometry(hole, r);
  it.each([24, 64])("matches entry slopes without step faces at %s segments", (circularSegments) => {
    const cutter = buildFingerHoleCutters(kernel, [hole], spec, {
      circularSegments, filletProfileStepMm: circularSegments === 24 ? 0.5 : 0.1,
    })[0];
    const topZ = resolvePocketDepth(spec, { mode: "mm", value: hole.depthMm }).infillTopZ;
    const local = arena.track(arena.track(cutter.translate([-3, 2, -topZ])).rotate([0, 0, -37]));
    expect(local.status()).toBe("NoError");
    expect(local.boundingBox().min[2]).toBeCloseTo(-depth, 5);
    const sectionAt = (z: number) => arena.track(local.slice(z));
    const widthAt = (z: number) => Math.max(...sectionAt(z).toPolygons().flatMap(ring => ring.map(p => p[1])));
    const epsilon = Math.min(0.0005, -rim.tangentZ / 4);
    const width = widthAt(rim.tangentZ);
    const before = Math.atan2(epsilon, width - widthAt(rim.tangentZ - epsilon));
    const after = Math.atan2(epsilon, widthAt(rim.tangentZ + epsilon) - width);
    expect(Math.abs(before - after)).toBeLessThan(0.09);
    const mesh = local.getMesh();
    let steps = 0;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const zs = [0, 1, 2].map(j => mesh.vertProperties[mesh.triVerts[i + j] * mesh.numProp + 2]);
      if (zs[0] > -r + 1e-5 && zs[0] < -1e-5 && Math.max(...zs) - Math.min(...zs) < 1e-7) steps++;
    }
    expect(steps).toBe(0);
    if (hole.kind === "oblong-deep-scoop" || hole.kind === "oblong-straight") {
      // The cap tip and long side share the same rounded profile.
      const ring = sectionAt(rim.tangentZ / 2).toPolygons().flat();
      const maxX = Math.max(...ring.map(p => p[0]));
      const maxY = Math.max(...ring.map(p => p[1]));
      expect(maxX - (40 - 24) / 2).toBeCloseTo(maxY, 5);
    }
  });
});

describe.each(["flat-ended-scoop", "flat-ended-straight"] as const)("corner-rounded %s", (kind) => {
  it.each([
    [24, 40, 1, 3], [24, 40, 20, 3], [80, 6, 1, 40], [6, 6, 20, 40],
  ])("preserves width %s, length %s and depth %s with requested radius %s", (diameterMm, lengthMm, depthMm, cornerRoundMm) => {
    const hole = fingerHoleSchema.parse({ id: "corners", kind, center: { x: 3, y: -2 },
      rotationDeg: 37, diameterMm, lengthMm, depthMm, cornerRoundMm });
    const top = resolvePocketDepth(spec, { mode: "mm", value: depthMm }).infillTopZ;
    for (const circularSegments of [24, 64]) {
      const quality = { circularSegments, filletProfileStepMm: 0.1 };
      const plain = buildFingerHoleCutters(kernel, [hole], spec, quality)[0];
      const local = arena.track(arena.track(plain.translate([-3, 2, -top])).rotate([0, 0, -37]));
      expect(local.status()).toBe("NoError");
      const bounds = local.boundingBox();
      expect(bounds.min[2]).toBeCloseTo(-depthMm, 6);
      expect(bounds.min[0]).toBeCloseTo(-lengthMm / 2, 6);
      expect(bounds.max[0]).toBeCloseTo(lengthMm / 2, 6);
      expect(bounds.min[1]).toBeCloseTo(-diameterMm / 2, 6);
      expect(bounds.max[1]).toBeCloseTo(diameterMm / 2, 6);
      const ring = fingerHoleFootprintRing(hole, { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false }, circularSegments);
      expect(arena.track(local.slice(0.01)).area()).toBeCloseTo(signedArea(ring), 5);
      const rounded = buildFingerHoleCutters(kernel, [{ ...hole, topFilletMm: 0.4 }], spec, quality)[0];
      expect(rounded.status()).toBe("NoError");
      expect(rounded.boundingBox().min[2]).toBeCloseTo(top - depthMm, 6);
      // Tangency changes the arc samples, but not the underlying bottom profile.
      for (const z of [top - depthMm * 0.9, top - depthMm * 0.5]) {
        const before = arena.track(plain.slice(z)).area();
        const after = arena.track(rounded.slice(z)).area();
        expect(Math.abs(after - before)).toBeLessThan(before * 0.001);
      }
    }
  });

  it("keeps a flat end between rounded corners, without cutting beyond the ends", () => {
    const hole = fingerHoleSchema.parse({ id: "end", kind, center: { x: 0, y: 0 },
      diameterMm: 16, lengthMm: 40, depthMm: 20, cornerRoundMm: 3 });
    const cutter = buildFingerHoleCutters(kernel, [hole], spec, { circularSegments: 64 })[0];
    const top = resolvePocketDepth(spec, { mode: "mm", value: 20 }).infillTopZ;
    const ring = arena.track(cutter.slice(top - 1)).toPolygons().flat();
    const end = ring.filter(p => Math.abs(p[0] - 20) < 1e-6);
    expect(Math.max(...end.map(p => p[1]))).toBeCloseTo(5, 6);
    expect(Math.min(...end.map(p => p[1]))).toBeCloseTo(-5, 6);
    expect(Math.max(...ring.map(p => p[0]))).toBeCloseTo(20, 6);
  });
});

it.each([
  { kind: "straight" }, { kind: "oblong-straight" }, { kind: "flat-ended-straight" },
  { kind: "flat-ended-straight", cornerRoundMm: 3 },
])("preserves the $kind bottom fillet below the top rounding, corner radius $cornerRoundMm", (settings) => {
  const hole = fingerHoleSchema.parse({
    id: "straight", ...settings, center: { x: 0, y: 0 },
    diameterMm: 24, depthMm: 20, bottomFilletMm: 3,
  });
  const quality = { circularSegments: 64, filletProfileStepMm: 0.1 };
  const plain = buildFingerHoleCutters(kernel, [hole], spec, quality)[0];
  const rounded = buildFingerHoleCutters(kernel, [{ ...hole, topFilletMm: 2 }], spec, quality)[0];
  const top = resolvePocketDepth(spec, { mode: "mm", value: 20 }).infillTopZ;
  for (const distance of [19.5, 18, 17, 10, 3]) {
    const a = arena.track(plain.slice(top - distance));
    const b = arena.track(rounded.slice(top - distance));
    expect(b.area()).toBeCloseTo(a.area(), 5);
  }
});
