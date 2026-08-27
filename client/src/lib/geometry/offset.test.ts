import { ringArea, ringBounds, signedArea } from "@shared/geometry/rings";
import type { Outline, Ring } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, withKernel } from "@/lib/manifold/runtime";

import {
  C_SHAPE_BAY_CENTRE,
  C_SHAPE_SOLID_POINT,
  circleRing,
  cShapeRing,
  polygonArea,
  rectRing,
} from "./fixtures";
import { buildOutline, outlineArea, outlineBounds, pointInOutline } from "./outline";
import {
  defaultCircularSegments,
  offsetOutline,
  offsetOutlineWithKernel,
  outlineToPolygons,
  polygonsToOutline,
  toCrossSection,
  type OffsetOptions,
} from "./offset";

/**
 * Runs the synchronous, kernel-injected form the worker uses, in a throwaway
 * arena. Every assertion below goes through this rather than `offsetOutline`,
 * so a leaked handle would show up as a growing arena, not as a slow test.
 */
function offset(
  outline: Outline,
  deltaPx: number,
  options?: OffsetOptions,
): Promise<Outline> {
  return withKernel((kernel) =>
    offsetOutlineWithKernel(kernel, outline, deltaPx, options),
  );
}

/** A square shell with a concentric square hole. */
function annulus(size: number, holeSize: number): Outline {
  const inset = (size - holeSize) / 2;
  return buildOutline([
    rectRing(0, 0, size, size),
    rectRing(inset, inset, holeSize, holeSize),
  ]);
}

const toRing = (polygon: readonly (readonly [number, number])[]): Ring =>
  polygon.map(([x, y]) => ({ x, y }));

describe("offsetOutlineWithKernel — growing", () => {
  it("grows a square by the analytic round-join area", async () => {
    // A + P·d + πd²: the straight edges sweep P·d and the four corner arcs
    // together sweep one full disc of radius d.
    const outline = buildOutline([rectRing(0, 0, 40, 40)]);
    const result = await offset(outline, 3, {
      joinType: "Round",
      circularSegments: 128,
    });

    const analytic = 1600 + 160 * 3 + Math.PI * 9;
    // Arc vertices sit *on* the circle, so the polygon is inscribed and
    // undershoots the true disc by ~0.04% at 128 segments — well inside 0.05.
    expect(outlineArea(result)).toBeCloseTo(analytic, 1);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(0);
  });

  it("stays within 1% of the analytic area at the default segment count", async () => {
    // The default trades vertices for accuracy; the faceting deficit is the
    // only difference, and it is bounded.
    const outline = buildOutline([rectRing(0, 0, 40, 40)]);
    const result = await offset(outline, 3, { joinType: "Round" });

    const analytic = 1600 + 160 * 3 + Math.PI * 9;
    expect(outlineArea(result)).toBeLessThan(analytic);
    expect(outlineArea(result)).toBeGreaterThan(analytic * 0.99);
  });

  it("grows a rectangle exactly with miter joins", async () => {
    const outline = buildOutline([rectRing(0, 0, 40, 20)]);
    const result = await offset(outline, 3, { joinType: "Miter" });

    // Square corners: (w + 2d)(h + 2d), with no arc approximation at all.
    expect(outlineArea(result)).toBeCloseTo(46 * 26, 6);
    expect(outlineBounds(result)).toEqual({
      minX: -3,
      minY: -3,
      maxX: 43,
      maxY: 23,
    });
  });
});

describe("offsetOutlineWithKernel — shrinking", () => {
  it("shrinks a rectangle to (w−2d)(h−2d)", async () => {
    const outline = buildOutline([rectRing(0, 0, 40, 20)]);
    const result = await offset(outline, -3, { joinType: "Miter" });

    expect(outlineArea(result)).toBeCloseTo(34 * 14, 6);
    expect(outlineBounds(result)).toEqual({
      minX: 3,
      minY: 3,
      maxX: 37,
      maxY: 17,
    });
  });

  it("returns an empty outline when the shell collapses", async () => {
    const outline = buildOutline([rectRing(0, 0, 10, 10)]);
    expect(await offset(outline, -10)).toEqual([]);
    // Exactly half the width erodes to a degenerate line, which is also empty.
    expect(await offset(outline, -5)).toEqual([]);
  });
});

