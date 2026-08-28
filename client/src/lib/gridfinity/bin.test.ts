import {
  BASE_HEIGHT,
  STACKING_LIP_HEIGHT_ACTUAL,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
} from "@shared/gridfinity/standard";
import { parseBinSpec } from "@shared/gridfinity/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { baseCellSolid } from "./base";
import {
  binDimensionsMm,
  buildBin,
  buildBinParts,
  EXPORT_QUALITY,
  infillHeightMm,
  PREVIEW_QUALITY,
} from "./bin";
import {
  polygonArea,
  polygonCentroid,
  roundedRectPolygonArea,
  stackingLipProfilePolygon,
} from "./profiles";
import { sweptVolumeClosedForm } from "./sweep";
import { buildStackingLip, buildWallRing } from "./wall";

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
const QUALITY = { circularSegments: SEGMENTS };

describe("build quality", () => {
  it("keeps the interactive preview coarse without reducing export quality", () => {
    expect(PREVIEW_QUALITY.circularSegments).toBeLessThan(
      EXPORT_QUALITY.circularSegments,
    );
    expect(PREVIEW_QUALITY.cutoutVertexBudget).toBeLessThan(
      EXPORT_QUALITY.cutoutVertexBudget!,
    );
    expect(PREVIEW_QUALITY.filletProfileStepMm).toBeGreaterThan(
      EXPORT_QUALITY.filletProfileStepMm!,
    );
    expect(EXPORT_QUALITY.filletProfileStepMm).toBe(0.1);
  });
});

function spec(partial: Record<string, unknown> = {}) {
  // fill pinned: these are the *empty-bin* invariants, and the schema default
  // is now "solid" (the pocket workflow).
  return parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", ...partial });
}

/** Annulus area of the plain wall at the given footprint. */
function wallRingAreaMm2(widthMm: number, lengthMm: number): number {
  return (
    roundedRectPolygonArea(widthMm, lengthMm, 3.75, SEGMENTS) -
    roundedRectPolygonArea(widthMm - 1.9, lengthMm - 1.9, 3.75, SEGMENTS)
  );
}

describe("buildWallRing", () => {
  it("volume is exactly annulus area × wall height", () => {
    const ring = buildWallRing(kernel, spec(), SEGMENTS)!;
    expect(ring).not.toBeNull();
    expect(ring.status()).toBe("NoError");

    const expected = wallRingAreaMm2(83.5, 125.5) * 35;
    expect(Math.abs(ring.volume() - expected) / expected).toBeLessThan(1e-6);

    const box = ring.boundingBox();
    expect(box.min[2]).toBeCloseTo(BASE_HEIGHT, 9);
    expect(box.max[2]).toBeCloseTo(42, 9);
    expect(box.max[0]).toBeCloseTo(41.75, 9);
    expect(box.max[1]).toBeCloseTo(62.75, 9);
  });

  it("is null for a 1u bin (zero wall height)", () => {
    expect(buildWallRing(kernel, spec({ heightUnits: 1 }), SEGMENTS)).toBeNull();
  });
});

