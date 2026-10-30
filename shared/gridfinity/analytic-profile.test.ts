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
  it.each([36, PROJECT_SCHEMA_VERSION])("contour revisions discard metadata, without changing the original or guessing it back in current projects and the old schema-36 investigation (%i)", schemaVersion => {
    const { shape, cutout } = createBasicPocket("circle", { x: 0, y: 0 }, { x: 10, y: 0 }, "circle")!;
    const revision = reviseTracedShape(shape, shape.outlineMm, "revision");
    expect(revision.analyticProfile).toBeUndefined();
    expect(shape.analyticProfile).toEqual({ kind: "circle", radiusMm: 10 });
    const doc = parseProjectDoc({ schemaVersion, spec: parseBinSpec({gridX:2,gridY:2,heightUnits:6}), shapes: [revision],
      cutouts: [{ ...cutout, shapeId: revision.id }], fingerHoles: [] })!;
    expect(doc.shapes[0].analyticProfile).toBeUndefined();
    expect(doc.shapes[0].outlineMm).toEqual(shape.outlineMm);
  });

  it.each([18, 35])("recognizes only proven original primitives from legacy schema %i", schemaVersion => {
    const { shape } = createBasicPocket("circle", { x: 0, y: 0 }, { x: 7, y: 0 }, "legacy")!;
    const { analyticProfile: _profile, ...basic } = shape;
    const trace = { ...basic, id: "trace", source: "trace" as const };
    const edited = structuredClone(basic); edited.id = "edited"; edited.outlineMm[0].outer[1].x += 0.01;
    const input = { schemaVersion, spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), shapes: [basic, trace, edited], cutouts: [], fingerHoles: [] };
    const before = JSON.stringify(input);
    const doc = parseProjectDoc(input)!;
    expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc.shapes[0].analyticProfile).toEqual(shape.analyticProfile);
    expect(doc.shapes.map(s => s.outlineMm)).toEqual(input.shapes.map(s => s.outlineMm));
    expect(doc.shapes.slice(1).every(s => s.analyticProfile === undefined)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([36, 37, 48, 54])("preserves absent primitive intent after an edited version-36 shape is resaved as schema %i", schemaVersion => {
    const { shape, cutout } = createBasicPocket("circle", { x: 0, y: 0 }, { x: 10, y: 0 }, "circle")!;
    const revision = reviseTracedShape(shape, shape.outlineMm, "revision");
    const prototype = parseProjectDoc({ schemaVersion: 36, spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), shapes: [revision],
      cutouts: [{ ...cutout, shapeId: revision.id }], fingerHoles: [] })!;
    // Main can read the optional-free polygon and write it with its own newer
    // schema number. That does not restore the primitive removed by editing.
    const resavedByMain = { ...serializeProjectDoc(prototype), schemaVersion };
    const restored = parseProjectDoc(resavedByMain)!;
    expect(restored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(restored.shapes[0].analyticProfile).toBeUndefined();
    expect(restored.shapes[0].outlineMm).toEqual(shape.outlineMm);
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
