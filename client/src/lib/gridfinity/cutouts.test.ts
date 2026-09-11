import {
  parseCutoutPlacement,
  fingerHoleSchema,
  resolvePocketDepth,
  type CutoutPlacement,
  type FingerHole,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import {
  binTotalHeightMm,
  BASE_PROFILE_HEIGHT,
  STACKING_LIP_HEIGHT_ACTUAL,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
} from "@shared/gridfinity/standard";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { buildBin, buildBinWithCutouts, type BinLayout } from "./bin";
import {
  budgetOutline,
  budgetedPointCount,
  buildFingerHoleCutters,
} from "./cutouts";

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
const QUALITY = { circularSegments: SEGMENTS, cutoutVertexBudget: 150 };

function rectShape(id: string, width: number, height: number, holed = false): TracedShape {
  const hw = width / 2;
  const hh = height / 2;
  const outline: TracedShape["outlineMm"] = [
    {
      outer: [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ],
      holes: [],
    },
  ];
  if (holed) {
    // Hole wound negatively (clockwise in y-up).
    outline[0].holes.push([
      { x: -2, y: -2 },
      { x: -2, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: -2 },
    ]);
  }
  return {
    id,
    name: id,
    outlineMm: outline,
    bboxMm: { minX: -hw, minY: -hh, maxX: hw, maxY: hh },
    pointCount: holed ? 8 : 4,
    sourceMmPerPx: 0.2,
  };
}

function layoutFor(
  shapes: TracedShape[],
  cutouts: CutoutPlacement[],
  fingerHoles: FingerHole[] = cutouts.flatMap(
    (placement) => placement.fingerHoles,
  ),
): BinLayout {
  return {
    shapesById: new Map(shapes.map((s) => [s.id, s])),
    cutouts,
    fingerHoles,
  };
}

function cutout(
  id: string,
  shapeId: string,
  extra: Record<string, unknown> = {},
): CutoutPlacement {
  return parseCutoutPlacement({
    id,
    shapeId,
    position: { x: 0, y: 0 },
    clearanceMm: 0,
    cornerRoundMm: 0,
    bottomFilletMm: 0,
    ...extra,
  });
}

const SPEC = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" });

describe("buildBinWithCutouts", () => {
  it("a sharp rectangular pocket removes exactly area × depth", () => {
    const shape = rectShape("s1", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { depth: { mode: "mm", value: 5 } })]),
      QUALITY,
    );

    expect(pocketed.solid.status()).toBe("NoError");
    expect(pocketed.solid.genus()).toBe(0);
    expect(pocketed.cutoutReports).toEqual([{ id: "c1", emptied: false }]);

    const removed = plain.solid.volume() - pocketed.solid.volume();
    expect(Math.abs(removed - 30 * 10 * 5) / (30 * 10 * 5)).toBeLessThan(1e-6);
  });

  it("uses a placement's independent X/Y scale for the generated cutter", () => {
    const shape = rectShape("scaled-shape", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [
          cutout("scaled-cutout", shape.id, {
            depth: { mode: "mm", value: 5 },
            scaleX: 2,
            scaleY: 0.5,
          }),
        ],
      ),
      QUALITY,
    );

    const expectedRemoved = 60 * 5 * 5;
    const removed = plain.solid.volume() - pocketed.solid.volume();
    expect(pocketed.solid.status()).toBe("NoError");
    expect(Math.abs(removed - expectedRemoved) / expectedRemoved).toBeLessThan(1e-6);
  });

  it("splits a blind pocket floor into a non-overlapping printable material volume", () => {
    const shape = rectShape("s1", 30, 10);
    const built = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [
          cutout("c1", "s1", {
            depth: { mode: "remaining", floorThicknessMm: 7 },
            bottomFilletMm: 2,
          }),
        ],
      ),
      QUALITY,
      { floorInsertThicknessMm: 0.6 },
    );

    expect(built.materialParts).not.toBeNull();
    const { body, pocketFloors } = built.materialParts!;
    expect(pocketFloors).not.toBeNull();
    expect(body.status()).toBe("NoError");
    expect(pocketFloors!.status()).toBe("NoError");
    expect(pocketFloors!.boundingBox().min[2]).toBeCloseTo(6.4, 6);
    expect(pocketFloors!.boundingBox().max[2]).toBeCloseTo(7, 6);

    const overlap = arena.track(body.intersect(pocketFloors!));
    expect(overlap.volume()).toBeLessThan(1e-7);
    const reunited = arena.track(body.add(pocketFloors!));
    expect(reunited.volume()).toBeCloseTo(built.solid.volume(), 5);
    expect(reunited.boundingBox()).toEqual(built.solid.boundingBox());
  });

  it.each([39, 38.8])("checks underside exposure in the actual floor-color mesh at %s mm fixed depth", (depthMm) => {
    const built = buildBinWithCutouts(
      kernel,
      parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6.5, fill: "solid" }),
      layoutFor([rectShape("tool", 30, 20)], [cutout("pocket", "tool", { depth: { mode: "mm", value: depthMm } })]),
      QUALITY,
      { floorInsertThicknessMm: 0.6 },
    );
    const mesh = built.materialParts!.pocketFloors!.getMesh();
    let exposedArea = 0;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const vertices = [0, 1, 2].map((offset) => {
        const index = mesh.triVerts[i + offset] * mesh.numProp;
        return [mesh.vertProperties[index], mesh.vertProperties[index + 1], mesh.vertProperties[index + 2]];
      });
      if (!vertices.every((vertex) => Math.abs(vertex[2] - BASE_PROFILE_HEIGHT) < 1e-5)) continue;
      const [a, b, c] = vertices;
      const normalZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      // Downward faces on the bridge are exposed between the base feet.
      if (normalZ < 0) exposedArea += -normalZ / 2;
    }
    if (depthMm === 39) expect(exposedArea).toBeGreaterThan(1);
    else expect(exposedArea).toBe(0);
  });

  it("splits the stacking-rim crest into a printable 0.6 mm material volume", () => {
    const built = buildBinWithCutouts(kernel, SPEC, null, QUALITY, {
      rimInsertThicknessMm: 0.6,
    });

    expect(built.materialParts).not.toBeNull();
    const { body, pocketFloors, stackingRim } = built.materialParts!;
    expect(pocketFloors).toBeNull();
    expect(stackingRim).not.toBeNull();
    const topZ = binTotalHeightMm(SPEC.heightUnits, true);
    expect(stackingRim!.boundingBox().min[2]).toBeCloseTo(topZ - 0.6, 6);
    expect(stackingRim!.boundingBox().max[2]).toBeCloseTo(topZ, 6);

    const overlap = arena.track(body.intersect(stackingRim!));
    expect(overlap.volume()).toBeLessThan(1e-7);
    const reunited = arena.track(body.add(stackingRim!));
    expect(reunited.volume()).toBeCloseTo(built.solid.volume(), 5);
    expect(reunited.boundingBox()).toEqual(built.solid.boundingBox());
  });

  it("limits a full-depth rim accent to the modeled stacking-lip geometry", () => {
    const lipDepthMm = STACKING_LIP_HEIGHT_ACTUAL + STACKING_LIP_SUPPORT_HEIGHT_MM;
    const built = buildBinWithCutouts(kernel, SPEC, null, QUALITY, {
      rimInsertThicknessMm: lipDepthMm,
    });

    const { body, stackingRim } = built.materialParts!;
    const topZ = binTotalHeightMm(SPEC.heightUnits, true);
    expect(stackingRim).not.toBeNull();
    expect(stackingRim!.boundingBox().min[2]).toBeCloseTo(topZ - lipDepthMm, 6);
    expect(stackingRim!.boundingBox().max[2]).toBeCloseTo(topZ, 6);

    const overlap = arena.track(body.intersect(stackingRim!));
    expect(overlap.volume()).toBeLessThan(1e-7);
    const reunited = arena.track(body.add(stackingRim!));
    expect(reunited.volume()).toBeCloseTo(built.solid.volume(), 5);
  });

  it("keeps a 5 mm rim accent out of the bin's interior top surface", () => {
    const built = buildBinWithCutouts(kernel, SPEC, null, QUALITY, {
      rimInsertThicknessMm: 5,
    });
    const centreProbe = arena.track(
      arena
        .track(kernel.Manifold.cube([10, 10, 10], true))
        .translate([0, 0, binTotalHeightMm(SPEC.heightUnits, true) - 5]),
    );
    const interiorAccent = arena.track(
      built.materialParts!.stackingRim!.intersect(centreProbe),
    );
    expect(interiorAccent.volume()).toBeLessThan(1e-7);
  });

  it("keeps floor and rim accents mutually disjoint and complete", () => {
    const shape = rectShape("s1", 30, 10);
    const built = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [
          cutout("c1", "s1", {
            depth: { mode: "remaining", floorThicknessMm: 7 },
          }),
        ],
      ),
      QUALITY,
      { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 0.6 },
    );

    const parts = built.materialParts!;
    expect(parts.pocketFloors).not.toBeNull();
    expect(parts.stackingRim).not.toBeNull();
    expect(
      arena.track(parts.pocketFloors!.intersect(parts.stackingRim!)).volume(),
    ).toBeLessThan(1e-7);
    const reunited = arena.track(
      parts.body.add(parts.pocketFloors!).add(parts.stackingRim!),
    );
    expect(reunited.volume()).toBeCloseTo(built.solid.volume(), 5);
  });

  it("does not invent a floor material for a through pocket", () => {
    const shape = rectShape("s1", 30, 10);
    const built = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { depth: { mode: "through" } })],
      ),
      QUALITY,
      { floorInsertThicknessMm: 0.6 },
    );
    expect(built.materialParts).toBeNull();
  });

  it("the bottom fillet strictly reduces removed volume, within bound", () => {
    const shape = rectShape("s1", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const sharp = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { depth: { mode: "mm", value: 10 } })]),
      QUALITY,
    );
    const filleted = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { depth: { mode: "mm", value: 10 }, bottomFilletMm: 2.8 })],
      ),
      QUALITY,
    );

    const removedSharp = plain.solid.volume() - sharp.solid.volume();
    const removedFilleted = plain.solid.volume() - filleted.solid.volume();
    expect(removedFilleted).toBeLessThan(removedSharp);
    // The fillet can leave at most ~r² per unit of perimeter.
    const perimeter = 2 * (30 + 10);
    expect(removedSharp - removedFilleted).toBeLessThan(perimeter * 2.8 ** 2);
  });

  it("makes the bottom fillet monotonically larger at 0.8, 2, and 4 mm", () => {
    const shape = rectShape("s1", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const removed = [0.8, 2, 4].map((bottomFilletMm) => {
      const built = buildBinWithCutouts(
        kernel,
        SPEC,
        layoutFor(
          [shape],
          [
            cutout("c1", "s1", {
              depth: { mode: "mm", value: 10 },
              bottomFilletMm,
            }),
          ],
        ),
        QUALITY,
      );
      expect(built.solid.status()).toBe("NoError");
      return plain.solid.volume() - built.solid.volume();
    });

    expect(removed[0]).toBeGreaterThan(removed[1]);
    expect(removed[1]).toBeGreaterThan(removed[2]);
  });

  it("clearance grows the pocket by the offset band", () => {
    const shape = rectShape("s1", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { depth: { mode: "mm", value: 5 }, clearanceMm: 0.4 })],
      ),
      QUALITY,
    );

    // Offset rect area: rect + perimeter·r + polygonised corner fans.
    const m = SEGMENTS / 4;
    const fan = 2 * m * 0.4 ** 2 * Math.sin(Math.PI / (2 * m));
    const area = 30 * 10 + 2 * (30 + 10) * 0.4 + fan;
    const removed = plain.solid.volume() - pocketed.solid.volume();
    expect(Math.abs(removed - area * 5) / (area * 5)).toBeLessThan(1e-4);
  });

  it("negative clearance shrinks each edge after scaling, preserving the source outline", () => {
    const shape = rectShape("s1", 30, 10);
    const original = structuredClone(shape);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(kernel, SPEC, layoutFor([shape], [cutout("c1", "s1", {
      scaleX: 1.5, scaleY: 2, clearanceMm: -0.5, depth: { mode: "mm", value: 5 },
    })]), QUALITY);
    expect(pocketed.solid.status()).toBe("NoError");
    expect(plain.solid.volume() - pocketed.solid.volume()).toBeCloseTo((45 - 1) * (20 - 1) * 5, 4);
    expect(pocketed.cutoutReports).toEqual([{ id: "c1", emptied: false }]);
    expect(shape).toEqual(original);
  });

  it("reports a pocket erased by negative clearance without producing an invalid solid", () => {
    const sliver = rectShape("s1", 30, 0.8);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(kernel, SPEC, layoutFor([sliver], [cutout("c1", "s1", {
      clearanceMm: -0.5,
    })]), QUALITY);
    expect(pocketed.cutoutReports).toEqual([{ id: "c1", emptied: true }]);
    expect(pocketed.solid.status()).toBe("NoError");
    expect(pocketed.solid.volume()).toBeCloseTo(plain.solid.volume(), 6);
  });

  it("outline corner rounding removes sharp plan-view corners", () => {
    const shape = rectShape("s1", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const sharp = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { depth: { mode: "mm", value: 5 } })],
      ),
      QUALITY,
    );
    const rounded = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [
          cutout("c1", "s1", {
            depth: { mode: "mm", value: 5 },
            cornerRoundMm: 2,
          }),
        ],
      ),
      QUALITY,
    );

    const removedSharp = plain.solid.volume() - sharp.solid.volume();
    const removedRounded = plain.solid.volume() - rounded.solid.volume();
    expect(removedRounded).toBeLessThan(removedSharp);
  });

  it("top edge rounding flares the pocket into the top surface", () => {
    const shape = rectShape("s1", 30, 10);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const sharp = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { depth: { mode: "mm", value: 8 } })],
      ),
      QUALITY,
    );
    const rounded = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [
          cutout("c1", "s1", {
            depth: { mode: "mm", value: 8 },
            topFilletMm: 1.2,
          }),
        ],
      ),
      QUALITY,
    );

    const removedSharp = plain.solid.volume() - sharp.solid.volume();
    const removedRounded = plain.solid.volume() - rounded.solid.volume();
    expect(removedRounded).toBeGreaterThan(removedSharp);
    expect(rounded.solid.status()).toBe("NoError");
  });

  it("a blind pocket of a holed shape keeps genus 0 and leaves the pillar", () => {
    const shape = rectShape("s1", 20, 20, true);
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { depth: { mode: "mm", value: 8 } })]),
      QUALITY,
    );

    expect(pocketed.solid.genus()).toBe(0);
    // The 4×4 island stays: removed volume excludes it.
    const removed = plain.solid.volume() - pocketed.solid.volume();
    const expected = (20 * 20 - 4 * 4) * 8;
    expect(Math.abs(removed - expected) / expected).toBeLessThan(1e-6);
  });

  it("a through cut adds a handle (genus +1) and pierces the base", () => {
    const shape = rectShape("s1", 20, 10);
    const pocketed = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { depth: { mode: "through" } })]),
      QUALITY,
    );
    expect(pocketed.solid.status()).toBe("NoError");
    expect(pocketed.solid.genus()).toBe(1);
    // Open at the very bottom.
    expect(pocketed.solid.boundingBox().min[2]).toBeCloseTo(0, 7);
  });

  it("mirrored placement removes equal volume at the mirrored location", () => {
    // Chiral L-shape, offset from its bbox centre.
    const chiral: TracedShape = {
      id: "s1",
      name: "L",
      outlineMm: [
        {
          outer: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 0 },
            { x: -5, y: 0 },
            { x: -5, y: 5 },
            { x: -10, y: 5 },
          ],
          holes: [],
        },
      ],
      bboxMm: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
      pointCount: 6,
      sourceMmPerPx: 0.2,
    };
    const plain = buildBin(kernel, SPEC, QUALITY);
    const base = { depth: { mode: "mm", value: 6 } };
    const normal = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([chiral], [cutout("c1", "s1", { ...base, position: { x: 8, y: 0 } })]),
      QUALITY,
    );
    const mirrored = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [chiral],
        [cutout("c1", "s1", { ...base, position: { x: 8, y: 0 }, mirrored: true })],
      ),
      QUALITY,
    );

    expect(normal.solid.volume()).toBeCloseTo(mirrored.solid.volume(), 4);
    expect(normal.solid.volume()).toBeLessThan(plain.solid.volume());
  });

  it("a disjoint finger hole removes exactly its prism volume", () => {
    // Hole fully outside the 30×10 rect (half-width 15): the removed volume
    // is the pocket prism plus the circle n-gon prism, both to the same
    // floor. The circle is an inscribed SEGMENTS-gon: area = ½n·r²·sin(2π/n).
    const shape = rectShape("s1", 30, 10);
    const depth = 5;
    const radius = 6;
    const plain = buildBin(kernel, SPEC, QUALITY);
    const pocketed = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [
          cutout("c1", "s1", {
            depth: { mode: "mm", value: depth },
            fingerHoles: [
              {
                id: "f1",
                center: { x: 22, y: 0 },
                diameterMm: 2 * radius,
                depthMm: depth,
              },
            ],
          }),
        ],
      ),
      QUALITY,
    );

    expect(pocketed.solid.status()).toBe("NoError");
    expect(pocketed.solid.genus()).toBe(0);
    const circleArea = 0.5 * SEGMENTS * radius * radius * Math.sin((2 * Math.PI) / SEGMENTS);
    const expected = (30 * 10 + circleArea) * depth;
    const removed = plain.solid.volume() - pocketed.solid.volume();
    expect(Math.abs(removed - expected) / expected).toBeLessThan(1e-6);
  });

  it("builds a finger hole without any tool pocket", () => {
    const depthMm = 5;
    const radius = 6;
    const plain = buildBin(kernel, SPEC, QUALITY);
    const withHole = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([], [], [
        {
          id: "independent-hole",
          center: { x: 0, y: 0 },
          diameterMm: radius * 2,
          depthMm,
          kind: "straight",
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ]),
      QUALITY,
    );
    const polygonArea =
      0.5 * SEGMENTS * radius * radius * Math.sin((2 * Math.PI) / SEGMENTS);
    const removed = plain.solid.volume() - withHole.solid.volume();
    expect(Math.abs(removed - polygonArea * depthMm) / removed).toBeLessThan(1e-6);
  });

  it("rounds both edges of a straight finger hole", () => {
    const plain = buildBin(kernel, SPEC, QUALITY);
    const makeHole = (topFilletMm: number, bottomFilletMm: number) =>
      buildBinWithCutouts(
        kernel,
        SPEC,
        layoutFor([], [], [
          {
            id: `straight-${topFilletMm}-${bottomFilletMm}`,
            center: { x: 0, y: 0 },
            diameterMm: 18,
            depthMm: 12,
            kind: "straight",
            topFilletMm,
            bottomFilletMm,
          },
        ]),
        QUALITY,
      ).solid;

    const sharp = makeHole(0, 0);
    const topRounded = makeHole(1.2, 0);
    const bottomFilleted = makeHole(0, 2);
    expect(sharp.status()).toBe("NoError");
    expect(topRounded.status()).toBe("NoError");
    expect(bottomFilleted.status()).toBe("NoError");
    expect(topRounded.volume()).toBeLessThan(sharp.volume());
    expect(bottomFilleted.volume()).toBeGreaterThan(sharp.volume());
    expect(topRounded.volume()).toBeLessThan(plain.solid.volume());
  });

  it.each(["scoop", "deep-scoop", "oblong-deep-scoop", "flat-ended-scoop"] as const)(
    "ignores an extra bottom fillet for the already-curved %s bottom",
    (kind) => {
      const base = {
        id: `curved-${kind}`,
        center: { x: 0, y: 0 },
        diameterMm: 14,
        depthMm: kind === "scoop" ? 6 : 24,
        kind,
        topFilletMm: 0,
        bottomFilletMm: 0,
        ...(kind === "oblong-deep-scoop"
          ? { lengthMm: 30, rotationDeg: 20 }
          : {}),
      } satisfies FingerHole;
      const sharpBottom = buildFingerHoleCutters(
        kernel,
        [base],
        SPEC,
        QUALITY,
      )[0];
      const requestedBottomFillet = buildFingerHoleCutters(
        kernel,
        [{ ...base, bottomFilletMm: 3 }],
        SPEC,
        QUALITY,
      )[0];

      expect(requestedBottomFillet.status()).toBe("NoError");
      expect(requestedBottomFillet.volume()).toBeCloseTo(
        sharpBottom.volume(),
        8,
      );
    },
  );

  it.each(["straight", "scoop", "deep-scoop", "oblong-deep-scoop", "flat-ended-scoop"] as const)(
    "adds a top edge round to a %s finger hole",
    (kind) => {
      const base = {
        id: `top-${kind}`,
        center: { x: 0, y: 0 },
        diameterMm: 14,
        depthMm: kind === "scoop" ? 6 : 24,
        kind,
        topFilletMm: 0,
        bottomFilletMm: 0,
        ...(kind === "oblong-deep-scoop"
          ? { lengthMm: 30, rotationDeg: 20 }
          : {}),
      } satisfies FingerHole;
      const sharp = buildFingerHoleCutters(kernel, [base], SPEC, QUALITY)[0];
      const rounded = buildFingerHoleCutters(
        kernel,
        [{ ...base, topFilletMm: 5 }],
        SPEC,
        QUALITY,
      )[0];

      expect(rounded.status()).toBe("NoError");
      expect(rounded.volume()).toBeGreaterThan(sharp.volume());
    },
  );

  it("a scoop in open surface removes its spherical cap, within facet error", () => {
    // Scoop centred away from the pocket: the extra removal against the
    // no-scoop bin is one spherical cap, V = πh²(R − h/3). The faceted
    // sphere is inscribed, so the cut is strictly smaller than analytic and
    // within ~2% at 32 segments.
    const shape = rectShape("s1", 30, 10);
    const base = { depth: { mode: "mm", value: 5 } };
    const scoop = {
      id: "f1",
      kind: "scoop",
      center: { x: 0, y: 25 },
      diameterMm: 30,
      depthMm: 10,
    };
    const without = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", base)]),
      QUALITY,
    );
    const withScoop = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { ...base, fingerHoles: [scoop] })]),
      QUALITY,
    );

    expect(withScoop.solid.status()).toBe("NoError");
    expect(withScoop.solid.genus()).toBe(0);

    const a = scoop.diameterMm / 2;
    const h = scoop.depthMm;
    const sphereRadius = (a * a + h * h) / (2 * h);
    const capVolume = Math.PI * h * h * (sphereRadius - h / 3);
    const removed = without.solid.volume() - withScoop.solid.volume();
    // Inscribed facets in both sphere angles: measured deficit ≈ 2.9% at 32
    // segments. Strictly under analytic, and no worse than 5%.
    expect(removed).toBeLessThan(capVolume);
    expect(removed).toBeGreaterThan(0.95 * capVolume);
  });

  it("a scoop straddling the pocket edge stays sound and cuts something", () => {
    const shape = rectShape("s1", 30, 10);
    const base = { depth: { mode: "mm", value: 4 } };
    // Deeper than the pocket, centred on its boundary — the get-under-the-
    // tool case.
    const scoop = {
      id: "f1",
      kind: "scoop",
      center: { x: 0, y: 5 },
      diameterMm: 24,
      depthMm: 8,
    };
    const without = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", base)]),
      QUALITY,
    );
    const withScoop = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { ...base, fingerHoles: [scoop] })]),
      QUALITY,
    );

    expect(withScoop.solid.status()).toBe("NoError");
    expect(withScoop.solid.genus()).toBe(0);
    const removed = without.solid.volume() - withScoop.solid.volume();
    const a = scoop.diameterMm / 2;
    const capVolume =
      Math.PI * scoop.depthMm ** 2 *
      ((a * a + scoop.depthMm ** 2) / (2 * scoop.depthMm) - scoop.depthMm / 3);
    expect(removed).toBeGreaterThan(0);
    expect(removed).toBeLessThan(capVolume);
  });

  it("a deep scoop removes a straight shaft with a hemispherical bottom", () => {
    const shape = rectShape("s1", 12, 8);
    const base = { depth: { mode: "mm", value: 4 } };
    const scoop = {
      id: "f1",
      kind: "deep-scoop",
      center: { x: -18, y: 20 },
      diameterMm: 16,
      depthMm: 30,
    };
    const without = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", base)]),
      QUALITY,
    );
    const withScoop = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { ...base, fingerHoles: [scoop] })]),
      QUALITY,
    );

    expect(withScoop.solid.status()).toBe("NoError");
    expect(withScoop.solid.genus()).toBe(0);
    const radius = scoop.diameterMm / 2;
    const shaftDepth = scoop.depthMm - radius;
    const analytic =
      Math.PI * radius * radius * shaftDepth +
      (2 * Math.PI * radius ** 3) / 3;
    const removed = without.solid.volume() - withScoop.solid.volume();
    expect(removed).toBeLessThan(analytic);
    expect(removed).toBeGreaterThan(0.94 * analytic);
  });

  it("an oblong deep scoop removes capsule walls and a rounded trough bottom", () => {
    const shape = rectShape("s1", 12, 8);
    const base = { depth: { mode: "mm", value: 4 } };
    const scoop = {
      id: "f1",
      kind: "oblong-deep-scoop",
      center: { x: 0, y: 20 },
      diameterMm: 10,
      depthMm: 25,
      lengthMm: 40,
      rotationDeg: 0,
    };
    const without = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", base)]),
      QUALITY,
    );
    const withScoop = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { ...base, fingerHoles: [scoop] })]),
      QUALITY,
    );

    expect(withScoop.solid.status()).toBe("NoError");
    expect(withScoop.solid.genus()).toBe(0);
    const radius = scoop.diameterMm / 2;
    const span = scoop.lengthMm - scoop.diameterMm;
    const shaftArea = Math.PI * radius ** 2 + 2 * radius * span;
    const shaftDepth = scoop.depthMm - radius;
    const roundedBottomVolume =
      (Math.PI * radius ** 2 * span) / 2 +
      (2 * Math.PI * radius ** 3) / 3;
    const analytic = shaftArea * shaftDepth + roundedBottomVolume;
    const removed = without.solid.volume() - withScoop.solid.volume();
    expect(removed).toBeLessThan(analytic);
    expect(removed).toBeGreaterThan(0.92 * analytic);
  });

  it("cuts every independent scoop-style finger hole", () => {
    const shape = rectShape("s1", 12, 8);
    const base = { depth: { mode: "mm", value: 4 } };
    const left = {
      id: "left",
      kind: "scoop",
      center: { x: -22, y: 0 },
      diameterMm: 14,
      depthMm: 5,
    };
    const right = { ...left, id: "right", center: { x: 22, y: 0 } };
    const one = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { ...base, fingerHoles: [left] })],
      ),
      QUALITY,
    );
    const two = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { ...base, fingerHoles: [left, right] })],
      ),
      QUALITY,
    );
    expect(one.solid.status()).toBe("NoError");
    expect(two.solid.status()).toBe("NoError");
    expect(two.solid.volume()).toBeLessThan(one.solid.volume());
  });

  it("keeps independent finger holes unchanged when a pocket is mirrored", () => {
    const shape = rectShape("s1", 30, 10);
    const features = {
      depth: { mode: "mm", value: 6 },
      fingerHoles: [
        { id: "f1", center: { x: 12, y: 3 }, diameterMm: 14 },
        {
          id: "f2",
          kind: "scoop",
          center: { x: -10, y: 5 },
          diameterMm: 22,
          depthMm: 8,
        },
      ],
    };
    const normal = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([shape], [cutout("c1", "s1", { ...features, position: { x: 6, y: 2 } })]),
      QUALITY,
    );
    const mirrored = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [shape],
        [cutout("c1", "s1", { ...features, position: { x: 6, y: 2 }, mirrored: true })],
      ),
      QUALITY,
    );

    expect(normal.solid.volume()).toBeCloseTo(mirrored.solid.volume(), 4);
  });

  it("reports a cutout that collapses under corner rounding", () => {
    // A 0.8 mm sliver: −1 mm round offset erases it.
    const sliver = rectShape("s1", 30, 0.8);
    const result = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor([sliver], [cutout("c1", "s1", { cornerRoundMm: 1 })]),
      QUALITY,
    );
    expect(result.cutoutReports).toEqual([{ id: "c1", emptied: true }]);
    // Nothing was cut.
    const plain = buildBin(kernel, SPEC, QUALITY);
    expect(result.solid.volume()).toBeCloseTo(plain.solid.volume(), 6);
  });

  it("survives a fuzzed 300-point blob end to end", () => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 300; i++) {
      const theta = (i / 300) * 2 * Math.PI;
      const radius = 18 + 4 * Math.sin(5 * theta) + 2 * Math.sin(11 * theta + 1);
      points.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta) });
    }
    const blob: TracedShape = {
      id: "s1",
      name: "blob",
      outlineMm: [{ outer: points, holes: [] }],
      bboxMm: { minX: -24, minY: -24, maxX: 24, maxY: 24 },
      pointCount: 300,
      sourceMmPerPx: 0.2,
    };
    const result = buildBinWithCutouts(
      kernel,
      SPEC,
      layoutFor(
        [blob],
        [
          cutout("c1", "s1", {
            clearanceMm: 0.4,
            cornerRoundMm: 1,
            bottomFilletMm: 2.8,
            depth: { mode: "remaining", floorThicknessMm: 7 },
          }),
        ],
      ),
      QUALITY,
    );
    expect(result.solid.status()).toBe("NoError");
    expect(result.solid.genus()).toBe(0);
    expect(result.cutoutReports[0].emptied).toBe(false);
  });
});

