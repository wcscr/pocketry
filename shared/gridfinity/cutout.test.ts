import { describe, expect, it } from "vitest";

import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import {
  binInteriorMm,
  binToCanvas,
  canvasToBin,
  cutoutPlacementSchema,
  effectiveDeepScoopDepthMm,
  effectiveScoopDepthMm,
  parseCutoutPlacement,
  placementFootprint,
  resolvePocketDepth,
  signedDistanceToInterior,
  tracedShapeSchema,
  transformOutlinePlacement,
  transformPointPlacement,
  untransformPointPlacement,
} from "./cutout";
import { BASE_HEIGHT, R_F2 } from "./standard";

const SPEC_2X3 = { gridX: 2, gridY: 3 };

/** An L-shaped (chiral) outline with a hole — orientation-sensitive fixture. */
const CHIRAL: Outline = [
  {
    outer: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ],
    holes: [
      [
        { x: 0.25, y: 0.25 },
        { x: 0.25, y: 0.75 },
        { x: 0.75, y: 0.75 },
        { x: 0.75, y: 0.25 },
      ],
    ],
  },
];

describe("cutout schemas", () => {
  it("applies the design-doc defaults", () => {
    const placement = parseCutoutPlacement({
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
    });
    expect(placement.rotationDeg).toBe(0);
    expect(placement.mirrored).toBe(false);
    expect(placement.depth).toEqual({ mode: "remaining", floorThicknessMm: BASE_HEIGHT });
    expect(placement.clearanceMm).toBe(0);
    expect(placement.cornerRoundMm).toBeCloseTo(1, 12);
    expect(placement.topFilletMm).toBe(0);
    expect(placement.bottomFilletMm).toBeCloseTo(R_F2, 12);
    const withHole = parseCutoutPlacement({
      id: "c2",
      shapeId: "s1",
      position: { x: 0, y: 0 },
      fingerHoles: [{ id: "f1", center: { x: 0, y: 0 }, diameterMm: 18 }],
    });
    expect(withHole.fingerHoles[0]).toMatchObject({
      kind: "straight",
      depthMm: 12,
    });
  });

  it("rejects unknown keys and malformed outlines", () => {
    expect(() =>
      cutoutPlacementSchema.parse({
        id: "c1",
        shapeId: "s1",
        position: { x: 0, y: 0 },
        scoop: true,
      }),
    ).toThrow();
    expect(() =>
      tracedShapeSchema.parse({
        id: "s1",
        name: "tool",
        outlineMm: [{ outer: [{ x: 0, y: 0 }], holes: [] }],
        bboxMm: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        pointCount: 1,
        sourceMmPerPx: 0.1,
      }),
    ).toThrow(); // a 1-point ring encloses nothing
  });
});

