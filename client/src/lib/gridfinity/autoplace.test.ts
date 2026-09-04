import type { TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateLayout } from "@shared/gridfinity/validate";
import { describe, expect, it } from "vitest";

import {
  autoArrangeLayout,
  autoPlaceFresh,
  autoPlaceIncremental,
  fitLayoutToPlacements,
  fitFootprintToPlacements,
  fitRectangularBinToPlacements,
  placementInsetMm,
} from "./autoplace";

function rectShape(id: string, width: number, height: number): TracedShape {
  const hw = width / 2;
  const hh = height / 2;
  return {
    id,
    name: id,
    outlineMm: [
      {
        outer: [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: -hw, minY: -hh, maxX: hw, maxY: hh },
    pointCount: 4,
    sourceMmPerPx: 0.2,
  };
}

describe("placementInsetMm", () => {
  it("accounts for wall, clearance, lip intrusion and slack", () => {
    expect(placementInsetMm("standard")).toBeCloseTo(0.95 + 1.65 + 1, 9);
    expect(placementInsetMm("none")).toBeCloseTo(0.95 + 1, 9);
  });
});

describe("autoPlaceFresh", () => {
  it("centres a single shape in the smallest fitting bin", () => {
    // 60×20 tool: needs interior ≥ 60+2·inset ≈ 68 → 2 cells wide, 1 deep.
    const result = autoPlaceFresh([rectShape("s1", 60, 20)], "standard");
    expect(result.gridX).toBe(2);
    expect(result.gridY).toBe(1);
    expect(result.overflow).toBe(false);
    expect(result.cutouts).toHaveLength(1);
    expect(result.cutouts[0].position.x).toBeCloseTo(0, 9);
    expect(result.cutouts[0].position.y).toBeCloseTo(0, 9);
  });

  it("packs multiple shapes with a printable divider and stays valid", () => {
    const shapes = [rectShape("a", 30, 12), rectShape("b", 30, 12), rectShape("c", 18, 10)];
    const result = autoPlaceFresh(shapes, "standard");
    expect(result.overflow).toBe(false);
    expect(result.cutouts).toHaveLength(3);

    const spec = parseBinSpec({
      gridX: result.gridX,
      gridY: result.gridY,
      heightUnits: 6,
      fill: "solid",
    });
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    const issues = validateLayout(spec, result.cutouts, byId);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);

    // Smallest bin that fits: two cells (whichever orientation packs).
    expect(result.gridX * result.gridY).toBe(2);

    // Every pair keeps at least the 2 mm packing gap between bboxes.
    const boxes = result.cutouts.map((cutout) => {
      const shape = shapes.find((s) => s.id === cutout.shapeId)!;
      return {
        minX: cutout.position.x + shape.bboxMm.minX,
        maxX: cutout.position.x + shape.bboxMm.maxX,
        minY: cutout.position.y + shape.bboxMm.minY,
        maxY: cutout.position.y + shape.bboxMm.maxY,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const gap = Math.max(
          boxes[i].minX - boxes[j].maxX,
          boxes[j].minX - boxes[i].maxX,
          boxes[i].minY - boxes[j].maxY,
          boxes[j].minY - boxes[i].maxY,
        );
        expect(gap).toBeGreaterThanOrEqual(1.2 - 1e-9);
      }
    }
  });

  it("reports overflow for an impossible shape without dropping it", () => {
    const result = autoPlaceFresh([rectShape("s1", 1000, 20)], "standard");
    expect(result.overflow).toBe(true);
    expect(result.cutouts).toHaveLength(1);
  });

  it("sizes and validates placements in quarter-pitch cells", () => {
    const shape = rectShape("small", 12, 6);
    const result = autoPlaceFresh([shape], "none", "quarter");
    expect(result).toMatchObject({ gridX: 2, gridY: 1, overflow: false });
    const spec = parseBinSpec({
      gridX: result.gridX,
      gridY: result.gridY,
      gridPitch: "quarter",
      heightUnits: 3,
    });
    const errors = validateLayout(
      spec,
      result.cutouts,
      new Map([[shape.id, shape]]),
    ).filter((issue) => issue.severity === "error");
    expect(errors).toEqual([]);
  });

  it("property: fresh placements never produce validation errors", () => {
    for (const count of [1, 2, 4, 6]) {
      const shapes = Array.from({ length: count }, (_, i) =>
        rectShape(`s${i}`, 15 + i * 7, 8 + (i % 3) * 9),
      );
      const result = autoPlaceFresh(shapes, "standard");
      expect(result.overflow).toBe(false);
      const spec = parseBinSpec({
        gridX: result.gridX,
        gridY: result.gridY,
        heightUnits: 6,
        fill: "solid",
      });
      const byId = new Map(shapes.map((shape) => [shape.id, shape]));
      const errors = validateLayout(spec, result.cutouts, byId).filter(
        (issue) => issue.severity === "error",
      );
      expect(errors).toEqual([]);
    }
  });
});

describe("autoPlaceIncremental", () => {
  it("places a newcomer beside existing cutouts without moving them", () => {
    const existingShape = rectShape("old", 20, 20);
    const seeded = autoPlaceFresh([existingShape], "standard");
    const byId = new Map([[existingShape.id, existingShape]]);

    const newcomer = rectShape("new", 15, 15);
    const result = autoPlaceIncremental([newcomer], {
      lip: "standard",
      gridX: seeded.gridX,
      gridY: seeded.gridY,
      existing: seeded.cutouts,
      shapesById: byId,
    });

    expect(result.cutouts).toHaveLength(1);
    expect(result.gridX).toBeGreaterThanOrEqual(seeded.gridX);
    // Everything valid together.
    const spec = parseBinSpec({
      gridX: result.gridX,
      gridY: result.gridY,
      heightUnits: 6,
      fill: "solid",
    });
    byId.set(newcomer.id, newcomer);
    const errors = validateLayout(
      spec,
      [...seeded.cutouts, ...result.cutouts],
      byId,
    ).filter((issue) => issue.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("fitLayoutToPlacements", () => {
  it("shrinks the grid to the smallest that contains the placements", () => {
    const shape = rectShape("s1", 20, 20);
    const placed = autoPlaceFresh([shape], "standard");
    const byId = new Map([[shape.id, shape]]);
    // Pretend the user had a huge bin: fitting brings it back down.
    const fitted = fitLayoutToPlacements(placed.cutouts, byId, "standard");
    expect(fitted.gridX).toBe(1);
    expect(fitted.gridY).toBe(1);
    expect(fitted.cutouts[0].position).toEqual({ x: 0, y: 0 });
  });

  it("recentres an off-centre survivor so the grid can shrink", () => {
    const shape = rectShape("s1", 20, 20);
    const placed = autoPlaceFresh([shape], "standard");
    placed.cutouts[0] = { ...placed.cutouts[0], position: { x: 30, y: 0 } };
    const byId = new Map([[shape.id, shape]]);
    const fitted = fitLayoutToPlacements(placed.cutouts, byId, "standard");
    expect(fitted.gridX).toBe(1);
    expect(fitted.gridY).toBe(1);
    expect(fitted.cutouts[0].position).toEqual({ x: 0, y: 0 });
  });

  it("shrinks after one of two auto-placed parts is removed", () => {
    const shapes = [rectShape("a", 30, 20), rectShape("b", 30, 20)];
    const placed = autoPlaceFresh(shapes, "standard");
    expect(placed.gridX * placed.gridY).toBe(2);

    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    const fitted = fitLayoutToPlacements(placed.cutouts.slice(1), byId, "standard");
    expect(fitted.gridX).toBe(1);
    expect(fitted.gridY).toBe(1);
    expect(fitted.cutouts[0].position).toEqual({ x: 0, y: 0 });
  });

  it("fits and recentres an independent finger hole without a tool pocket", () => {
    const hole = {
      id: "f1",
      center: { x: 30, y: -12 },
      diameterMm: 18,
      kind: "straight" as const,
      depthMm: 12,
    };
    const fitted = fitLayoutToPlacements(
      [],
      new Map(),
      "standard",
      "full",
      [hole],
    );

    expect(fitted.cutouts).toEqual([]);
    expect(fitted.fingerHoles[0].center).toEqual({ x: 0, y: 0 });
    expect(fitted.gridX).toBe(1);
    expect(fitted.gridY).toBe(1);
  });
});

describe("fitFootprintToPlacements", () => {
  it("trims the unused corner around an L-shaped pocket", () => {
    const shape: TracedShape = {
      id: "l-tool",
      name: "L tool",
      outlineMm: [{
        outer: [
          { x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: -5 },
          { x: -5, y: -5 }, { x: -5, y: 30 }, { x: -30, y: 30 },
        ],
        holes: [],
      }],
      bboxMm: { minX: -30, minY: -30, maxX: 30, maxY: 30 },
      pointCount: 6,
      sourceMmPerPx: 0.2,
    };
    const byId = new Map([[shape.id, shape]]);
    const cutout = {
      id: "c-l",
      shapeId: shape.id,
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      mirrored: false,
      scaleX: 1,
      scaleY: 1,
      aspectRatioLocked: true,
      depth: { mode: "remaining" as const, floorThicknessMm: 7 },
      clearanceMm: 0,
      cornerRoundMm: 1,
      topFilletMm: 0,
      bottomFilletMm: 2.8,
      fingerHoles: [],
    };
    const result = fitFootprintToPlacements(
      [cutout],
      byId,
      parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
    );
    expect(result.gridX).toBe(2);
    expect(result.gridY).toBe(2);
    expect(result.footprint.kind).toBe("custom");
    if (result.footprint.kind === "custom") expect(result.footprint.cells).toHaveLength(3);
    const fittedSpec = parseBinSpec({
      gridX: result.gridX,
      gridY: result.gridY,
      heightUnits: 6,
      fill: "solid",
      footprint: result.footprint,
    });
    expect(validateLayout(fittedSpec, result.cutouts, byId)).toEqual([]);
  });
});

describe("fitRectangularBinToPlacements", () => {
  it("keeps automatic fitting rectangular while irregular footprints remain opt-in", () => {
    const shape = rectShape("small", 35, 35);
    const byId = new Map([[shape.id, shape]]);
    const cutout = {
      ...autoPlaceFresh([shape], "standard").cutouts[0],
      position: { x: -20, y: -20 },
    };
    const result = fitRectangularBinToPlacements(
      [cutout],
      byId,
      parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
    );

    expect(result.footprint).toEqual({ kind: "rectangle" });
  });
});

describe("autoArrangeLayout", () => {
  /** A rectangle pre-rotated in its own local frame — OBB bait. */
  function diagonalShape(id: string, width: number, height: number, deg: number): TracedShape {
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const base = rectShape(id, width, height);
    const outer = base.outlineMm[0].outer.map((p) => ({
      x: p.x * cos - p.y * sin,
      y: p.x * sin + p.y * cos,
    }));
    const xs = outer.map((p) => p.x);
    const ys = outer.map((p) => p.y);
    return {
      ...base,
      outlineMm: [{ outer, holes: [] }],
      bboxMm: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      },
    };
  }

  it("lays diagonal shapes down and beats their axis-aligned grid", () => {
    // Two 50×10 rectangles stored at 45°: axis-aligned they need a huge bin;
    // laid flat they share a 2-row block.
    const shapes = [diagonalShape("s1", 50, 10, 45), diagonalShape("s2", 50, 10, -45)];
    const aligned = autoPlaceFresh(shapes, "standard");

    const placed = aligned.cutouts;
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    const arranged = autoArrangeLayout(placed, byId, "standard")!;

    expect(arranged).not.toBeNull();
    expect(arranged.overflow).toBe(false);
    expect(arranged.gridX * arranged.gridY).toBeLessThan(aligned.gridX * aligned.gridY);
    // Same cutout identities, new orientation.
    expect(arranged.cutouts.map((c) => c.id).sort()).toEqual(
      placed.map((c) => c.id).sort(),
    );

    const spec = parseBinSpec({
      gridX: arranged.gridX,
      gridY: arranged.gridY,
      heightUnits: 6,
      fill: "solid",
    });
    const errors = validateLayout(spec, arranged.cutouts, byId).filter(
      (issue) => issue.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  it("keeps features, depth and mirroring while re-orienting", () => {
    const shapes = [diagonalShape("s1", 40, 12, 30)];
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    const fresh = autoPlaceFresh(shapes, "standard");
    const withExtras = fresh.cutouts.map((cutout) => ({
      ...cutout,
      mirrored: true,
      depth: { mode: "mm" as const, value: 9 },
      fingerHoles: [
        {
          id: "f1",
          center: { x: 10, y: 0 },
          diameterMm: 14,
          kind: "straight" as const,
          depthMm: 12,
        },
      ],
    }));

    const arranged = autoArrangeLayout(withExtras, byId, "standard")!;
    expect(arranged.cutouts[0].mirrored).toBe(true);
    expect(arranged.cutouts[0].depth).toEqual({ mode: "mm", value: 9 });
    expect(arranged.cutouts[0].fingerHoles).toHaveLength(1);
    // The 30° bake-in is undone (mirroring flips the sign): ±30° modulo the
    // OBB's 180° ambiguity.
    const angle = Math.abs(arranged.cutouts[0].rotationDeg);
    expect(Math.min(angle, Math.abs(angle - 180))).toBeCloseTo(30, 6);
  });

  it("keeps a fixed independent finger hole inside the auto-arranged bin", () => {
    const shape = rectShape("s1", 20, 10);
    const byId = new Map([[shape.id, shape]]);
    const placed = autoPlaceFresh([shape], "standard").cutouts;
    const hole = {
      id: "f1",
      center: { x: 50, y: 0 },
      diameterMm: 18,
      kind: "deep-scoop" as const,
      depthMm: 18,
    };

    const arranged = autoArrangeLayout(
      placed,
      byId,
      "standard",
      "full",
      [hole],
    )!;
    const spec = parseBinSpec({
      gridX: arranged.gridX,
      gridY: arranged.gridY,
      heightUnits: 6,
      fill: "solid",
    });
    const boundaryErrors = validateLayout(spec, arranged.cutouts, byId, [hole])
      .filter((issue) => issue.code === "finger-hole-out-of-bounds" ||
        issue.code === "finger-hole-wall-breach");

    expect(arranged.gridX).toBeGreaterThan(1);
    expect(boundaryErrors).toEqual([]);
    expect(hole.center).toEqual({ x: 50, y: 0 });
  });

  it("property: arranged layouts of feature-laden cutouts stay error-free", () => {
    const shapes = [
      diagonalShape("s1", 45, 10, 17),
      diagonalShape("s2", 30, 14, -63),
      diagonalShape("s3", 22, 22, 5),
      diagonalShape("s4", 36, 9, 80),
    ];
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    const fresh = autoPlaceFresh(shapes, "standard");
    const withFeatures = fresh.cutouts.map((cutout, i) => ({
      ...cutout,
      fingerHoles: [
        {
          id: `f${i}`,
          center: { x: i % 2 === 0 ? 0 : 5, y: 0 },
          diameterMm: i % 2 === 0 ? 16 : 22,
          kind: i % 2 === 0 ? ("straight" as const) : ("scoop" as const),
          depthMm: i % 2 === 0 ? 12 : 8,
        },
      ],
    }));

    const arranged = autoArrangeLayout(withFeatures, byId, "standard")!;
    expect(arranged.overflow).toBe(false);
    const spec = parseBinSpec({
      gridX: arranged.gridX,
      gridY: arranged.gridY,
      heightUnits: 6,
      fill: "solid",
    });
    const errors = validateLayout(spec, arranged.cutouts, byId).filter(
      (issue) => issue.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  it("returns null with nothing to arrange or a dangling shape", () => {
    expect(autoArrangeLayout([], new Map(), "standard")).toBeNull();
    const shapes = [rectShape("s1", 20, 10)];
    const fresh = autoPlaceFresh(shapes, "standard");
    expect(autoArrangeLayout(fresh.cutouts, new Map(), "standard")).toBeNull();
  });
});