describe("budgetOutline", () => {
  it("reduces rings to the budget and is idempotent", () => {
    const points = Array.from({ length: 500 }, (_, i) => {
      const theta = (i / 500) * 2 * Math.PI;
      return { x: 20 * Math.cos(theta), y: 20 * Math.sin(theta) };
    });
    const outline = [{ outer: points, holes: [] }];
    const budgeted = budgetOutline(outline, 150);
    expect(budgeted[0].outer.length).toBeLessThanOrEqual(150);
    expect(budgeted[0].outer.length).toBeGreaterThanOrEqual(3);
    expect(budgetOutline(budgeted, 150)[0].outer.length).toBe(
      budgeted[0].outer.length,
    );
    expect(budgetedPointCount(outline, 150)).toBe(budgeted[0].outer.length);
  });
});

it("cuts flat-bottom pockets below the former feet while retaining a solid 2 mm floor", () => {
  const shape = rectShape("deep-flat", 10, 10);
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, flatBottom: true });
  const cutout = parseCutoutPlacement({ id: "deep", shapeId: shape.id, position: { x: 0, y: 0 },
    depth: { mode: "remaining", floorThicknessMm: 2 }, topFilletMm: 0, bottomFilletMm: 0, cornerRoundMm: 0 });
  const layout = { shapesById: new Map([[shape.id, shape]]), cutouts: [cutout], fingerHoles: [] };
  for (const circularSegments of [24, 64]) {
    const quality = { circularSegments };
    const blank = buildBin(kernel, spec, quality).solid;
    const pocketed = buildBinWithCutouts(kernel, spec, layout, quality).solid;
    expect(pocketed.status()).toBe("NoError");
    expect(arena.track(pocketed.slice(1)).area()).toBeCloseTo(arena.track(blank.slice(1)).area(), 5);
    expect(arena.track(blank.slice(3)).area() - arena.track(pocketed.slice(3)).area()).toBeCloseTo(100, 5);
    expect(arena.track(blank.slice(6)).area() - arena.track(pocketed.slice(6)).area()).toBeCloseTo(100, 5);
  }
});


