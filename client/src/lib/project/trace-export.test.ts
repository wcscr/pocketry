import { describe, expect, it } from "vitest";

import type { Outline } from "@shared/geometry/types";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { projectFromTrace } from "./trace-export";
import { curveControls, curvesFromOutline, editCurves, evaluateCurve, sampleCurves } from "@shared/geometry/curves";
import { signedArea } from "@shared/geometry/rings";
import { generateOutlineSVG } from "@/lib/export/svg";
import { reviseTracedShape } from "@/lib/gridfinity/contour-edit";
import { transformPointPlacement, untransformPointPlacement } from "@shared/gridfinity/cutout";

const outline: Outline = [{
  outer: [{ x: 10, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 50 }, { x: 10, y: 50 }],
  holes: [[{ x: 20, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 20 }]],
}];

describe("editable project from a Trace export", () => {
  it("round trips native curves, holes and later Bin revisions with one scale/Y conversion", () => {
    const ref = { shapeIndex: 0, ringIndex: -1 };
    const source = editCurves(curvesFromOutline(outline), ref, { kind: "bend", index: 0, t: 0.5, delta: { x: 0, y: -6 } });
    const project = projectFromTrace(outline, { mmPerPx: 0.5, imageHeight: 100 }, "Curve tool", 0, source);
    const restored = parseProjectDoc(JSON.parse(JSON.stringify(project)))!;
    const shape = restored.shapes[0];
    expect(shape.curvesMm).toEqual(project.shapes[0].curvesMm);
    expect(shape.curvesMm![0].outer).toHaveLength(4);
    expect(shape.curvesMm![0].holes).toHaveLength(1);
    expect(shape.outlineMm).toEqual(sampleCurves(shape.curvesMm!));
    expect(signedArea(shape.outlineMm[0].outer)).toBeGreaterThan(0);
    expect(signedArea(shape.outlineMm[0].holes[0])).toBeLessThan(0);
    const imageCurve = curveControls(source[0].outer, 0), modelCurve = curveControls(shape.curvesMm![0].outer, 2);
    // Compare displacements so the shared bbox-centering translation cancels.
    const imageStart = evaluateCurve(imageCurve, 0), modelStart = evaluateCurve(modelCurve, 1);
    for (let i = 0; i <= 20; i++) {
      const a = evaluateCurve(imageCurve, i / 20), b = evaluateCurve(modelCurve, 1 - i / 20);
      expect(b.x - modelStart.x).toBeCloseTo((a.x - imageStart.x) * 0.5, 9);
      expect(b.y - modelStart.y).toBeCloseTo(-(a.y - imageStart.y) * 0.5, 9);
    }
    const placement = { ...restored.cutouts[0], position: { x: 17, y: -9 }, rotationDeg: 37, mirrored: true, scaleX: 1.8, scaleY: 0.7 };
    const handle = shape.curvesMm![0].outer[2].out!;
    const local = untransformPointPlacement(transformPointPlacement(handle, placement), placement);
    expect(local.x).toBeCloseTo(handle.x, 9); expect(local.y).toBeCloseTo(handle.y, 9);
    const revisedCurves = editCurves(shape.curvesMm!, ref, { kind: "split", index: 2, t: 0.5 });
    const revision = reviseTracedShape(shape, shape.outlineMm, "new-revision", revisedCurves);
    const withRevision = { ...restored, shapes: [...restored.shapes, revision], cutouts: [{ ...placement, shapeId: revision.id }] };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(withRevision)))!.shapes.map(s => s.curvesMm))
      .toEqual([shape.curvesMm, revision.curvesMm]);
    expect(() => reviseTracedShape(shape, outline, "flattened")).toThrow("preserve");
    const svg = generateOutlineSVG(outline, { width: 100, height: 100, mmPerPx: 0.5, curves: source });
    expect(svg).toContain("C"); expect(svg).toContain('width="50mm"'); expect(svg).toContain('fill-rule="evenodd"');
  });

  it("rebuilds polygon caches on import and rejects malformed curve data", () => {
    const source = editCurves(curvesFromOutline(outline), { shapeIndex: 0, ringIndex: -1 }, { kind: "bend", index: 0, t: 0.5, delta: { x: 0, y: -6 } });
    const project = projectFromTrace(outline, { mmPerPx: 0.5, imageHeight: 100 }, "Curve tool", 0, source);
    const stale = { ...project, shapes: [{ ...project.shapes[0], outlineMm: outline, pointCount: 99 }] };
    const restored = parseProjectDoc(stale)!;
    expect(restored.shapes[0].outlineMm).toEqual(sampleCurves(restored.shapes[0].curvesMm!));
    expect(restored.shapes[0].pointCount).not.toBe(99);
    expect(parseProjectDoc({ ...project, shapes: [{ ...project.shapes[0], curvesMm: [{ outer: [{ point: { x: 0, y: 0 } }], holes: [] }] }] })).toBeNull();
    expect(parseProjectDoc({ ...project, shapes: [{ ...project.shapes[0], curvesMm: [] }] })).toBeNull();
  });
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
