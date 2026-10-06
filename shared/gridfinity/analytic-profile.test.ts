import { describe, expect, it } from "vitest";
import { createBasicPocket } from "../../client/src/lib/gridfinity/basic-shape";
import { reviseTracedShape } from "../../client/src/lib/gridfinity/contour-edit";
import { parseBinSpec } from "./types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";
import { analyticProfileMatchesOutline, inferLegacyAnalyticProfile } from "./analytic-profile";
import { tracedShapeSchema } from "./cutout";

describe("analytic profile provenance", () => {
  it.each(["rectangle", "square", "circle"] as const)("retains %s intent in shapes, project serialization and history", kind => {
    const { shape, cutout } = createBasicPocket(kind, { x: 0, y: 0 }, { x: 10, y: 8 }, kind)!;
    expect(shape.analyticProfile?.kind).toBe(kind === "circle" ? "circle" : "rectangle");
    expect(analyticProfileMatchesOutline(shape)).toBe(true);
    expect(tracedShapeSchema.parse(JSON.parse(JSON.stringify(shape)))).toEqual(shape);
    const material = { spec: parseBinSpec({gridX:2,gridY:2,heightUnits:6}), cutouts: [cutout], fingerHoles: [] };
    const project = { ...material, shapes: [shape], schemaVersion: PROJECT_SCHEMA_VERSION,
      history: { stack: [{ doc: material, label: "Create" }], index: 0 } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(project))))).toEqual(project);
    const { analyticProfile: _profile, ...legacy } = shape;
    const restored = parseProjectDoc({ ...project, schemaVersion: 35, shapes: [legacy] })!;
    expect(restored.shapes[0]).toEqual(shape);
    expect(restored.history).toEqual(project.history);
  });
  it("contour revisions discard metadata, without changing the original or guessing it back in schema 36", () => {
    const { shape, cutout } = createBasicPocket("circle", { x: 0, y: 0 }, { x: 10, y: 0 }, "circle")!;
    const revision = reviseTracedShape(shape, shape.outlineMm, "revision");
    expect(revision.analyticProfile).toBeUndefined();
    expect(shape.analyticProfile).toEqual({ kind: "circle", radiusMm: 10 });
    const doc = parseProjectDoc({ schemaVersion: 36, spec: parseBinSpec({gridX:2,gridY:2,heightUnits:6}), shapes: [revision],
      cutouts: [{ ...cutout, shapeId: revision.id }], fingerHoles: [] })!;
    expect(doc.shapes[0].analyticProfile).toBeUndefined();
    expect(doc.shapes[0].outlineMm).toEqual(shape.outlineMm);
  });
  it("never promotes a trace, holes, modified points or conflicting metadata", () => {
    const { shape } = createBasicPocket("rectangle", { x: 0, y: 0 }, { x: 10, y: 8 }, "rect")!;
    expect(inferLegacyAnalyticProfile({ ...shape, source: "trace" })).toBeUndefined();
    const edited = { ...shape, outlineMm: [{ ...shape.outlineMm[0], outer: shape.outlineMm[0].outer.map((p, i) => i === 1 ? { ...p, x: p.x + 0.1 } : p) }] };
    expect(inferLegacyAnalyticProfile(edited)).toBeUndefined();
    expect(analyticProfileMatchesOutline(edited)).toBe(false);
    expect(analyticProfileMatchesOutline({ ...shape, analyticProfile: { kind: "circle", radiusMm: 4 } })).toBe(false);
  });
});
