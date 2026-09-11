import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveFingerHoleDepthMm, fingerHoleSchema, resolvePocketDepth } from "@shared/gridfinity/cutout";
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
    if (hole.kind === "oblong-deep-scoop") {
      // The cap tip and long side share the same rounded profile.
      const ring = sectionAt(rim.tangentZ / 2).toPolygons().flat();
      const maxX = Math.max(...ring.map(p => p[0]));
      const maxY = Math.max(...ring.map(p => p[1]));
      expect(maxX - (40 - 24) / 2).toBeCloseTo(maxY, 5);
    }
  });
});

it("preserves the straight hole's bottom fillet below the top rounding", () => {
  const hole = fingerHoleSchema.parse({
    id: "straight", kind: "straight", center: { x: 0, y: 0 },
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
