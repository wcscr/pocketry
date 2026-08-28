import {
  BASE_HEIGHT,
  LAYER_HEIGHT,
  MAGNET_HOLE_CRUSH_RIB_COUNT,
  MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS,
  MAGNET_HOLE_DEPTH,
  MAGNET_HOLE_RADIUS,
  SCREW_HOLE_RADIUS,
} from "@shared/gridfinity/standard";
import { parseBinSpec } from "@shared/gridfinity/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { buildBase } from "./base";
import { buildBin } from "./bin";
import {
  baseHoleCutter,
  baseHoleCutters,
  holeOptionsFromSpec,
  NO_HOLES,
  ribbedCirclePolygon,
} from "./holes";

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

/** Area of manifold's polygonised circle: n chords inscribed in radius r. */
function circleArea(radius: number, segments: number): number {
  return (segments / 2) * radius ** 2 * Math.sin((2 * Math.PI) / segments);
}

describe("baseHoleCutter", () => {
  it("returns null when nothing is enabled", () => {
    expect(baseHoleCutter(kernel, NO_HOLES, SEGMENTS)).toBeNull();
  });

  it("plain magnet pocket is an exact cylinder", () => {
    const cutter = baseHoleCutter(
      kernel,
      { magnet: true, screw: false, supportless: false, chamfer: false },
      SEGMENTS,
    )!;
    const expected = circleArea(MAGNET_HOLE_RADIUS, SEGMENTS) * MAGNET_HOLE_DEPTH;
    expect(Math.abs(cutter.volume() - expected) / expected).toBeLessThan(1e-6);

    const box = cutter.boundingBox();
    expect(box.min[2]).toBeCloseTo(0, 9);
    expect(box.max[2]).toBeCloseTo(MAGNET_HOLE_DEPTH, 9);
  });

  it("supportless magnet+screw grows by the bridge layers and keeps the pocket clear", () => {
    const cutter = baseHoleCutter(
      kernel,
      { magnet: true, screw: true, supportless: true, chamfer: false },
      SEGMENTS,
    )!;
    expect(cutter.status()).toBe("NoError");

    const box = cutter.boundingBox();
    // Magnet ceiling starts at the nominal depth; screw continues to 7.
    expect(box.max[2]).toBeCloseTo(BASE_HEIGHT, 9);
    expect(box.max[0]).toBeCloseTo(MAGNET_HOLE_RADIUS, 6);

    // The full nominal pocket must be inside the cutter: intersecting with
    // the nominal cylinder leaves the cylinder unchanged.
    const { Manifold } = kernel;
    const nominal = arena.track(
      Manifold.cylinder(MAGNET_HOLE_DEPTH, MAGNET_HOLE_RADIUS, MAGNET_HOLE_RADIUS, SEGMENTS),
    );
    const kept = arena.track(cutter.intersect(nominal));
    expect(Math.abs(kept.volume() - nominal.volume()) / nominal.volume()).toBeLessThan(1e-9);
  });

  it("chamfer adds an entry ring at the bottom face", () => {
    const plain = baseHoleCutter(
      kernel,
      { magnet: true, screw: false, supportless: false, chamfer: false },
      SEGMENTS,
    )!;
    const chamfered = baseHoleCutter(
      kernel,
      { magnet: true, screw: false, supportless: false, chamfer: true },
      SEGMENTS,
    )!;
    expect(chamfered.volume()).toBeGreaterThan(plain.volume());
    expect(chamfered.boundingBox().max[0]).toBeCloseTo(MAGNET_HOLE_RADIUS + 0.8, 6);
  });
});

describe("buildBase with holes", () => {
  it("subtracts four blind magnet pockets per cell, keeping genus 0", () => {
    const plain = buildBase(kernel, { gridX: 1, gridY: 1 }, SEGMENTS);
    const holed = buildBase(kernel, { gridX: 1, gridY: 1 }, SEGMENTS, {
      magnet: true,
      screw: false,
      supportless: false,
      chamfer: false,
    });

    expect(holed.status()).toBe("NoError");
    expect(holed.genus()).toBe(0); // blind holes add no handles

    const pocket = circleArea(MAGNET_HOLE_RADIUS, SEGMENTS) * MAGNET_HOLE_DEPTH;
    const removed = plain.volume() - holed.volume();
    expect(Math.abs(removed - 4 * pocket) / (4 * pocket)).toBeLessThan(1e-6);
  });

  it("positions holes 26 mm apart on the spec grid", () => {
    const cutters = baseHoleCutters(
      kernel,
      { gridX: 1, gridY: 1 },
      { magnet: true, screw: false, supportless: false, chamfer: false },
      SEGMENTS,
    )!;
    const box = cutters.boundingBox();
    // Centres at ±13; extent = 13 + magnet radius.
    expect(box.max[0]).toBeCloseTo(13 + MAGNET_HOLE_RADIUS, 6);
    expect(box.min[1]).toBeCloseTo(-13 - MAGNET_HOLE_RADIUS, 6);
  });

  it("adds hole clusters only beneath occupied custom-footprint cells", () => {
    const options = {
      magnet: true,
      screw: false,
      supportless: false,
      chamfer: false,
    };
    const rectangular = baseHoleCutters(
      kernel,
      { gridX: 2, gridY: 2 },
      options,
      SEGMENTS,
    )!;
    const shaped = baseHoleCutters(
      kernel,
      {
        gridX: 2,
        gridY: 2,
        footprint: {
          kind: "custom",
          cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        },
      },
      options,
      SEGMENTS,
    )!;
    expect(shaped.status()).toBe("NoError");
    expect(shaped.volume() / rectangular.volume()).toBeCloseTo(0.75, 9);
  });

  it("screw holes pierce the base: genus 4 per cell on an open bin", () => {
    const spec = parseBinSpec({
      gridX: 1,
      gridY: 1,
      heightUnits: 3,
      screwHoles: true,
      fill: "none", // open bin: the pierce-through genus depends on it
    });
    const { solid } = buildBin(kernel, spec, { circularSegments: SEGMENTS });
    expect(solid.status()).toBe("NoError");
    // Four through-holes from the bed face into the cavity: four handles.
    expect(solid.genus()).toBe(4);
  });

  it("solid fill caps the screw holes back to genus 0", () => {
    const spec = parseBinSpec({
      gridX: 1,
      gridY: 1,
      heightUnits: 3,
      screwHoles: true,
      fill: "solid",
    });
    const { solid } = buildBin(kernel, spec, { circularSegments: SEGMENTS });
    expect(solid.genus()).toBe(0);
  });

  it("magnet holes on a full bin leave genus at 0 and shrink volume", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, magnetHoles: true, fill: "none" });
    const plainSpec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none" });
    const holed = buildBin(kernel, spec, { circularSegments: SEGMENTS });
    const plain = buildBin(kernel, plainSpec, { circularSegments: SEGMENTS });

    expect(holed.solid.genus()).toBe(0);
    expect(holed.solid.volume()).toBeLessThan(plain.solid.volume());
    // 16 supportless pockets: at least the nominal pocket volume each.
    const nominal = circleArea(MAGNET_HOLE_RADIUS, SEGMENTS) * MAGNET_HOLE_DEPTH;
    expect(plain.solid.volume() - holed.solid.volume()).toBeGreaterThan(16 * nominal);
  });
});