describe("flat-ended cylindrical scoop solids", () => {
  it.each([0, 37, 90])("cuts the expected cylindrical volume at %s degrees", (rotationDeg) => {
    const hole = fingerHoleSchema.parse({
      id: "flat", kind: "flat-ended-scoop", center: { x: 0, y: 0 },
      diameterMm: 16, lengthMm: 40, depthMm: 25, rotationDeg,
    });
    const plain = buildBinWithCutouts(kernel, SPEC, layoutFor([], []), QUALITY);
    const result = buildBinWithCutouts(kernel, SPEC, layoutFor([], [], [hole]), QUALITY);
    const removed = plain.solid.volume() - result.solid.volume();
    const expected = 40 * (16 * (25 - 8) + Math.PI * 8 ** 2 / 2);
    expect(result.solid.status()).toBe("NoError");
    expect(result.solid.genus()).toBe(0);
    expect(removed).toBeGreaterThan(expected * 0.99);
    expect(removed).toBeLessThanOrEqual(expected);
  });

  it("has full curved cross-section immediately inside each flat end and no cut beyond it", () => {
    const hole = fingerHoleSchema.parse({
      id: "flat", kind: "flat-ended-scoop", center: { x: 0, y: 0 },
      diameterMm: 16, lengthMm: 40, depthMm: 25,
    });
    const cutter = buildFingerHoleCutters(kernel, [hole], SPEC, QUALITY)[0];
    const top = resolvePocketDepth(SPEC, { mode: "mm", value: 25 }).infillTopZ;
    const slabVolume = (x: number) => {
      const box = arena.track(arena.track(kernel.Manifold.cube([0.1, 20, 25])).translate([x, -10, top - 25]));
      return arena.track(cutter.intersect(box)).volume();
    };
    expect(slabVolume(-19.9)).toBeCloseTo(slabVolume(0), 6);
    expect(slabVolume(19.8)).toBeCloseTo(slabVolume(0), 6);
    expect(slabVolume(20.01)).toBe(0);
    expect(slabVolume(-20.11)).toBe(0);
  });

  it("stays manifold across several intersecting narrow tool pockets", () => {
    const shape = rectShape("slot", 30, 4);
    const pockets = [-12, 0, 12].map((y, i) => cutout(`slot-${i}`, "slot", {
      position: { x: 0, y }, depth: { mode: "mm", value: 20 },
    }));
    const hole = fingerHoleSchema.parse({
      id: "flat", kind: "flat-ended-scoop", center: { x: 0, y: 0 },
      diameterMm: 16, lengthMm: 50, depthMm: 25, rotationDeg: 90,
    });
    const without = buildBinWithCutouts(kernel, SPEC, layoutFor([shape], pockets), QUALITY);
    const result = buildBinWithCutouts(kernel, SPEC, layoutFor([shape], pockets, [hole]), QUALITY);
    expect(result.solid.status()).toBe("NoError");
    expect(result.solid.genus()).toBe(0);
    expect(result.solid.volume()).toBeLessThan(without.solid.volume());
  });
});


