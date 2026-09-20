import { describe, expect, it } from "vitest";
import { signedArea } from "@shared/geometry/rings";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { validateLayout } from "@shared/gridfinity/validate";
import { reviseTracedShape } from "./contour-edit";
import { basicPocketDimensions, createBasicPocket } from "./basic-shape";

describe("basic-shape pockets", () => {
  it("centres reverse-drawn rectangles and preserves exact dimensions and sharp corners", () => {
    const { shape, cutout } = createBasicPocket("rectangle", { x: 20, y: 12 }, { x: -10, y: -8 }, "rect")!;
    expect(shape.bboxMm).toEqual({ minX: -15, maxX: 15, minY: -10, maxY: 10 });
    expect(cutout.position).toEqual({ x: 5, y: 2 });
    expect(cutout).toMatchObject({ clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0, aspectRatioLocked: false });
    expect(signedArea(shape.outlineMm[0].outer)).toBe(600);
    expect(shape).toMatchObject({ source: "basic-shape", sourceMmPerPx: null });
  });

  it("draws squares in each direction and circles from centre to edge", () => {
    for (const x of [-8, 8]) for (const y of [-5, 5]) {
      expect(basicPocketDimensions("square", { x: 0, y: 0 }, { x, y })).toEqual({
        width: 8, length: 8, position: { x: Math.sign(x) * 4, y: Math.sign(y) * 4 },
      });
    }
    const { shape, cutout } = createBasicPocket("circle", { x: 3, y: 8 }, { x: 9, y: 16 }, "circle")!;
    expect(cutout.position).toEqual({ x: 3, y: 8 });
    expect(cutout.aspectRatioLocked).toBe(true);
    expect(shape.bboxMm).toEqual({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(signedArea(shape.outlineMm[0].outer)).toBeGreaterThan(313);
    const chordError = 10 * (1 - Math.cos(Math.PI / shape.pointCount));
    expect(chordError).toBeLessThanOrEqual(0.02);
    expect(createBasicPocket("square", { x: 0, y: 0 }, { x: 8, y: 5 }, "square")!.cutout.aspectRatioLocked).toBe(true);
  });

  it("rejects degenerate, submillimetre, and nonfinite drafts", () => {
    for (const end of [{ x: 0, y: 20 }, { x: 0.9, y: 20 }, { x: NaN, y: 4 }, { x: Infinity, y: 4 }]) {
      expect(createBasicPocket("rectangle", { x: 0, y: 0 }, end, "bad")).toBeNull();
    }
  });

  it("accepts authored mm without exempting uncalibrated traces or boundary conflicts", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 });
    const { shape, cutout } = createBasicPocket("square", { x: -10, y: -10 }, { x: 10, y: 10 }, "sq")!;
    const issues = (source = shape) => validateLayout(spec, [cutout], new Map([[shape.id, source]]));
    expect(issues().filter(issue => issue.severity === "error")).toEqual([]);
    expect(issues({ ...shape, source: undefined }).map(issue => issue.code)).toContain("uncalibrated-scale");
    expect(issues({ ...shape, source: "trace" }).map(issue => issue.code)).toContain("uncalibrated-scale");
    expect(validateLayout(spec, [{ ...cutout, position: { x: 60, y: 0 } }], new Map([[shape.id, shape]])).map(issue => issue.code)).toContain("out-of-bounds");
    const revision = reviseTracedShape(shape, shape.outlineMm, "revision");
    expect(issues(revision).map(issue => issue.code)).not.toContain("uncalibrated-scale");
  });

  it("round-trips mixed sources and their undo history, migrating v17 without inventing scale", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 });
    const { shape, cutout } = createBasicPocket("circle", { x: 0, y: 0 }, { x: 10, y: 0 }, "circle")!;
    const trace = { ...shape, id: "trace", source: undefined, sourceMmPerPx: 0.25 };
    const doc = { spec, cutouts: [cutout], fingerHoles: [] };
    const project = { ...doc, shapes: [shape, trace], schemaVersion: PROJECT_SCHEMA_VERSION,
      history: { stack: [{ doc: { ...doc, cutouts: [] }, label: "Start" }, { doc, label: "Add circle pocket" }], index: 1 } };
    const restored = parseProjectDoc(JSON.parse(JSON.stringify(project)))!;
    expect(restored.shapes[0]).toEqual(shape);
    expect(restored.shapes[1].sourceMmPerPx).toBe(0.25);
    expect(restored.history).toEqual(project.history);
    const legacy = { ...project, schemaVersion: 17, shapes: [trace], cutouts: [],
      history: { stack: [{ doc: { ...doc, cutouts: [] }, label: "Start" }], index: 0 } };
    expect(parseProjectDoc(legacy)).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, history: legacy.history });
    expect(parseProjectDoc({ ...legacy, history: project.history })).toBeNull();
  });
});
