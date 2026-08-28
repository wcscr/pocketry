import { describe, expect, it } from "vitest";

import type { Outline } from "../geometry/types";
import type { CutoutPlacement, TracedShape } from "./cutout";
import { parseCutoutPlacement } from "./cutout";
import { parseBinSpec, type BinSpecInput } from "./types";
import { validateLayout } from "./validate";

function rectOutline(width: number, height: number): Outline {
  const hw = width / 2;
  const hh = height / 2;
  return [
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
}

function makeShape(
  id: string,
  width: number,
  height: number,
  options: { holes?: boolean; uncalibrated?: boolean } = {},
): TracedShape {
  const outline = rectOutline(width, height);
  if (options.holes) {
    outline[0].holes.push([
      { x: -1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
    ]);
  }
  return {
    id,
    name: id,
    outlineMm: outline,
    bboxMm: { minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2 },
    pointCount: 4,
    sourceMmPerPx: options.uncalibrated ? null : 0.2,
  };
}

function makeCutout(
  id: string,
  shapeId: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): CutoutPlacement {
  return parseCutoutPlacement({ id, shapeId, position: { x, y }, ...extra });
}

function spec(partial: Partial<BinSpecInput> = {}) {
  return parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid", ...partial });
}

function codes(
  binSpec = spec(),
  cutouts: CutoutPlacement[],
  shapes: TracedShape[],
): string[] {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  return validateLayout(binSpec, cutouts, byId).map((issue) => issue.code);
}

// 2×2 bin: footprint 83.5, interior half-width 40.8.

describe("validateLayout", () => {
  it("rejects a pocket placed in a custom footprint's missing corner", () => {
    const shaped = spec({
      footprint: {
        kind: "custom",
        cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      },
    });
    expect(
      codes(shaped, [makeCutout("c1", "s1", 21, 21)], [makeShape("s1", 10, 10)]),
    ).toContain("out-of-bounds");
  });

  it("accepts a clean centred layout", () => {
    expect(codes(spec(), [makeCutout("c1", "s1", 0, 0)], [makeShape("s1", 20, 20)])).toEqual(
      [],
    );
  });

  it("errors when the bin is not solid", () => {
    expect(
      codes(spec({ fill: "none" }), [makeCutout("c1", "s1", 0, 0)], [makeShape("s1", 20, 20)]),
    ).toContain("cutouts-require-solid-fill");
  });

  it("errors on a dangling shape reference", () => {
    expect(codes(spec(), [makeCutout("c1", "ghost", 0, 0)], [])).toContain("missing-shape");
  });

  it("errors on an uncalibrated shape (defence-in-depth)", () => {
    expect(
      codes(
        spec(),
        [makeCutout("c1", "s1", 0, 0)],
        [makeShape("s1", 20, 20, { uncalibrated: true })],
      ),
    ).toContain("uncalibrated-scale");
  });

  it("flags out-of-bounds past the footprint", () => {
    expect(codes(spec(), [makeCutout("c1", "s1", 45, 0)], [makeShape("s1", 20, 20)])).toContain(
      "out-of-bounds",
    );
  });

  it("errors on wall breach within the clearance", () => {
    // Right edge at 40.6 → 0.2 mm from the interior boundary < 0.4 clearance.
    const result = codes(
      spec(),
      [makeCutout("c1", "s1", 30.6, 0, { clearanceMm: 0.4 })],
      [makeShape("s1", 20, 20)],
    );
    expect(result).toContain("wall-breach");
    expect(result).not.toContain("out-of-bounds");
  });

  it("accounts for a top-edge round that reaches the wall", () => {
    const result = codes(
      spec(),
      [makeCutout("c1", "s1", 29.4, 0, { clearanceMm: 0, topFilletMm: 1.5 })],
      [makeShape("s1", 20, 20)],
    );
    expect(result).toContain("wall-breach");
  });

  it("warns about the stacking lip inside its 1.65 mm intrusion band", () => {
    // Edge 1.0 mm from the boundary: clear of the wall, fouls the lip.
    const result = codes(
      spec(),
      [makeCutout("c1", "s1", 29.8, 0)],
      [makeShape("s1", 20, 20)],
    );
    expect(result).toEqual(["lip-collision"]);
  });

  it("downgrades to thin-material without a lip", () => {
    const result = codes(
      spec({ lip: "none" }),
      [makeCutout("c1", "s1", 29.8, 0)],
      [makeShape("s1", 20, 20)],
    );
    expect(result).toEqual(["thin-material"]);
  });

  it("errors when two cutouts overlap outright", () => {
    expect(
      codes(
        spec(),
        [makeCutout("a", "s1", 0, 0), makeCutout("b", "s1", 10, 0)],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("cutout-overlap");
  });

  it("errors when pockets merge within combined clearances", () => {
    // Separation 0.5 < 0.4 + 0.4.
    expect(
      codes(
        spec(),
        [
          makeCutout("a", "s1", -10.25, 0, { clearanceMm: 0.4 }),
          makeCutout("b", "s1", 10.25, 0, { clearanceMm: 0.4 }),
        ],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("cutout-overlap");
  });

  it("errors when top-edge rounds merge at the surface", () => {
    expect(
      codes(
        spec(),
        [
          makeCutout("a", "s1", -10.75, 0, {
            clearanceMm: 0,
            topFilletMm: 1,
          }),
          makeCutout("b", "s1", 10.75, 0, {
            clearanceMm: 0,
            topFilletMm: 1,
          }),
        ],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("cutout-overlap");
  });

  it("warns about a thin divider between pockets", () => {
    // Separation 1.5: clears 0.8, under 0.8 + 1.2.
    expect(
      codes(
        spec(),
        [
          makeCutout("a", "s1", -10.75, 0, { clearanceMm: 0.4 }),
          makeCutout("b", "s1", 10.75, 0, { clearanceMm: 0.4 }),
        ],
        [makeShape("s1", 20, 20)],
      ),
    ).toEqual(["thin-material"]);
  });

  it("stays silent for well-separated pockets", () => {
    expect(
      codes(
        spec(),
        [makeCutout("a", "s1", -13, 0), makeCutout("b", "s1", 13, 0)],
        [makeShape("s1", 20, 20)],
      ),
    ).toEqual([]);
  });

  it("errors when a pocket is deeper than the bin", () => {
    expect(
      codes(
        spec({ heightUnits: 2 }),
        [makeCutout("c1", "s1", 0, 0, { depth: { mode: "mm", value: 20 } })],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("too-deep");
  });

  it("errors when the floor sits above the fill surface", () => {
    expect(
      codes(
        spec({ heightUnits: 2 }),
        [
          makeCutout("c1", "s1", 0, 0, {
            depth: { mode: "remaining", floorThicknessMm: 15 },
          }),
        ],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("too-shallow");
  });

  it("warns on a paper-thin floor", () => {
    expect(
      codes(
        spec(),
        [
          makeCutout("c1", "s1", 0, 0, {
            depth: { mode: "remaining", floorThicknessMm: 0.5 },
          }),
        ],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("floor-too-thin");
  });

  it("warns when the pocket dips into the base with magnet holes on", () => {
    expect(
      codes(
        spec({ magnetHoles: true }),
        [
          makeCutout("c1", "s1", 0, 0, {
            depth: { mode: "remaining", floorThicknessMm: 5 },
          }),
        ],
        [makeShape("s1", 20, 20)],
      ),
    ).toContain("floor-in-base");
  });

  it("errors on a through cut of a holed shape, allows the blind pocket", () => {
    const holed = makeShape("s1", 20, 20, { holes: true });
    expect(
      codes(spec(), [makeCutout("c1", "s1", 0, 0, { depth: { mode: "through" } })], [holed]),
    ).toContain("through-island");
    expect(codes(spec(), [makeCutout("c1", "s1", 0, 0)], [holed])).toEqual([]);
  });
});

describe("validateLayout: finger holes and scoops (G4)", () => {
  it("keeps a clean layout clean when features sit inside the pocket", () => {
    const shape = makeShape("s1", 40, 30);
    const cutout = makeCutout("c1", "s1", 0, 0, {
      fingerHoles: [
        { id: "f1", center: { x: 10, y: 0 }, diameterMm: 12 },
        {
          id: "f2",
          kind: "scoop",
          center: { x: -18, y: 0 },
          diameterMm: 24,
          depthMm: 10,
        },
      ],
    });
    expect(codes(spec(), [cutout], [shape])).toEqual([]);
  });

  it("errors when a finger hole pokes through the bin wall", () => {
    // 2×2 bin: interior half-width 40.8, footprint half-width 41.75. The rim
    // reaches x = 41: past the interior (breach) but inside the footprint,
    // isolating wall-breach from out-of-bounds. Features get no clearance
    // allowance — they are cut at their drawn size.
    const shape = makeShape("s1", 20, 20);
    const cutout = makeCutout("c1", "s1", 0, 0, {
      fingerHoles: [{ id: "f1", center: { x: 32, y: 0 }, diameterMm: 18 }],
    });
    const result = codes(spec(), [cutout], [shape]);
    expect(result).toContain("wall-breach");
    expect(result).not.toContain("out-of-bounds");
  });

  it("errors when a scoop is deeper than the bin", () => {
    const shape = makeShape("s1", 20, 20);
    const cutout = makeCutout("c1", "s1", 0, 0, {
      depth: { mode: "remaining", floorThicknessMm: 2 },
      fingerHoles: [
        {
          id: "f1",
          kind: "scoop",
          center: { x: 10, y: 0 },
          diameterMm: 60,
          depthMm: 15,
        },
      ],
    });
    // 2u bin without a lip: top surface at 14 mm, scoop bottom at −1 mm.
    const result = codes(spec({ heightUnits: 2, lip: "none" }), [cutout], [shape]);
    expect(result).toContain("scoop-too-deep");
  });

  it("warns when a scoop leaves a paper-thin floor", () => {
    const shape = makeShape("s1", 20, 20);
    const cutout = makeCutout("c1", "s1", 0, 0, {
      depth: { mode: "remaining", floorThicknessMm: 2 },
      fingerHoles: [
        {
          id: "f1",
          kind: "scoop",
          center: { x: 10, y: 0 },
          diameterMm: 60,
          depthMm: 13,
        },
      ],
    });
    // Scoop bottom at 14 − 13 = 1 mm: below the 1.2 mm floor threshold.
    const result = codes(spec({ heightUnits: 2, lip: "none" }), [cutout], [shape]);
    expect(result).toContain("floor-too-thin");
    expect(result).not.toContain("scoop-too-deep");
  });

  it("errors when one pocket's finger hole reaches into another pocket", () => {
    // 20-wide pockets at x = 0 and x = 25 are silent without features (5 mm
    // apart); a hole rim reaching x = 21 crosses the second pocket's outline.
    const shapes = [makeShape("s1", 20, 20), makeShape("s2", 20, 20)];
    const plain = [makeCutout("c1", "s1", 0, 0), makeCutout("c2", "s2", 25, 0)];
    expect(codes(spec(), plain, shapes)).toEqual([]);

    const withHole = [
      makeCutout("c1", "s1", 0, 0, {
        fingerHoles: [{ id: "f1", center: { x: 12, y: 0 }, diameterMm: 18 }],
      }),
      makeCutout("c2", "s2", 25, 0),
    ];
    const result = codes(spec(), withHole, shapes);
    expect(result).toContain("cutout-overlap");
  });
});

describe("label tab rules (G5)", () => {
  it("warns when a pocket sits in the tab's shadow, silent when clear", () => {
    const shape = makeShape("s1", 20, 20);
    // 2×2 bin, north full tab: strip y ∈ [40.8 − 15.85, 40.8].
    const tabbed = spec({ labelTab: { wall: "north", width: "full" } });
    const under = codes(tabbed, [makeCutout("c1", "s1", 0, 20)], [shape]);
    expect(under).toContain("label-tab-shadow");
    const clear = codes(tabbed, [makeCutout("c1", "s1", 0, 0)], [shape]);
    expect(clear).not.toContain("label-tab-shadow");
  });

  it("maps the strip through wall rotations", () => {
    const shape = makeShape("s1", 20, 20);
    // Same pocket near +x: shadowed by an east tab, not by a north one.
    const east = spec({ labelTab: { wall: "east", width: "full" } });
    const result = codes(east, [makeCutout("c1", "s1", 20, 0)], [shape]);
    expect(result).toContain("label-tab-shadow");
    const north = spec({ labelTab: { wall: "north", width: "full" } });
    expect(codes(north, [makeCutout("c1", "s1", 20, 0)], [shape])).not.toContain(
      "label-tab-shadow",
    );
  });

  it("a partial tab only shadows its own 42 mm window", () => {
    const shape = makeShape("s1", 20, 20);
    // Left tab on the north wall covers x ∈ [−40.8, 1.2]; a pocket at
    // x = 25 touches the wall band but not the window.
    const leftTab = spec({ labelTab: { wall: "north", width: "left" } });
    expect(codes(leftTab, [makeCutout("c1", "s1", 25, 20)], [shape])).not.toContain(
      "label-tab-shadow",
    );
    expect(codes(leftTab, [makeCutout("c1", "s1", -25, 20)], [shape])).toContain(
      "label-tab-shadow",
    );
  });
});

describe("lite base layout rule (G5)", () => {
  it("warns when a pocket floor rests on the hollow lite base", () => {
    const shape = makeShape("s1", 20, 20);
    // Default depth: remaining with a 7 mm floor — exactly the base top.
    const onBase = codes(
      spec({ liteBase: true }),
      [makeCutout("c1", "s1", 0, 0)],
      [shape],
    );
    expect(onBase).toContain("lite-base-floor");

    const shallow = codes(
      spec({ liteBase: true }),
      [makeCutout("c1", "s1", 0, 0, { depth: { mode: "mm", value: 10 } })],
      [shape],
    );
    expect(shallow).not.toContain("lite-base-floor");

    const solidBase = codes(spec(), [makeCutout("c1", "s1", 0, 0)], [shape]);
    expect(solidBase).not.toContain("lite-base-floor");
  });
});
