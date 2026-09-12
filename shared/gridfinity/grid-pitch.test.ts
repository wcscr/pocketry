import { describe, expect, it } from "vitest";
import { boundaryEdges, footprintOuterRingMm, occupiedCellCount, resolveBoundaryRun } from "./footprint";
import { changeBinGridPitchPreservingSize } from "./grid-pitch";
import { parseBinSpec } from "./types";

const lShape = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6,
  footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });

describe("bin grid pitch conversion", () => {
  it("subdivides and combines a custom footprint without changing its physical perimeter", () => {
    const original = structuredClone(lShape);
    let current = lShape;
    for (const [pitch, count] of [["half", 12], ["quarter", 48], ["half", 12], ["full", 3]] as const) {
      const patch = changeBinGridPitchPreservingSize(current, pitch)!;
      expect(patch).not.toBeNull();
      current = parseBinSpec({ ...current, ...patch });
      expect(occupiedCellCount(current)).toBe(count);
      expect(footprintOuterRingMm(current, 32)).toEqual(footprintOuterRingMm(original, 32));
    }
    expect(current).toEqual(original);
    expect(lShape).toEqual(original);
    expect(changeBinGridPitchPreservingSize(lShape, "full")).not.toBeNull();
  });

  it("rejects a partial coarse cell even when the bounding dimensions fit", () => {
    const half = parseBinSpec({ ...lShape, gridPitch: "half" });
    expect(changeBinGridPitchPreservingSize(half, "full")).toBeNull();
    expect(changeBinGridPitchPreservingSize(half, "half")).not.toBeNull();
    const quarter = parseBinSpec({ ...half, ...changeBinGridPitchPreservingSize(half, "quarter") });
    expect(changeBinGridPitchPreservingSize(quarter, "full")).toBeNull();
    expect(parseBinSpec({ ...quarter, ...changeBinGridPitchPreservingSize(quarter, "half") })).toEqual(half);
  });

  it("keeps label tabs on the same outer or re-entrant boundary run", () => {
    for (const edge of boundaryEdges(lShape)) {
      const original = parseBinSpec({ ...lShape, labelTab: { wall: edge.side, edge, width: "center" } });
      const before = resolveBoundaryRun(original, edge)!;
      let current = original;
      for (const pitch of ["half", "quarter", "full"] as const) {
        current = parseBinSpec({ ...current, ...changeBinGridPitchPreservingSize(current, pitch) });
        const after = resolveBoundaryRun(current, current.labelTab!.edge!)!;
        expect(after).not.toBeNull();
        expect(after.start).toEqual(before.start);
        expect(after.end).toEqual(before.end);
        expect(after.lengthMm).toBe(before.lengthMm);
      }
    }
  });

  it("retains rectangular sizing and rejects dimensions between coarse grid lines", () => {
    const rectangle = parseBinSpec({ gridX: 3, gridY: 5, heightUnits: 6 });
    expect(changeBinGridPitchPreservingSize(rectangle, "quarter")).toMatchObject({ gridX: 12, gridY: 20, footprint: { kind: "rectangle" } });
    expect(changeBinGridPitchPreservingSize(parseBinSpec({ ...rectangle, gridPitch: "half" }), "full")).toBeNull();
  });
});