describe("shallow flat-ended scoops", () => {
  it.each([
    [24, 1, 40, 0], [24, 3, 40, 37], [24, 11.99, 40, 90], [80, 1, 6, 0],
  ])("preserves width %s at depth %s, length %s and rotation %s", (diameterMm, depthMm, lengthMm, rotationDeg) => {
    const hole = fingerHoleSchema.parse({
      id: "shallow", kind: "flat-ended-scoop", center: { x: 0, y: 0 },
      diameterMm, depthMm, lengthMm, rotationDeg,
    });
    const cutter = buildFingerHoleCutters(kernel, [hole], SPEC, QUALITY)[0];
    const surface = resolvePocketDepth(SPEC, { mode: "mm", value: depthMm });
    const unrotated = arena.track(cutter.rotate([0, 0, -rotationDeg]));
    const bounds = unrotated.boundingBox();
    expect(cutter.status()).toBe("NoError");
    expect(bounds.min[0]).toBeCloseTo(-lengthMm / 2, 6);
    expect(bounds.max[0]).toBeCloseTo(lengthMm / 2, 6);
    expect(bounds.min[1]).toBeCloseTo(-diameterMm / 2, 6);
    expect(bounds.max[1]).toBeCloseTo(diameterMm / 2, 6);
    expect(bounds.min[2]).toBeCloseTo(surface.infillTopZ - depthMm, 6);
    const halfWidth = diameterMm / 2;
    const radius = (halfWidth ** 2 + depthMm ** 2) / (2 * depthMm);
    const area = radius ** 2 * Math.acos((radius - depthMm) / radius) - (radius - depthMm) * halfWidth;
    const expected = lengthMm * (area + diameterMm * (surface.cutterTopZ - surface.infillTopZ));
    expect(cutter.volume()).toBeGreaterThan(expected * 0.99);
    expect(cutter.volume()).toBeLessThanOrEqual(expected + 1e-6);
  });

  it("keeps a 1 mm shallow cut watertight with top rounding and intersecting pockets", () => {
    const hole = fingerHoleSchema.parse({
      id: "shallow", kind: "flat-ended-scoop", center: { x: 0, y: 0 },
      diameterMm: 24, depthMm: 1, lengthMm: 40, rotationDeg: 37, topFilletMm: 5,
    });
    const shape = rectShape("slot", 30, 4);
    const result = buildBinWithCutouts(kernel, SPEC, layoutFor([shape], [cutout("c", "slot")], [hole]), QUALITY);
    expect(result.solid.status()).toBe("NoError");
    expect(result.solid.genus()).toBe(0);
  });
});


it.each([1, 5, 20])("keeps the exported flat-ended rim free of stair treads at depth %s", (depthMm) => {
  const hole = fingerHoleSchema.parse({
    id: "rim", kind: "flat-ended-scoop", center: { x: 3, y: -2 },
    diameterMm: 24, lengthMm: 40, depthMm, rotationDeg: 37, topFilletMm: 1,
  });
  const cutter = buildFingerHoleCutters(kernel, [hole], SPEC, { circularSegments: 64, filletProfileStepMm: 0.1 })[0];
  const topZ = resolvePocketDepth(SPEC, { mode: "mm", value: depthMm }).infillTopZ;
  const bottomZ = topZ - Math.min(1, depthMm / 2);
  const mesh = cutter.getMesh();
  const treads: number[] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const zs = [0, 1, 2].map(j => mesh.vertProperties[mesh.triVerts[i + j] * mesh.numProp + 2]);
    if (zs[0] > bottomZ + 1e-5 && zs[0] < topZ - 1e-5 &&
        Math.max(...zs) - Math.min(...zs) < 1e-7) treads.push(zs[0]);
  }
  expect(cutter.status()).toBe("NoError");
  expect(treads).toEqual([]);
});
