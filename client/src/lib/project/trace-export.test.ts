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
    expect(shape.outlineMm[0].holes).toHaveLength(1);
    expect(shape.outlineMm[0].holes[0]).toContainEqual({ x: -10, y: 5 });
    expect(shape.sourceMmPerPx).toBe(0.5);
    expect(shape.traceMarginMm).toBe(0.75);
    expect(restored.cutouts[0].shapeId).toBe(shape.id);
    expect(restored.cutouts[0].scaleX).toBe(1);
    expect(restored.cutouts[0].scaleY).toBe(1);
    expect(outline).toEqual(original);
  });

  it("rejects an uncalibrated outline instead of inventing a physical scale", () => {
    expect(() => projectFromTrace(outline, { mmPerPx: null, imageHeight: 100 }, "Tool", 0))
      .toThrow("Set the scale");
  });
});