describe("offsetOutlineWithKernel — holes", () => {
  it("grows the shell and shrinks the hole from one positive delta", async () => {
    // The reason this module exists. The legacy centroid-normal margin pushed
    // holes outward with the shell, eating the material between them.
    const outline = annulus(100, 40);
    const result = await offset(outline, 5, { joinType: "Miter" });

    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(1);
    // Both boundaries asserted separately: a net-area check would pass even if
    // the hole had moved the wrong way.
    expect(ringArea(result[0].outer)).toBeCloseTo(110 * 110, 6);
    expect(ringArea(result[0].holes[0])).toBeCloseTo(30 * 30, 6);
    expect(ringBounds(result[0].holes[0])).toEqual({
      minX: 35,
      minY: 35,
      maxX: 65,
      maxY: 65,
    });
  });

  it("shrinks the shell and grows the hole from one negative delta", async () => {
    const outline = annulus(100, 40);
    const result = await offset(outline, -5, { joinType: "Miter" });

    expect(ringArea(result[0].outer)).toBeCloseTo(90 * 90, 6);
    expect(ringArea(result[0].holes[0])).toBeCloseTo(50 * 50, 6);
  });

  it("handles a curved annulus with round joins", async () => {
    const outline = buildOutline([
      circleRing(50, 50, 40, 64),
      circleRing(50, 50, 15, 64),
    ]);
    const result = await offset(outline, 5, {
      joinType: "Round",
      circularSegments: 64,
    });

    expect(result[0].holes).toHaveLength(1);
    // Radii move to 45 and 10; the 64-gon undershoots each disc by ~0.15%.
    expect(ringArea(result[0].outer)).toBeGreaterThan(Math.PI * 45 * 45 * 0.99);
    expect(ringArea(result[0].outer)).toBeLessThan(Math.PI * 45 * 45);
    expect(ringArea(result[0].holes[0])).toBeGreaterThan(Math.PI * 100 * 0.99);
    expect(ringArea(result[0].holes[0])).toBeLessThan(Math.PI * 100);
  });

  it("deletes a hole narrower than twice the delta", async () => {
    const outline = annulus(100, 40);
    const result = await offset(outline, 25, { joinType: "Miter" });

    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(0);
    expect(outlineArea(result)).toBeCloseTo(150 * 150, 6);
  });

  it("keeps shells positive and holes negative", async () => {
    const outline = annulus(100, 40);
    const result = await offset(outline, 5);

    for (const shape of result) {
      expect(signedArea(shape.outer)).toBeGreaterThan(0);
      for (const hole of shape.holes) expect(signedArea(hole)).toBeLessThan(0);
    }
  });
});

