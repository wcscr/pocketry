import {
  R_F2,
  TAB_DEPTH_MM,
  TAB_HEIGHT_MM,
  TAB_SUPPORT_HEIGHT_MM,
  TAB_WIDTH_NOMINAL_MM,
  binFootprintMm,
  D_WALL,
} from "@shared/gridfinity/standard";
import { parseBinSpec, type BinSpecInput } from "@shared/gridfinity/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { buildBin } from "./bin";

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

const QUALITY = { circularSegments: 32 };

/** Trapezoid between two vertical faces h and s, depth d apart. */
const PROFILE_AREA_MM2 =
  (TAB_DEPTH_MM * (TAB_HEIGHT_MM + TAB_SUPPORT_HEIGHT_MM)) / 2;

function spec(partial: Partial<BinSpecInput> = {}) {
  return parseBinSpec({
    gridX: 3,
    gridY: 3,
    heightUnits: 6,
    lip: "none",
    fill: "none",
    ...partial,
  });
}

function volume(partial: Partial<BinSpecInput>): number {
  return buildBin(kernel, spec(partial), QUALITY).solid.volume();
}

describe("buildLabelTab (via buildBin)", () => {
  it("attaches soundly to a selected re-entrant L-footprint edge", () => {
    const shaped = {
      gridX: 2,
      gridY: 2,
      footprint: {
        kind: "custom" as const,
        cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      },
    };
    const plain = buildBin(kernel, spec(shaped), QUALITY).solid;
    const tabbed = buildBin(kernel, spec({
      ...shaped,
      labelTab: {
        wall: "east",
        width: "center",
        edge: { cell: { x: 0, y: 1 }, side: "east" },
      },
    }), QUALITY).solid;
    expect(tabbed.status()).toBe("NoError");
    expect(tabbed.decompose()).toHaveLength(1);
    expect(tabbed.volume()).toBeGreaterThan(plain.volume());
  });

  it("a centred 42 mm tab adds exactly its prism volume", () => {
    // 3×3, lip none: the tab is clear of the rounded corners and of any lip
    // support, so the added volume is the closed-form profile × width.
    const delta =
      volume({ labelTab: { wall: "north", width: "center" } }) - volume({});
    const expected = PROFILE_AREA_MM2 * TAB_WIDTH_NOMINAL_MM;
    expect(Math.abs(delta - expected) / expected).toBeLessThan(1e-6);
  });

  it("keeps the solid sound and inside the bin's bounds", () => {
    const plain = buildBin(kernel, spec(), QUALITY).solid;
    const tabbed = buildBin(
      kernel,
      spec({ labelTab: { wall: "north", width: "full" } }),
      QUALITY,
    ).solid;
    expect(tabbed.status()).toBe("NoError");
    expect(tabbed.genus()).toBe(plain.genus());
    const a = plain.boundingBox();
    const b = tabbed.boundingBox();
    expect(b.min[0]).toBeCloseTo(a.min[0], 7);
    expect(b.max[1]).toBeCloseTo(a.max[1], 7);
    expect(b.max[2]).toBeCloseTo(a.max[2], 7);
  });

  it("a full-width tab is trimmed by the rounded interior corners", () => {
    const delta =
      volume({ labelTab: { wall: "north", width: "full" } }) - volume({});
    const chord = binFootprintMm(3) - 2 * D_WALL;
    expect(delta).toBeLessThan(PROFILE_AREA_MM2 * chord);
    expect(delta).toBeGreaterThan(PROFILE_AREA_MM2 * (chord - 2 * R_F2));
  });

  it("walls are symmetric on a square bin, left/right mirror-equal", () => {
    const north = volume({ labelTab: { wall: "north", width: "center" } });
    const east = volume({ labelTab: { wall: "east", width: "center" } });
    expect(north).toBeCloseTo(east, 6);

    const left = volume({ labelTab: { wall: "north", width: "left" } });
    const right = volume({ labelTab: { wall: "north", width: "right" } });
    expect(left).toBeCloseTo(right, 6);
  });

  it("the stacking lip absorbs part of the tab where they overlap", () => {
    const noLip =
      volume({ labelTab: { wall: "north", width: "center" } }) - volume({});
    const withLip =
      volume({ lip: "standard", labelTab: { wall: "north", width: "center" } }) -
      volume({ lip: "standard" });
    expect(withLip).toBeLessThan(noLip);
    expect(withLip).toBeGreaterThan(noLip * 0.8);
  });

  it("builds soundly on solid fill and on a bin shorter than the tab", () => {
    const solid = buildBin(
      kernel,
      spec({ fill: "solid", labelTab: { wall: "south", width: "full" } }),
      QUALITY,
    ).solid;
    expect(solid.status()).toBe("NoError");

    const stubby = buildBin(
      kernel,
      spec({ heightUnits: 2, labelTab: { wall: "north", width: "center" } }),
      QUALITY,
    ).solid;
    expect(stubby.status()).toBe("NoError");
  });
});