describe("holeOptionsFromSpec", () => {
  it("enables supportless ceilings whenever any hole is on", () => {
    expect(
      holeOptionsFromSpec({ magnetHoles: true, screwHoles: false }).supportless,
    ).toBe(true);
    expect(
      holeOptionsFromSpec({ magnetHoles: false, screwHoles: false }).supportless,
    ).toBe(false);
  });
});

describe("crush ribs (G5)", () => {
  it("the ribbed polygon oscillates between waist and bore, closed form area", () => {
    const polygon = ribbedCirclePolygon(
      MAGNET_HOLE_RADIUS,
      MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS,
      MAGNET_HOLE_CRUSH_RIB_COUNT,
      SEGMENTS,
    );
    const radii = polygon.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...radii)).toBeCloseTo(MAGNET_HOLE_RADIUS, 9);
    expect(Math.min(...radii)).toBeCloseTo(MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS, 9);
    // Continuous closed form: A = π(a² + b²/2) for r = a + b·sin(kθ).
    const a =
      (MAGNET_HOLE_RADIUS + MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS) / 2;
    const b = (MAGNET_HOLE_RADIUS - MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS) / 2;
    const analytic = Math.PI * (a * a + (b * b) / 2);
    let doubled = 0;
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      doubled += x1 * y2 - x2 * y1;
    }
    expect(Math.abs(doubled / 2 - analytic) / analytic).toBeLessThan(0.005);
  });

  it("ribs leave exactly the polygon-area difference in material", () => {
    const plain = baseHoleCutter(
      kernel,
      { magnet: true, screw: false, supportless: false, chamfer: false },
      SEGMENTS,
    )!;
    const ribbed = baseHoleCutter(
      kernel,
      { magnet: true, screw: false, supportless: false, chamfer: false, crushRibs: true },
      SEGMENTS,
    )!;

    const polygon = ribbedCirclePolygon(
      MAGNET_HOLE_RADIUS,
      MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS,
      MAGNET_HOLE_CRUSH_RIB_COUNT,
      SEGMENTS,
    );
    let doubled = 0;
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      doubled += x1 * y2 - x2 * y1;
    }
    const expected = (doubled / 2) * MAGNET_HOLE_DEPTH;
    expect(Math.abs(ribbed.volume() - expected) / expected).toBeLessThan(1e-6);
    expect(ribbed.volume()).toBeLessThan(plain.volume());
    // The lobes peak at θ = 11.25° + k·45° — never on an axis — so the
    // ribbed bbox sits strictly between the waist and the nominal bore.
    const maxX = ribbed.boundingBox().max[0];
    expect(maxX).toBeGreaterThan(MAGNET_HOLE_CRUSH_RIB_INNER_RADIUS);
    expect(maxX).toBeLessThan(plain.boundingBox().max[0]);
  });

  it("a supportless ribbed bin stays sound", () => {
    const solid = buildBase(
      kernel,
      { gridX: 1, gridY: 1 },
      SEGMENTS,
      holeOptionsFromSpec({ magnetHoles: true, screwHoles: false, magnetCrushRibs: true }),
    );
    expect(solid.status()).toBe("NoError");
    // Blind ribbed pockets change no topology.
    expect(solid.genus()).toBe(
      buildBase(kernel, { gridX: 1, gridY: 1 }, SEGMENTS, NO_HOLES).genus(),
    );
  });

  it("holeOptionsFromSpec gates ribs on magnets being enabled", () => {
    expect(
      holeOptionsFromSpec({ magnetHoles: true, screwHoles: false, magnetCrushRibs: true })
        .crushRibs,
    ).toBe(true);
    expect(
      holeOptionsFromSpec({ magnetHoles: false, screwHoles: true, magnetCrushRibs: true })
        .crushRibs,
    ).toBe(false);
  });
});
