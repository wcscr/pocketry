import { signedArea } from "../geometry/rings";
import { describe, expect, it } from "vitest";

import {
  boundaryEdges,
  edgeForWall,
  footprintInteriorRingMm,
  footprintOuterRingMm,
  footprintTopologyError,
  normalizeCustomFootprint,
  occupiedCellCount,
  resolveBoundaryRun,
} from "./footprint";
import { parseBinSpec } from "./types";

const L_SPEC = parseBinSpec({
  gridX: 2,
  gridY: 2,
  heightUnits: 6,
  footprint: {
    kind: "custom",
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  },
});

describe("footprint topology", () => {
  it("accepts a connected L and rejects disconnected cells and holes", () => {
    expect(footprintTopologyError(2, 2, L_SPEC.footprint.kind === "custom" ? L_SPEC.footprint.cells : [])).toBeNull();
    expect(footprintTopologyError(2, 2, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toMatch(/share edges/);
    expect(footprintTopologyError(3, 3, [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 },                 { x: 2, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ])).toMatch(/hole/);
  });

  it("normalizes an offset mask and reports its lattice shift", () => {
    expect(normalizeCustomFootprint([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 2, y: 4 }])).toEqual({
      gridX: 2,
      gridY: 2,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      shiftCells: { x: -2, y: -3 },
    });
  });
});

describe("footprint perimeter", () => {
  it("emits positive, bounded outer and inner L rings", () => {
    const outer = footprintOuterRingMm(L_SPEC, 64);
    const inner = footprintInteriorRingMm(L_SPEC, 64);
    expect(signedArea(outer)).toBeGreaterThan(0);
    expect(signedArea(inner)).toBeGreaterThan(0);
    expect(Math.max(...outer.map((point) => point.x))).toBeCloseTo(41.75, 6);
    expect(Math.min(...outer.map((point) => point.x))).toBeCloseTo(-41.75, 6);
    expect(Math.max(...outer.map((point) => point.y))).toBeCloseTo(41.75, 6);
    expect(Math.abs(signedArea(inner))).toBeLessThan(Math.abs(signedArea(outer)));
    expect(occupiedCellCount(L_SPEC)).toBe(3);
  });

  it("resolves a selected unit edge to the full straight run", () => {
    const northWest = { cell: { x: 0, y: 1 }, side: "north" as const };
    const run = resolveBoundaryRun(L_SPEC, northWest)!;
    expect(run.cells).toEqual([{ x: 0, y: 1 }]);
    expect(run.lengthMm).toBeCloseTo(41.5, 9);
    expect(boundaryEdges(L_SPEC)).toHaveLength(8);
    expect(edgeForWall(L_SPEC, "north")).toEqual(northWest);
    expect(edgeForWall(L_SPEC, "east")).toEqual({
      cell: { x: 1, y: 0 },
      side: "east",
    });
  });
});