describe("transformOutlinePlacement", () => {
  it("rotates 90° CCW in the y-up frame: (1, 0) → (0, 1)", () => {
    const outline: Outline = [
      {
        outer: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        holes: [],
      },
    ];
    const turned = transformOutlinePlacement(outline, {
      position: { x: 0, y: 0 },
      rotationDeg: 90,
      mirrored: false,
    });
    const [, second] = turned[0].outer;
    // Whichever index (1,0) landed at, it must now be (0,1).
    const points = turned[0].outer.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`);
    expect(points).toContain("0.000000,1.000000");
    expect(second).toBeDefined();
  });

  it("translates after rotating", () => {
    const outline: Outline = [
      {
        outer: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 1 },
        ],
        holes: [],
      },
    ];
    const placed = transformOutlinePlacement(outline, {
      position: { x: 10, y: 20 },
      rotationDeg: 180,
      mirrored: false,
    });
    const xs = placed[0].outer.map((p) => p.x);
    // (1,0) rotated 180° → (−1, 0), translated → (9, 20).
    expect(Math.min(...xs)).toBeCloseTo(8, 9);
    expect(Math.max(...xs)).toBeCloseTo(9, 9);
  });

  it("mirroring preserves the ring orientation invariant (mirrored-STL class)", () => {
    const mirrored = transformOutlinePlacement(CHIRAL, {
      position: { x: 5, y: -3 },
      rotationDeg: 37,
      mirrored: true,
    });
    expect(signedArea(mirrored[0].outer)).toBeGreaterThan(0);
    expect(signedArea(mirrored[0].holes[0])).toBeLessThan(0);
    // And the area magnitude is unchanged by the rigid transform + mirror.
    expect(Math.abs(signedArea(mirrored[0].outer))).toBeCloseTo(
      Math.abs(signedArea(CHIRAL[0].outer)),
      9,
    );
  });

  it("mirror is about the shape's own y axis, before rotation", () => {
    const outline: Outline = [
      {
        outer: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 1 },
        ],
        holes: [],
      },
    ];
    const placed = transformOutlinePlacement(outline, {
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      mirrored: true,
    });
    const xs = placed[0].outer.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-2, 9);
    expect(Math.max(...xs)).toBeCloseTo(0, 9);
  });
});

describe("resolvePocketDepth", () => {
  const spec = { heightUnits: 6, lip: "standard" as const };

  it("remaining measures the floor from the bin bottom (default → base top)", () => {
    const pocket = resolvePocketDepth(spec, {
      mode: "remaining",
      floorThicknessMm: BASE_HEIGHT,
    });
    expect(pocket.infillTopZ).toBeCloseTo(42 - 1.2, 9);
    expect(pocket.floorZ).toBeCloseTo(7, 9);
    expect(pocket.depthMm).toBeCloseTo(33.8, 9);
    expect(pocket.cutterTopZ).toBeGreaterThan(42);
  });

  it("mm measures down from the infill top", () => {
    const pocket = resolvePocketDepth(spec, { mode: "mm", value: 10 });
    expect(pocket.floorZ).toBeCloseTo(40.8 - 10, 9);
    expect(pocket.depthMm).toBeCloseTo(10, 9);
  });

  it("through has no floor", () => {
    const pocket = resolvePocketDepth(spec, { mode: "through" });
    expect(pocket.floorZ).toBeNull();
    expect(pocket.depthMm).toBeNull();
  });

  it("no lip raises the infill top to the rim", () => {
    const pocket = resolvePocketDepth(
      { heightUnits: 6, lip: "none" },
      { mode: "mm", value: 5 },
    );
    expect(pocket.infillTopZ).toBeCloseTo(42, 9);
  });
});

describe("interior geometry and the view flip", () => {
  it("computes the cavity footprint", () => {
    const interior = binInteriorMm(SPEC_2X3);
    expect(interior.widthMm).toBeCloseTo(83.5 - 1.9, 9);
    expect(interior.lengthMm).toBeCloseTo(125.5 - 1.9, 9);
    expect(interior.cornerRadiusMm).toBeCloseTo(2.8, 9);
  });

  it("signed distance: centre positive, boundary zero, corners rounded", () => {
    expect(signedDistanceToInterior({ x: 0, y: 0 }, SPEC_2X3)).toBeCloseTo(40.8, 9);
    // On the flat right boundary.
    expect(signedDistanceToInterior({ x: 40.8, y: 0 }, SPEC_2X3)).toBeCloseTo(0, 9);
    // Corner: the sharp-corner point is outside the rounded interior.
    expect(signedDistanceToInterior({ x: 40.8, y: 61.8 }, SPEC_2X3)).toBeLessThan(0);
    // The rounded-corner arc point at 45°.
    const cx = 40.8 - 2.8;
    const cy = 61.8 - 2.8;
    const onArc = {
      x: cx + 2.8 * Math.SQRT1_2,
      y: cy + 2.8 * Math.SQRT1_2,
    };
    expect(signedDistanceToInterior(onArc, SPEC_2X3)).toBeCloseTo(0, 9);
  });

  it("binToCanvas flips y only for the view and round-trips", () => {
    const binPoint = { x: -10, y: 25 };
    const canvas = binToCanvas(binPoint, SPEC_2X3);
    expect(canvas).toEqual({ x: 83.5 / 2 - 10, y: 125.5 / 2 - 25 });
    expect(canvasToBin(canvas, SPEC_2X3)).toEqual(binPoint);
    // The bin centre lands at the canvas centre.
    expect(binToCanvas({ x: 0, y: 0 }, SPEC_2X3)).toEqual({ x: 41.75, y: 62.75 });
  });
});

describe("typed finger holes (straight and scoop)", () => {
  it("defaults to no features and parses old documents unchanged", () => {
    const parsed = parseCutoutPlacement({
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
    });
    expect(parsed.fingerHoles).toEqual([]);
  });

  it("fills per-hole defaults and migrates the legacy one-off scoop", () => {
    const parsed = parseCutoutPlacement({
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
      fingerHoles: [{ id: "f1", center: { x: 5, y: 0 } }],
      scoop: { center: { x: -5, y: 0 } },
    });
    expect(parsed.fingerHoles[0].diameterMm).toBe(18);
    expect(parsed.fingerHoles[0].kind).toBe("straight");
    expect(parsed.fingerHoles[1]).toMatchObject({
      id: "legacy-scoop",
      kind: "scoop",
      center: { x: -5, y: 0 },
      diameterMm: 30,
      depthMm: 12,
    });
  });

  it("point transform matches the outline transform and round-trips", () => {
    const placement = {
      position: { x: 7, y: -3 },
      rotationDeg: 37,
      mirrored: true,
    };
    // The outline transform is the established source of truth; the point
    // transform must be the same map.
    const viaOutline = transformOutlinePlacement(
      [{ outer: [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 6 }], holes: [] }],
      placement,
    )[0].outer;
    const viaPoint = transformPointPlacement({ x: 2, y: 5 }, placement);
    const match = viaOutline.some(
      (p) => Math.abs(p.x - viaPoint.x) < 1e-12 && Math.abs(p.y - viaPoint.y) < 1e-12,
    );
    expect(match).toBe(true);

    const back = untransformPointPlacement(viaPoint, placement);
    expect(back.x).toBeCloseTo(2, 12);
    expect(back.y).toBeCloseTo(5, 12);
  });

  it("footprint carries features through rotation", () => {
    const shape = { outlineMm: CHIRAL };
    const footprint = placementFootprint(shape, {
      position: { x: 0, y: 0 },
      rotationDeg: 90,
      mirrored: false,
      fingerHoles: [
        {
          id: "f1",
          center: { x: 10, y: 0 },
          diameterMm: 6,
          kind: "straight",
          depthMm: 12,
        },
      ],
    });
    expect(footprint.features).toHaveLength(1);
    // (10, 0) rotated 90° CCW lands at (0, 10); the rim is 3 mm around it.
    const xs = footprint.features[0].map((p) => p.x);
    const ys = footprint.features[0].map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-3, 9);
    expect(Math.max(...xs)).toBeCloseTo(3, 9);
    expect(Math.min(...ys)).toBeCloseTo(7, 9);
    expect(Math.max(...ys)).toBeCloseTo(13, 9);
  });

  it("uses a round plan-view footprint for a deep scoop", () => {
    const footprint = placementFootprint({ outlineMm: CHIRAL }, {
      position: { x: 0, y: 0 },
      rotationDeg: 90,
      mirrored: false,
      fingerHoles: [
        {
          id: "f1",
          center: { x: 10, y: 0 },
          diameterMm: 6,
          kind: "deep-scoop",
          depthMm: 20,
        },
      ],
    });
    const xs = footprint.features[0].map((point) => point.x);
    const ys = footprint.features[0].map((point) => point.y);
    // Local (10, 0) becomes bin (0, 10) after the 90° placement.
    expect(Math.min(...xs)).toBeCloseTo(-3, 9);
    expect(Math.max(...xs)).toBeCloseTo(3, 9);
    expect(Math.min(...ys)).toBeCloseTo(7, 9);
    expect(Math.max(...ys)).toBeCloseTo(13, 9);
    expect(signedArea(footprint.features[0])).toBeGreaterThan(0);
  });

  it("clamps the scoop to a hemisphere", () => {
    expect(effectiveScoopDepthMm({ diameterMm: 30, depthMm: 12 })).toBe(12);
    expect(effectiveScoopDepthMm({ diameterMm: 20, depthMm: 25 })).toBe(10);
  });

  it("keeps a deep scoop at least one radius deep", () => {
    expect(effectiveDeepScoopDepthMm({ diameterMm: 18, depthMm: 30 })).toBe(30);
    expect(effectiveDeepScoopDepthMm({ diameterMm: 18, depthMm: 4 })).toBe(9);
  });
});
