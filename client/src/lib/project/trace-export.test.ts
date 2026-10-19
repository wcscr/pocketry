import { describe, expect, it } from "vitest";

import type { Outline } from "@shared/geometry/types";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { projectFromTrace } from "./trace-export";

const outline: Outline = [{
  outer: [{ x: 10, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 50 }, { x: 10, y: 50 }],
  holes: [[{ x: 20, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 20 }]],
}];

describe("editable project from a Trace export", () => {
  it("round trips the calibrated contour and its holes without changing the trace", () => {
    const original = structuredClone(outline);
    const project = projectFromTrace(outline, { mmPerPx: 0.5, imageHeight: 100 }, "Tool", 0.75);
    const restored = parseProjectDoc(JSON.parse(JSON.stringify(project)))!;
    const shape = restored.shapes[0];
    expect(shape.bboxMm).toEqual({ minX: -15, minY: -10, maxX: 15, maxY: 10 });
    expect(shape.outlineMm[0].holes).toHaveLength(0);
    const hole = restored.cutouts.find(c => c.role === "hole")!;
    const holeShape = restored.shapes.find(s => s.id === hole.shapeId)!;
    expect(holeShape.outlineMm[0].outer).toContainEqual({ x: -2.5, y: 2.5 });
    const pocket = restored.cutouts.find(c => c.role !== "hole")!;
    expect(hole.position.x - pocket.position.x).toBe(-7.5);
    expect(hole.position.y - pocket.position.y).toBe(2.5);
    expect(shape.sourceMmPerPx).toBe(0.5);
    expect(shape.traceMarginMm).toBe(0.75);
    expect(restored.cutouts[0].shapeId).toBe(shape.id);
    expect(restored.cutouts[0].scaleX).toBe(1);
    expect(restored.cutouts[0].scaleY).toBe(1);
    expect(outline).toEqual(original);
  });

  it("round trips nested and overlapping pockets as separate editable objects with the photo layout", () => {
    const nested = { outer: [{ x: 40, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 40 }, { x: 40, y: 40 }], holes: [] };
    const overlapping = { outer: outline[0].outer.map(p => ({ x: p.x + 40, y: p.y + 20 })), holes: [] };
    const traced = [outline[0], nested, overlapping];
    const original = structuredClone(traced);
    const project = projectFromTrace(traced, { mmPerPx: 0.5, imageHeight: 100 }, "Tool", 0.75);
    const restored = parseProjectDoc(JSON.parse(JSON.stringify(project)))!;
    expect(restored.shapes.map(shape => shape.name)).toEqual(["Tool", "Tool (2)", "Tool (3)", "Hole 1"]);
    expect(restored.shapes.every(shape => shape.outlineMm.length === 1 && shape.outlineMm[0].holes.length === 0)).toBe(true);
    const [outer, inner, overlap, hole] = restored.shapes.map(shape => restored.cutouts.find(cutout => cutout.shapeId === shape.id)!);
    expect([outer.role, inner.role, overlap.role, hole.role]).toEqual([undefined, undefined, undefined, "hole"]);
    expect({ x: inner.position.x - outer.position.x, y: inner.position.y - outer.position.y }).toEqual({ x: 5, y: 0 });
    expect({ x: overlap.position.x - outer.position.x, y: overlap.position.y - outer.position.y }).toEqual({ x: 20, y: -10 });
    expect({ x: hole.position.x - outer.position.x, y: hole.position.y - outer.position.y }).toEqual({ x: -7.5, y: 2.5 });
    expect(traced).toEqual(original);
  });

  it("rejects an empty trace instead of exporting an empty project", () => {
    expect(() => projectFromTrace([], { mmPerPx: 0.5, imageHeight: 100 }, "Tool", 0)).toThrow("Trace an outline");
  });

  it("rejects an uncalibrated outline instead of inventing a physical scale", () => {
    expect(() => projectFromTrace(outline, { mmPerPx: null, imageHeight: 100 }, "Tool", 0))
      .toThrow("Set the scale");
  });
});
