import { R_F2 } from "@shared/gridfinity/standard";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { bottomFilletCutter, topEdgeFilletCutter } from "./fillet-stack";

/**
 * Risk #1 from the plan: bottom-fillet cost on high-vertex outlines,
 * prototyped against a synthetic 200-vertex ring *before any UI exists*. The
 * assertions are correctness invariants plus a very generous wall-clock bound
 * (CI machines vary); the measured numbers are logged for the record.
 */

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

/** A blobby traced-tool-like ring: 200 vertices, concave bays, no symmetry. */
function syntheticRing(vertices: number): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < vertices; i++) {
    const theta = (i / vertices) * 2 * Math.PI;
    const radius = 40 + 6 * Math.sin(5 * theta) + 3 * Math.sin(11 * theta + 1);
    points.push([radius * Math.cos(theta), radius * Math.sin(theta)]);
  }
  return points;
}

describe("bottomFilletCutter", () => {
  it("builds a watertight stepped-fillet cutter for a 200-vertex ring in reasonable time", () => {
    const ring = syntheticRing(200);
    const section = arena.track(new kernel.CrossSection([ring]));
    const area = section.area();
    const depth = 15;

    const buildStart = performance.now();
    const cutter = bottomFilletCutter(kernel, section, depth, {
      radiusMm: R_F2, // 2.8 → 14 slices at 0.2
      profileStepMm: 0.1,
      circularSegments: 32,
    });
    const buildMs = performance.now() - buildStart;

    expect(cutter.status()).toBe("NoError");
    expect(cutter.genus()).toBe(0);
    expect(cutter.decompose()).toHaveLength(1);

    // Volume brackets: smaller than the plain extrusion (the fillet removes
    // cutter material), larger than chopping the whole fillet zone off.
    expect(cutter.volume()).toBeLessThan(area * depth);
    expect(cutter.volume()).toBeGreaterThan(area * (depth - R_F2));

    // Subtract from a stock slab, as the G3 cutout builder will.
    const { Manifold } = kernel;
    const slab = arena.track(
      arena.track(Manifold.cube([120, 120, 20], true)).translate([0, 0, 10]),
    );
    const positioned = arena.track(cutter.translate([0, 0, 5]));
    const subtractStart = performance.now();
    const pocketed = arena.track(slab.subtract(positioned));
    const subtractMs = performance.now() - subtractStart;

    expect(pocketed.status()).toBe("NoError");
    expect(pocketed.genus()).toBe(0);
    expect(pocketed.volume()).toBeCloseTo(slab.volume() - cutter.volume(), 0);

    // eslint-disable-next-line no-console -- benchmark record for the plan's risk #1
    console.log(
      `[fillet-stack] 200-vertex ring: build ${buildMs.toFixed(1)} ms, ` +
        `subtract ${subtractMs.toFixed(1)} ms, ${cutter.getMesh().triVerts.length / 3} tris`,
    );
    // Generous ceiling: the plan flagged O(N) exact fillets as catastrophic;
    // the stack must stay interactive-ish even on slow CI.
    expect(buildMs + subtractMs).toBeLessThan(30_000);
  });

  it("collapsing slices drop out instead of failing (narrow feature)", () => {
    // A 3 mm-wide bar: the deepest insets (up to 2.8) collapse it entirely.
    const bar: [number, number][] = [
      [-20, -1.5],
      [20, -1.5],
      [20, 1.5],
      [-20, 1.5],
    ];
    const section = arena.track(new kernel.CrossSection([bar]));
    const cutter = bottomFilletCutter(kernel, section, 10, {
      radiusMm: 2.8,
      profileStepMm: 0.1,
      circularSegments: 32,
    });
    expect(cutter.status()).toBe("NoError");
    // The floor slices vanished, so the cutter hovers above z = 0.
    expect(cutter.boundingBox().min[2]).toBeGreaterThan(0);
  });

  it("radius zero degrades to a plain extrusion", () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const section = arena.track(new kernel.CrossSection([square]));
    const cutter = bottomFilletCutter(kernel, section, 5, {
      radiusMm: 0,
      profileStepMm: 0.1,
      circularSegments: 32,
    });
    expect(cutter.volume()).toBeCloseTo(500, 6);
  });

  it("uses the same bottom stack for a slider-round-tripped default", () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const section = arena.track(new kernel.CrossSection([square]));
    const exact = bottomFilletCutter(kernel, section, 8, {
      radiusMm: 2.8,
      profileStepMm: 0.1,
      circularSegments: 32,
    });
    const sliderRoundTrip = bottomFilletCutter(kernel, section, 8, {
      radiusMm: 2.8000000000000003,
      profileStepMm: 0.1,
      circularSegments: 32,
    });

    expect(sliderRoundTrip.getMesh().triVerts.length).toBe(
      exact.getMesh().triVerts.length,
    );
    expect(sliderRoundTrip.volume()).toBeCloseTo(exact.volume(), 10);
  });

  it("welds every tested bottom radius into one connected cutter", () => {
    const square: [number, number][] = [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ];
    const section = arena.track(new kernel.CrossSection([square]));
    for (const radiusMm of [0.8, 2, 4]) {
      const cutter = bottomFilletCutter(kernel, section, 10, {
        radiusMm,
        profileStepMm: 0.1,
        circularSegments: 32,
      });
      expect(cutter.status()).toBe("NoError");
      expect(cutter.decompose()).toHaveLength(1);
    }
  });

  it("builds an outward top-edge flare that reaches the requested radius", () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const section = arena.track(new kernel.CrossSection([square]));
    const cutter = topEdgeFilletCutter(kernel, section, {
      radiusMm: 1,
      profileStepMm: 0.1,
      circularSegments: 32,
    });

    expect(cutter.status()).toBe("NoError");
    expect(cutter.boundingBox().min[0]).toBeCloseTo(-1, 5);
    expect(cutter.boundingBox().max[0]).toBeCloseTo(11, 5);
    expect(cutter.boundingBox().min[2]).toBeCloseTo(0, 8);
    expect(cutter.boundingBox().max[2]).toBeGreaterThanOrEqual(1);
    expect(cutter.boundingBox().max[2]).toBeLessThanOrEqual(1.1);

    for (const height of [0.25, 0.5, 0.75, 0.9]) {
      const polygons = cutter.slice(height).toPolygons();
      const actualOutset = -Math.min(
        ...polygons.flatMap((polygon) => polygon.map(([x]) => x)),
      );
      const smoothOutset = 1 - Math.sqrt(1 - height ** 2);
      expect(actualOutset).toBeGreaterThanOrEqual(smoothOutset - 1e-6);
      expect(actualOutset - smoothOutset).toBeLessThan(0.11);
    }
  });

  it("rejects impossible parameters", () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const section = arena.track(new kernel.CrossSection([square]));
    expect(() =>
      bottomFilletCutter(kernel, section, 2, {
        radiusMm: 2.8,
        profileStepMm: 0.1,
        circularSegments: 32,
      }),
    ).toThrow(/exceeds depth/);
    expect(() =>
      bottomFilletCutter(kernel, section, 0, {
        radiusMm: 0,
        profileStepMm: 0.1,
        circularSegments: 32,
      }),
    ).toThrow(/depth/);
  });
});