describe("buildStackingLip", () => {
  it("volume matches the sweep closed form (prisms + faceted Pappus)", () => {
    const lip = buildStackingLip(kernel, spec(), SEGMENTS);
    expect(lip.status()).toBe("NoError");

    const profile = stackingLipProfilePolygon({
      wallHeightMm: 35,
      circularSegments: SEGMENTS,
    });
    const expected = sweptVolumeClosedForm(
      polygonArea(profile),
      polygonCentroid(profile)[0],
      { widthMm: 83.5 - 7.5, lengthMm: 125.5 - 7.5 },
      SEGMENTS,
    );
    expect(Math.abs(lip.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("sits at the rim: support bottom to filleted summit, flush with the wall", () => {
    const lip = buildStackingLip(kernel, spec(), SEGMENTS);
    const box = lip.boundingBox();
    // 7 digits: sweep-piece welding nudges single vertices by a few 1e-9.
    expect(box.min[2]).toBeCloseTo(42 - STACKING_LIP_SUPPORT_HEIGHT_MM, 7); // 38.2
    expect(box.max[2]).toBeCloseTo(42 + STACKING_LIP_HEIGHT_ACTUAL, 7); // 45.5515
    expect(box.max[0]).toBeCloseTo(41.75, 9);
    expect(box.min[0]).toBeCloseTo(-41.75, 9);
    expect(box.max[1]).toBeCloseTo(62.75, 9);
  });
});

describe("buildBin", () => {
  it("builds a connected, watertight three-cell L bin with a stacking lip", () => {
    const { solid, parts } = buildBin(
      kernel,
      spec({
        gridX: 2,
        gridY: 2,
        lip: "standard",
        footprint: {
          kind: "custom",
          cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        },
      }),
      { circularSegments: SEGMENTS, filletProfileStepMm: 0.25 },
    );
    expect(parts.lip?.status()).toBe("NoError");
    expect(solid.status()).toBe("NoError");
    expect(solid.decompose()).toHaveLength(1);
    const box = solid.boundingBox();
    expect(box.max[0] - box.min[0]).toBeCloseTo(83.5, 6);
    expect(box.max[1] - box.min[1]).toBeCloseTo(83.5, 6);
  });

  it("supports the same L mask at full, half, and quarter pitch", () => {
    for (const gridPitch of ["full", "half", "quarter"] as const) {
      const { solid } = buildBin(
        kernel,
        spec({
          gridX: 2,
          gridY: 2,
          gridPitch,
          lip: "none",
          footprint: {
            kind: "custom",
            cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
          },
        }),
        QUALITY,
      );
      expect(solid.status()).toBe("NoError");
      expect(solid.decompose()).toHaveLength(1);
    }
  });

  it("no-lip empty bin: volume is exactly base + wall (disjoint parts)", () => {
    const { parts, solid } = buildBin(kernel, spec({ lip: "none" }), QUALITY);
    expect(parts.lip).toBeNull();
    expect(parts.infill).toBeNull();
    expect(solid.genus()).toBe(0);

    const expected = parts.base.volume() + parts.wall!.volume();
    expect(Math.abs(solid.volume() - expected) / expected).toBeLessThan(1e-6);

    const box = solid.boundingBox();
    expect(box.min[2]).toBeCloseTo(0, 9);
    expect(box.max[2]).toBeCloseTo(42, 9);
  });

  it("builds a watertight quarter-pitch bin at the equivalent physical span", () => {
    const { solid } = buildBin(
      kernel,
      spec({ gridX: 4, gridY: 2, gridPitch: "quarter", lip: "none" }),
      QUALITY,
    );
    expect(solid.status()).toBe("NoError");
    expect(solid.genus()).toBe(0);
    const box = solid.boundingBox();
    expect(box.max[0] - box.min[0]).toBeCloseTo(41.5, 9);
    expect(box.max[1] - box.min[1]).toBeCloseTo(20.5, 9);
    expect(box.max[2]).toBeCloseTo(42, 9);
  });

  it("2×3×6 empty bin with lip: exact bbox and inclusion–exclusion volume", () => {
    const { parts, solid } = buildBin(kernel, spec(), QUALITY);
    expect(solid.status()).toBe("NoError");
    expect(solid.genus()).toBe(0);

    const box = solid.boundingBox();
    // The plan's milestone numbers: 83.5 × 125.5, grounded at z = 0, rim at
    // 42, filleted lip summit 3.5515 above it.
    expect(box.min[0]).toBeCloseTo(-41.75, 9);
    expect(box.max[0]).toBeCloseTo(41.75, 9);
    expect(box.min[1]).toBeCloseTo(-62.75, 9);
    expect(box.max[1]).toBeCloseTo(62.75, 9);
    expect(box.min[2]).toBeCloseTo(0, 9);
    // 7 digits: the summit is a single vertex, nudged ~3e-9 by boolean welding.
    expect(box.max[2]).toBeCloseTo(42 + STACKING_LIP_HEIGHT_ACTUAL, 7);

    // The lip only overlaps the wall band (its bbox floor is 38.2 ≫ base 7),
    // so union = base + wall + lip − lip∩wall must hold to CSG precision.
    const overlap = arena.track(parts.lip!.intersect(parts.wall!));
    expect(overlap.volume()).toBeGreaterThan(0);
    const expected =
      parts.base.volume() + parts.wall!.volume() + parts.lip!.volume() - overlap.volume();
    expect(Math.abs(solid.volume() - expected) / expected).toBeLessThan(1e-6);
  });

  it("solid-fill bin: empty bin + infill − their intersection", () => {
    const empty = buildBin(kernel, spec(), QUALITY);
    const filled = buildBin(kernel, spec({ fill: "solid" }), QUALITY);

    expect(filled.parts.infill).not.toBeNull();
    // Infill: full footprint, from the base top to 1.2 below the rim.
    expect(infillHeightMm(spec({ fill: "solid" }))).toBeCloseTo(33.8, 9);
    const infillVolume =
      roundedRectPolygonArea(83.5, 125.5, 3.75, SEGMENTS) * 33.8;
    expect(
      Math.abs(filled.parts.infill!.volume() - infillVolume) / infillVolume,
    ).toBeLessThan(1e-6);

    const overlap = arena.track(filled.parts.infill!.intersect(empty.solid));
    const expected = empty.solid.volume() + filled.parts.infill!.volume() - overlap.volume();
    expect(Math.abs(filled.solid.volume() - expected) / expected).toBeLessThan(1e-6);
    expect(filled.solid.genus()).toBe(0);
  });

  it("1u bin: no wall, clamped lip, still watertight", () => {
    const { parts, solid } = buildBin(kernel, spec({ heightUnits: 1 }), QUALITY);
    expect(parts.wall).toBeNull();
    expect(solid.status()).toBe("NoError");
    expect(solid.genus()).toBe(0);
    const box = solid.boundingBox();
    expect(box.max[2]).toBeCloseTo(7 + STACKING_LIP_HEIGHT_ACTUAL, 7);
  });

  it("solid fill with no room degrades to null infill", () => {
    const built = buildBinParts(kernel, spec({ heightUnits: 1, fill: "solid" }), QUALITY);
    expect(built.infill).toBeNull();
  });

  it("reports dimensions without building", () => {
    const dims = binDimensionsMm(spec());
    expect(dims.widthMm).toBeCloseTo(83.5, 12);
    expect(dims.lengthMm).toBeCloseTo(125.5, 12);
    expect(dims.heightToRimMm).toBeCloseTo(42, 12);
    expect(dims.totalHeightMm).toBeCloseTo(42 + STACKING_LIP_HEIGHT_ACTUAL, 12);
  });
});

describe("stacking fit (software mating test)", () => {
  /**
   * The G1 print gate's software counterpart: an upper bin's base must drop
   * into a lower bin's lip with the spec's 0.35 mm uniform clearance. The
   * lower bin here is 1×1×2 with lip; the "upper bin" is a bare base cell
   * positioned at the lower bin's nominal rim (z = 14).
   */
  const MATING_SEGMENTS = 16;

  function lowerBin() {
    return buildBin(
      kernel,
      spec({ gridX: 1, gridY: 1, heightUnits: 2 }),
      { circularSegments: MATING_SEGMENTS },
    ).solid;
  }

  function upperBaseAt(dx: number, dz: number) {
    const cell = baseCellSolid(kernel, MATING_SEGMENTS);
    return arena.track(cell.translate([dx, 0, 14 + dz]));
  }

  it("rests without interference at the nominal position", () => {
    const overlap = arena.track(lowerBin().intersect(upperBaseAt(0, 0)));
    expect(overlap.volume()).toBeLessThan(1e-9);
  });

  it("keeps clearing when sunk less than the 0.35 mm clearance", () => {
    const overlap = arena.track(lowerBin().intersect(upperBaseAt(0, -0.25)));
    expect(overlap.volume()).toBeLessThan(1e-9);
  });

  it("collides when sunk past the clearance (0.5 mm)", () => {
    const overlap = arena.track(lowerBin().intersect(upperBaseAt(0, -0.5)));
    expect(overlap.volume()).toBeGreaterThan(1e-3);
  });

  it("keeps clearing under a small lateral shift (0.2 mm)", () => {
    const overlap = arena.track(lowerBin().intersect(upperBaseAt(0.2, 0)));
    expect(overlap.volume()).toBeLessThan(1e-9);
  });

  it("collides under a lateral shift past the clearance (0.5 mm)", () => {
    const overlap = arena.track(lowerBin().intersect(upperBaseAt(0.5, 0)));
    expect(overlap.volume()).toBeGreaterThan(1e-3);
  });
});