describe("offsetOutlineWithKernel — concave geometry", () => {
  it("does not fill the bay of a C for a small delta", async () => {
    // The centroid of a C lies inside its bay, so a centroid-derived normal
    // pushed the bay walls the wrong way and closed it at any delta.
    const outline = buildOutline([cShapeRing()]);
    const result = await offset(outline, 5, { joinType: "Round" });

    expect(pointInOutline(result, C_SHAPE_BAY_CENTRE)).toBe(false);
    expect(pointInOutline(result, C_SHAPE_SOLID_POINT)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(0);
  });

  it("closes the bay once the delta exceeds half its width", async () => {
    // The bay is 40 px across (y 30..70), so its walls meet at delta 20.
    const outline = buildOutline([cShapeRing()]);

    expect(
      pointInOutline(await offset(outline, 19, { joinType: "Round" }), C_SHAPE_BAY_CENTRE),
    ).toBe(false);
    expect(
      pointInOutline(await offset(outline, 25, { joinType: "Round" }), C_SHAPE_BAY_CENTRE),
    ).toBe(true);
  });

  it("grows a concave shell without taking its hull", async () => {
    const outline = buildOutline([cShapeRing()]);
    const result = await offset(outline, 5, { joinType: "Round" });
    // The hull would be the full 110×110 square minus rounded corners; the
    // real answer keeps the bay open and is much smaller.
    expect(outlineArea(result)).toBeLessThan(11000);
    expect(outlineArea(result)).toBeGreaterThan(outlineArea(outline));
  });
});

describe("offsetOutlineWithKernel — degenerate input", () => {
  it("returns an empty outline for an empty outline", async () => {
    expect(await offset([], 5)).toEqual([]);
    expect(await offset([], 0)).toEqual([]);
    expect(await offsetOutline([], 5)).toEqual([]);
  });

  it("is a no-op on area for a zero delta", async () => {
    const outline = annulus(100, 40);
    const result = await offset(outline, 0);

    expect(outlineArea(result)).toBeCloseTo(outlineArea(outline), 10);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(1);
  });

  it("returns a copy rather than the input for a zero delta", async () => {
    const outline = annulus(100, 40);
    const result = await offsetOutline(outline, 0);

    expect(result).not.toBe(outline);
    expect(result[0].outer).not.toBe(outline[0].outer);
  });

  it("rejects a non-finite delta", async () => {
    const outline = annulus(100, 40);
    await expect(offset(outline, Number.NaN)).rejects.toThrow(/finite/);
    await expect(offsetOutline(outline, Infinity)).rejects.toThrow(/finite/);
  });

  it("drops a shape whose shell is degenerate", async () => {
    const outline: Outline = [
      { outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [] },
      { outer: rectRing(0, 0, 40, 20), holes: [] },
    ];
    const result = await offset(outline, 3, { joinType: "Miter" });

    expect(result).toHaveLength(1);
    expect(outlineArea(result)).toBeCloseTo(46 * 26, 6);
  });
});

describe("offsetOutline", () => {
  it("matches the kernel-injected form", async () => {
    const outline = annulus(100, 40);
    const viaKernel = await offset(outline, 5, { joinType: "Miter" });
    const direct = await offsetOutline(outline, 5, { joinType: "Miter" });

    expect(outlineArea(direct)).toBeCloseTo(outlineArea(viaKernel), 9);
    expect(direct[0].holes).toHaveLength(viaKernel[0].holes.length);
  });

  it("does not accumulate handles across repeated calls", async () => {
    // `withKernel` owns the arena, so the only observable proof from here is
    // that many calls in a row keep producing the same answer.
    const outline = annulus(100, 40);
    for (let i = 0; i < 8; i++) {
      const result = await offsetOutline(outline, 5, { joinType: "Miter" });
      expect(ringArea(result[0].outer)).toBeCloseTo(110 * 110, 6);
    }
  });
});

describe("arena discipline", () => {
  it("tracks every handle it creates in the caller's arena", async () => {
    const wasm = await loadManifold();
    const arena = new Arena();
    const kernel = createKernel(wasm, arena);

    try {
      expect(arena.size).toBe(0);
      offsetOutlineWithKernel(kernel, annulus(100, 40), 5);
      // Source CrossSection, offset result, simplified result — nothing else,
      // and nothing untracked.
      expect(arena.size).toBe(3);
    } finally {
      arena.dispose();
    }
    expect(arena.size).toBe(0);
  });

  it("allocates nothing on the zero-delta fast path", async () => {
    const wasm = await loadManifold();
    const arena = new Arena();
    const kernel = createKernel(wasm, arena);

    try {
      offsetOutlineWithKernel(kernel, annulus(100, 40), 0);
      expect(arena.size).toBe(0);
    } finally {
      arena.dispose();
    }
  });
});

describe("toCrossSection", () => {
  it("builds a section whose area nets out the holes", async () => {
    const outline = annulus(100, 40);
    const area = await withKernel((kernel) => toCrossSection(kernel, outline).area());
    expect(area).toBeCloseTo(10000 - 1600, 6);
  });

  it("survives an empty outline", async () => {
    // `new CrossSection([])` throws inside the glue code; the empty outline has
    // to be spelled differently.
    const result = await withKernel((kernel) => {
      const section = toCrossSection(kernel, []);
      return { empty: section.isEmpty(), area: section.area() };
    });
    expect(result).toEqual({ empty: true, area: 0 });
  });

  it("tracks the handle it returns", async () => {
    const wasm = await loadManifold();
    const arena = new Arena();
    const kernel = createKernel(wasm, arena);
    try {
      toCrossSection(kernel, annulus(100, 40));
      expect(arena.size).toBe(1);
    } finally {
      arena.dispose();
    }
  });
});

describe("outlineToPolygons / polygonsToOutline", () => {
  const outline = [
    ...annulus(100, 40),
    ...buildOutline([rectRing(200, 0, 30, 30)]),
  ];

  it("emits one contour per ring, shell first", () => {
    const polygons = outlineToPolygons(outline);
    expect(polygons).toHaveLength(3);
    expect(polygonArea(toRing(polygons[0]))).toBeCloseTo(10000, 6);
    expect(polygonArea(toRing(polygons[1]))).toBeCloseTo(1600, 6);
  });

  it("forces manifold's winding contract on the contours", () => {
    // Positive fill rule: a hole wound like a shell is unioned in rather than
    // subtracted, so the conversion may not trust its input's winding.
    const misWound: Outline = [
      {
        outer: [...rectRing(0, 0, 100, 100)].reverse(),
        holes: [rectRing(30, 30, 40, 40)],
      },
    ];
    const polygons = outlineToPolygons(misWound);

    expect(signedArea(toRing(polygons[0]))).toBeGreaterThan(0);
    expect(signedArea(toRing(polygons[1]))).toBeLessThan(0);
  });

  it("round-trips area and structure", () => {
    const restored = polygonsToOutline(outlineToPolygons(outline));

    expect(restored).toHaveLength(2);
    expect(restored[0].holes).toHaveLength(1);
    expect(restored[1].holes).toHaveLength(0);
    expect(outlineArea(restored)).toBeCloseTo(outlineArea(outline), 9);
    expect(outlineBounds(restored)).toEqual(outlineBounds(outline));
  });

  it("rebuilds nesting from geometry rather than input order", () => {
    // Clipper2 emits a flat contour list in no particular order; the hole must
    // still land under its shell.
    const [shell, hole] = outlineToPolygons(annulus(100, 40));
    const restored = polygonsToOutline([hole, shell]);

    expect(restored).toHaveLength(1);
    expect(restored[0].holes).toHaveLength(1);
    expect(ringArea(restored[0].holes[0])).toBeCloseTo(1600, 6);
  });

  it("drops holes belonging to a degenerate shell", () => {
    const outlineWithStubShell: Outline = [
      { outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [rectRing(0, 0, 5, 5)] },
    ];
    expect(outlineToPolygons(outlineWithStubShell)).toEqual([]);
    expect(polygonsToOutline([])).toEqual([]);
  });
});

describe("defaultCircularSegments", () => {
  it("never drops below the floor", () => {
    expect(defaultCircularSegments(0)).toBe(8);
    expect(defaultCircularSegments(0.25)).toBe(8);
  });

  it("is bounded by the 10° angle rule", () => {
    expect(defaultCircularSegments(1000)).toBe(36);
    expect(defaultCircularSegments(-1000)).toBe(36);
  });

  it("scales with the delta in between, in multiples of four", () => {
    const segments = defaultCircularSegments(3);
    expect(segments).toBe(20);
    expect(segments % 4).toBe(0);
    expect(defaultCircularSegments(2)).toBeLessThan(defaultCircularSegments(4));
  });
});
