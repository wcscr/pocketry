import {
  BASE_BOTTOM_RADIUS,
  BASE_BRIDGE_HEIGHT,
  BASE_HEIGHT,
  BASE_PROFILE_HEIGHT,
  baseBottomDimensionsMm,
} from "@shared/gridfinity/standard";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { baseCellSolid, buildBase } from "./base";
import { baseProfilePolygon, roundedRectPolygon, roundedRectPolygonArea } from "./profiles";
import { sweepRounded } from "./sweep";

let arena: Arena;
let kernel: Kernel;

beforeAll(async () => {
  const wasm = await loadManifold();
  arena = new Arena();
  kernel = createKernel(wasm, arena);
});

afterAll(() => {
  arena.dispose();
});

/** Radial corner radius of the base at height y — the swept profile's x. */
function baseRadiusAt(y: number): number {
  if (y <= 0.8) return BASE_BOTTOM_RADIUS + y;
  if (y <= 2.6) return 1.6;
  return 1.6 + (y - 2.6);
}

/** Cross-section area of the standard cell at height y (path is 34 mm). */
function cellAreaAt(y: number, segments: number): number {
  const radius = baseRadiusAt(y);
  const size = 34 + 2 * radius;
  return roundedRectPolygonArea(size, size, radius, segments);
}

/**
 * Closed-form volume of the discretised cell. The area is quadratic in y on
 * each profile segment (size and radius are linear), so Simpson's rule is
 * exact — this is an *independent* number, no manifold involved.
 */
function cellVolumeClosedForm(segments: number): number {
  const simpson = (f: (y: number) => number, a: number, b: number) =>
    ((b - a) / 6) * (f(a) + 4 * f((a + b) / 2) + f(b));
  return (
    simpson((y) => cellAreaAt(y, segments), 0, 0.8) +
    cellAreaAt(1.6, segments) * 1.8 +
    simpson((y) => cellAreaAt(y, segments), 2.6, BASE_PROFILE_HEIGHT)
  );
}

