import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { parseBinSpec } from "@shared/gridfinity/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { buildBase } from "./base";
import { buildBin } from "./bin";
import { buildLiteBase, LITE_BOTTOM_THICKNESS_MM } from "./lite-base";

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

const SEGMENTS = 32;

describe("buildLiteBase", () => {
  it("is one sound, welded solid with no handles", () => {
    const lite = buildLiteBase(kernel, { gridX: 2, gridY: 2 }, SEGMENTS);
    expect(lite.status()).toBe("NoError");
    // The abutting-union trap: shells meeting the lattice must weld into a
    // single component (the 0.2 mm spur does this), and every cavity must
    // stay open through its window — no voids, no handles.
    expect(lite.decompose()).toHaveLength(1);
    expect(lite.genus()).toBe(0);
  });

  it("keeps the solid base's exact outer envelope", () => {
    const lite = buildLiteBase(kernel, { gridX: 2, gridY: 3 }, SEGMENTS);
    const solid = buildBase(kernel, { gridX: 2, gridY: 3 }, SEGMENTS);
    const a = lite.boundingBox();
    const b = solid.boundingBox();
    for (const axis of [0, 1, 2] as const) {
      expect(a.min[axis]).toBeCloseTo(b.min[axis], 7);
      expect(a.max[axis]).toBeCloseTo(b.max[axis], 7);
    }
  });

  it("keeps the fractional solid-base envelope", () => {
    for (const grid of [
      { gridX: 2, gridY: 2, gridPitch: "half" as const },
      { gridX: 4, gridY: 2, gridPitch: "quarter" as const },
    ]) {
      const lite = buildLiteBase(kernel, grid, SEGMENTS);
      const solid = buildBase(kernel, grid, SEGMENTS);
      expect(lite.status()).toBe("NoError");
      expect(lite.decompose()).toHaveLength(1);
      const a = lite.boundingBox();
      const b = solid.boundingBox();
      for (const axis of [0, 1, 2] as const) {
        expect(a.min[axis]).toBeCloseTo(b.min[axis], 7);
        expect(a.max[axis]).toBeCloseTo(b.max[axis], 7);
      }
    }
  });

  it("saves most of the base material", () => {
    const lite = buildLiteBase(kernel, { gridX: 2, gridY: 2 }, SEGMENTS).volume();
    const solid = buildBase(kernel, { gridX: 2, gridY: 2 }, SEGMENTS).volume();
    expect(lite).toBeLessThan(0.55 * solid);
    expect(lite).toBeGreaterThan(0.15 * solid);
  });

  it("matches the solid base inside the floor, is hollow above it", () => {
    const lite = buildLiteBase(kernel, { gridX: 1, gridY: 1 }, SEGMENTS);
    const solid = buildBase(kernel, { gridX: 1, gridY: 1 }, SEGMENTS);

    // Inside the 1.2 mm floor both are the full socket cross-section.
    const floorZ = LITE_BOTTOM_THICKNESS_MM / 2;
    const liteFloor = arena.track(lite.slice(floorZ)).area();
    const solidFloor = arena.track(solid.slice(floorZ)).area();
    expect(Math.abs(liteFloor - solidFloor) / solidFloor).toBeLessThan(1e-6);

    // Above the floor the lite base is just the shell band.
    const liteMid = arena.track(lite.slice(3)).area();
    const solidMid = arena.track(solid.slice(3)).area();
    expect(liteMid).toBeLessThan(0.4 * solidMid);
    expect(liteMid).toBeGreaterThan(0);
  });

  it("builds into a sound bin, hollow under the bridge lattice", () => {
    const spec = parseBinSpec({
      gridX: 2,
      gridY: 2,
      heightUnits: 6,
      fill: "none",
      liteBase: true,
    });
    const bin = buildBin(kernel, spec, { circularSegments: SEGMENTS });
    expect(bin.solid.status()).toBe("NoError");
    expect(bin.solid.decompose()).toHaveLength(1);

    const solidSpec = parseBinSpec({
      gridX: 2,
      gridY: 2,
      heightUnits: 6,
      fill: "none",
      liteBase: false,
    });
    const solidBin = buildBin(kernel, solidSpec, { circularSegments: SEGMENTS });
    expect(bin.solid.volume()).toBeLessThan(solidBin.solid.volume());
    // Outer envelope identical: lite changes only the inside of the base.
    const a = bin.solid.boundingBox();
    const b = solidBin.solid.boundingBox();
    for (const axis of [0, 1, 2] as const) {
      expect(a.min[axis]).toBeCloseTo(b.min[axis], 7);
      expect(a.max[axis]).toBeCloseTo(b.max[axis], 7);
    }
  });

  it("ignores holes rather than cutting into the thin shell", () => {
    const spec = parseBinSpec({
      gridX: 1,
      gridY: 1,
      heightUnits: 3,
      fill: "none",
      liteBase: true,
      magnetHoles: true,
    });
    const withHoles = buildBin(kernel, spec, { circularSegments: SEGMENTS });
    const withoutHoles = buildBin(
      kernel,
      parseBinSpec({ ...spec, magnetHoles: false }),
      { circularSegments: SEGMENTS },
    );
    expect(withHoles.solid.volume()).toBeCloseTo(withoutHoles.solid.volume(), 6);
  });

  it("floor sits below the base height", () => {
    expect(LITE_BOTTOM_THICKNESS_MM).toBeLessThan(BASE_HEIGHT);
  });
});