describe("baseCellSolid", () => {
  const segments = 32;

  it("is a watertight genus-0 solid with the exact spec bounding box", () => {
    const cell = baseCellSolid(kernel, segments);
    expect(cell.status()).toBe("NoError");
    expect(cell.genus()).toBe(0);

    const box = cell.boundingBox();
    // Top of the socket is 41.5 square; z runs 0 → 4.75.
    expect(box.min[0]).toBeCloseTo(-20.75, 9);
    expect(box.max[0]).toBeCloseTo(20.75, 9);
    expect(box.min[1]).toBeCloseTo(-20.75, 9);
    expect(box.max[1]).toBeCloseTo(20.75, 9);
    expect(box.min[2]).toBeCloseTo(0, 9);
    expect(box.max[2]).toBeCloseTo(BASE_PROFILE_HEIGHT, 9);
  });

  it("matches the Simpson closed-form volume to 1e-6", () => {
    const cell = baseCellSolid(kernel, segments);
    const expected = cellVolumeClosedForm(segments);
    expect(Math.abs(cell.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("matches an independent hull-stack construction (oracle #1)", () => {
    const { Manifold } = kernel;
    // The cell is a stack of convex rounded-rect frustums; hulls of
    // consecutive cross-sections rebuild it without touching sweep/revolve.
    const rings = [
      { z: 0, size: baseBottomDimensionsMm(), radius: 0.8 },
      { z: 0.8, size: 37.2, radius: 1.6 },
      { z: 2.6, size: 37.2, radius: 1.6 },
      { z: BASE_PROFILE_HEIGHT, size: 41.5, radius: 3.75 },
    ].map(({ z, size, radius }) => ({
      z,
      polygon: roundedRectPolygon(size, size, radius, segments),
    }));

    const slabs = [];
    for (let i = 0; i + 1 < rings.length; i++) {
      const points: [number, number, number][] = [
        ...rings[i].polygon.map(([x, y]): [number, number, number] => [x, y, rings[i].z]),
        ...rings[i + 1].polygon.map(([x, y]): [number, number, number] => [
          x,
          y,
          rings[i + 1].z,
        ]),
      ];
      slabs.push(arena.track(Manifold.hull(points)));
    }
    const oracle = arena.track(Manifold.union(slabs));

    const cell = baseCellSolid(kernel, segments);
    expect(Math.abs(cell.volume() - oracle.volume()) / oracle.volume()).toBeLessThan(1e-6);
  });

  it("matches minkowskiSum of path box ⊕ revolved profile (oracle #2)", () => {
    const { CrossSection, Manifold } = kernel;
    const oracleSegments = 16; // minkowski is convex-decomposition based: keep it small
    const pathMm = 12;

    // The construction under test, at oracle scale: gasket ∪ centre fill.
    const gasket = sweepRounded(
      kernel,
      baseProfilePolygon(),
      { widthMm: pathMm, lengthMm: pathMm },
      oracleSegments,
    );
    const fillMm = pathMm + BASE_BOTTOM_RADIUS; // path + r, oversize like the builder
    const fill = arena.track(
      arena
        .track(Manifold.cube([fillMm, fillMm, BASE_PROFILE_HEIGHT], true))
        .translate([0, 0, BASE_PROFILE_HEIGHT / 2]),
    );
    const cell = arena.track(Manifold.union([gasket, fill]));

    // Oracle: a solid box over the path rect, Minkowski-summed with the fully
    // revolved profile. Because the profile grows monotonically with z, the
    // slab z ∈ [0, 4.75] of the sum equals the swept cell exactly.
    const box = arena.track(
      arena.track(Manifold.cube([pathMm, pathMm, 6], true)).translate([0, 0, 3]),
    );
    const revolved = arena.track(
      arena.track(new CrossSection([baseProfilePolygon()])).revolve(oracleSegments, 360),
    );
    const minkowski = arena.track(box.minkowskiSum(revolved));
    const slab = arena.track(
      arena
        .track(Manifold.cube([100, 100, BASE_PROFILE_HEIGHT], true))
        .translate([0, 0, BASE_PROFILE_HEIGHT / 2]),
    );
    const oracle = arena.track(minkowski.intersect(slab));

    expect(Math.abs(cell.volume() - oracle.volume()) / oracle.volume()).toBeLessThan(1e-6);
  });

  it("builds watertight half- and quarter-pitch sockets with the constant gap", () => {
    for (const [pitch, topMm] of [
      ["half", 20.5],
      ["quarter", 10],
    ] as const) {
      const cell = baseCellSolid(kernel, segments, pitch);
      expect(cell.status()).toBe("NoError");
      expect(cell.genus()).toBe(0);
      const box = cell.boundingBox();
      expect(box.max[0] - box.min[0]).toBeCloseTo(topMm, 9);
      expect(box.max[1] - box.min[1]).toBeCloseTo(topMm, 9);
      expect(box.max[2]).toBeCloseTo(BASE_PROFILE_HEIGHT, 9);
    }
  });
});

describe("buildBase", () => {
  it("builds only the occupied sockets of a custom L footprint", () => {
    const rectangular = buildBase(kernel, { gridX: 2, gridY: 2 }, 32);
    const shaped = buildBase(kernel, {
      gridX: 2,
      gridY: 2,
      footprint: {
        kind: "custom",
        cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      },
    }, 32);
    expect(shaped.status()).toBe("NoError");
    expect(shaped.decompose()).toHaveLength(1);
    expect(shaped.volume()).toBeLessThan(rectangular.volume() * 0.8);
    expect(shaped.volume()).toBeGreaterThan(rectangular.volume() * 0.7);
  });

  const segments = 32;

  it("2×3 base: exact footprint, genus 0, volume = 6 cells + bridge", () => {
    const base = buildBase(kernel, { gridX: 2, gridY: 3 }, segments);
    expect(base.status()).toBe("NoError");
    expect(base.genus()).toBe(0);

    const box = base.boundingBox();
    expect(box.min[0]).toBeCloseTo(-41.75, 9);
    expect(box.max[0]).toBeCloseTo(41.75, 9);
    expect(box.min[1]).toBeCloseTo(-62.75, 9);
    expect(box.max[1]).toBeCloseTo(62.75, 9);
    expect(box.min[2]).toBeCloseTo(0, 9);
    expect(box.max[2]).toBeCloseTo(BASE_HEIGHT, 9);

    // Cells (z 0–4.75) and bridge (4.75–7) are disjoint, so volumes add.
    const expected =
      6 * cellVolumeClosedForm(segments) +
      roundedRectPolygonArea(83.5, 125.5, 3.75, segments) * BASE_BRIDGE_HEIGHT;
    expect(Math.abs(base.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("1×1 base: single cell plus its bridge", () => {
    const base = buildBase(kernel, { gridX: 1, gridY: 1 }, segments);
    const expected =
      cellVolumeClosedForm(segments) +
      roundedRectPolygonArea(41.5, 41.5, 3.75, segments) * BASE_BRIDGE_HEIGHT;
    expect(Math.abs(base.volume() - expected) / expected).toBeLessThan(1e-6);

    const box = base.boundingBox();
    expect(box.max[0]).toBeCloseTo(20.75, 9);
    expect(box.max[2]).toBeCloseTo(BASE_HEIGHT, 9);
  });

  it("half/quarter grids share the same 41.5 mm footprint at equivalent spans", () => {
    const half = buildBase(
      kernel,
      { gridX: 2, gridY: 2, gridPitch: "half" },
      segments,
    );
    const quarter = buildBase(
      kernel,
      { gridX: 4, gridY: 4, gridPitch: "quarter" },
      segments,
    );
    for (const base of [half, quarter]) {
      expect(base.status()).toBe("NoError");
      expect(base.genus()).toBe(0);
      const box = base.boundingBox();
      expect(box.max[0] - box.min[0]).toBeCloseTo(41.5, 9);
      expect(box.max[1] - box.min[1]).toBeCloseTo(41.5, 9);
      expect(box.max[2]).toBeCloseTo(BASE_HEIGHT, 9);
    }
  });

  it("rejects non-integer grids", () => {
    expect(() => buildBase(kernel, { gridX: 1.5, gridY: 1 }, segments)).toThrow();
    expect(() => buildBase(kernel, { gridX: 0, gridY: 1 }, segments)).toThrow();
  });
});
