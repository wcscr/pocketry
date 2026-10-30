import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseBinSpec } from "@shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION, parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { prepareStepBin, writeStepBinPackage } from "./step-bin";
import { circleStepLoop, writeStep } from "./step";

function fixture(): ProjectDoc {
  const rectangle = createBasicPocket("rectangle", { x: -28, y: 8 }, { x: -10, y: 22 }, "rectangle")!;
  const circle = createBasicPocket("circle", { x: 16, y: -9 }, { x: 22, y: -9 }, "circle")!;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, name: "Driver tray",
    spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 4, flatBottom: true, lip: "none" }),
    shapes: [rectangle.shape, circle.shape], fingerHoles: [],
    cutouts: [{ ...rectangle.cutout, rotationDeg: 21, mirrored: true, scaleX: 0.8, depth: { mode: "mm", value: 12 } },
      { ...circle.cutout, name: "Rod's Ø12 🧰", depth: { mode: "through" } }],
  };
}

describe("analytic STEP bin export", () => {
  it("writes the final tray, named source cutters, object identities and original project", () => {
    const doc = fixture();
    const original = JSON.stringify(doc);
    const files = unzipSync(writeStepBinPackage(doc));
    expect(Object.keys(files).sort()).toEqual(["README.txt", "bin.step", "design-objects.step", "design.pocketry.json", "objects.json"]);
    const final = strFromU8(files["bin.step"]), objects = strFromU8(files["design-objects.step"]);
    expect(final.match(/MANIFOLD_SOLID_BREP\(/g)).toHaveLength(1);
    expect(objects.match(/MANIFOLD_SOLID_BREP\(/g)).toHaveLength(3);
    expect(objects).toContain("PRODUCT('cutout-circle','Rod''s ");
    expect(objects.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g)).toHaveLength(3);
    expect(objects).toContain("SI_UNIT(.MILLI.,.METRE.)");
    for (const content of [final, objects]) {
      expect(content).toContain("CIRCLE(");
      expect(content).toContain("CYLINDRICAL_SURFACE(");
      expect(content).toContain("PLANE(");
      expect(content).not.toMatch(/FACETED_BREP|TRIANGULATED|TESSELLATED|POLY_LOOP/);
      const declarations = new Set([...content.matchAll(/^#(\d+)=/gm)].map(match => match[1]));
      for (const reference of content.matchAll(/#(\d+)/g)) expect(declarations.has(reference[1])).toBe(true);
    }
    expect(parseProjectDoc(JSON.parse(strFromU8(files["design.pocketry.json"])))).toMatchObject(doc);
    expect(JSON.parse(strFromU8(files["objects.json"])).objects[2]).toMatchObject({ id: "cutout-circle", shapeId: "circle", name: doc.cutouts[1].name, role: "pocket-cutter" });
    expect(JSON.stringify(doc)).toBe(original);
    expect(writeStepBinPackage(doc)).toEqual(writeStepBinPackage(doc));
  });

  it("preserves placement coordinates, scale, handedness and mm/remaining/through depths", () => {
    const doc = fixture();
    const prepared = prepareStepBin(doc);
    expect(prepared.body.topZ).toBe(28);
    expect(prepared.cutters[0].bottomZ).toBe(16);
    expect(prepared.cutters[1].bottomZ).toBe(0);
    expect(prepared.cutters[1].loop[0]).toMatchObject({ kind: "arc", radius: 6, center: { x: 16, y: -9 } });
    const start = prepared.cutters[0].loop[0].start;
    expect(start.x).toBeCloseTo(-19 + 7.2 * Math.cos(21 * Math.PI / 180) - 7 * Math.sin(21 * Math.PI / 180));
    expect(start.y).toBeCloseTo(15 + 7.2 * Math.sin(21 * Math.PI / 180) + 7 * Math.cos(21 * Math.PI / 180));
    doc.cutouts[0].depth = { mode: "remaining", floorThicknessMm: 3 };
    expect(prepareStepBin(doc).cutters[0].bottomZ).toBe(3);
  });

  it("keeps traced circles and edited authored circles as their actual straight outlines", () => {
    const doc = fixture();
    doc.shapes[1].source = "trace";
    doc.shapes[1].sourceMmPerPx = 0.1;
    expect(prepareStepBin(doc).cutters[1].loop.every(segment => segment.kind === "line")).toBe(true);
    doc.shapes[1].source = "basic-shape";
    doc.shapes[1].outlineMm[0].outer[0].x += 0.1;
    expect(prepareStepBin(doc).cutters[1].loop.every(segment => segment.kind === "line")).toBe(true);
  });

  it.each([
    ["flatBottom", false, "Gridfinity feet"], ["lip", "standard", "Stacking rims"],
    ["fill", "none", "solid fill"], ["fillHeightPercent", 50, "solid fill"],
    ["magnetHoles", true, "hardware holes"], ["screwHoles", true, "hardware holes"],
  ] as const)("rejects unsupported bin setting %s", (key, value, message) => {
    const doc = fixture();
    Object.assign(doc.spec, { [key]: value });
    expect(() => writeStepBinPackage(doc)).toThrow(message);
  });

  it.each([
    { clearanceMm: 0.1 }, { cornerRoundMm: 1 }, { topFilletMm: 1 }, { bottomFilletMm: 1 },
    { elevationMm: 2 }, { tilt: { xDeg: 10, yDeg: 0 } }, { zOffsetMm: 1 },
  ])("rejects unsupported pocket settings %j", changes => {
    const doc = fixture();
    Object.assign(doc.cutouts[0], changes);
    expect(() => writeStepBinPackage(doc)).toThrow("STEP export is not available");
  });

  it("rejects overlaps, wall crossings, ellipses, missing shapes, self crossings and excessive detail", () => {
    let doc = fixture();
    doc.cutouts[1].position = { ...doc.cutouts[0].position };
    expect(() => prepareStepBin(doc)).toThrow("overlap or touch");
    doc = fixture(); doc.cutouts[1].position.x = 40;
    expect(() => prepareStepBin(doc)).toThrow("strictly inside");
    doc = fixture(); doc.cutouts[1].scaleY = 2;
    expect(() => prepareStepBin(doc)).toThrow("ellipse");
    doc = fixture(); doc.shapes.pop();
    expect(() => prepareStepBin(doc)).toThrow("missing");
    doc = fixture(); doc.shapes[0].outlineMm[0].outer = [
      { x: -9, y: -7 }, { x: 9, y: 7 }, { x: -9, y: 7 }, { x: 9, y: -7 },
    ];
    expect(() => prepareStepBin(doc)).toThrow("without touching or crossing");
    doc = fixture(); doc.shapes[1].outlineMm[0].outer = Array(2001).fill({ x: 1, y: 0 });
    expect(() => prepareStepBin(doc)).toThrow("outline vertices");
  });

  it("rejects a vanishingly thin floor instead of creating coincident CAD faces", () => {
    const doc = fixture(); doc.cutouts[0].depth = { mode: "remaining", floorThicknessMm: 1e-12 };
    expect(() => writeStepBinPackage(doc)).toThrow("CAD tolerance");
  });

  it("supports empty bins and quarter-pitch dimensions without manufacturing a pocket", () => {
    const doc = fixture(); doc.cutouts = []; doc.shapes = [];
    doc.spec.gridPitch = "quarter";
    const prepared = prepareStepBin(doc);
    expect(prepared.body.loop[2].start.x).toBe(10.25);
    expect(prepared.cutters).toHaveLength(0);
    expect(unzipSync(writeStepBinPackage(doc))["bin.step"]).toBeDefined();
  });

  it("escapes STEP names and rejects invalid numerical solids", () => {
    const body = { id: "test", name: "A'\\B\nØ", loop: circleStepLoop({ x: 0, y: 0 }, 2), bottomZ: 0, topZ: 4 };
    const content = writeStep([body], "Test");
    expect(content).toContain("A''\\X2\\005C\\X0\\B\\X2\\000A\\X0\\\\X2\\00D8\\X0\\");
    expect(() => writeStep([{ ...body, topZ: 0 }], "bad")).toThrow("positive height");
    expect(() => writeStep([{ ...body, topZ: Infinity }], "bad")).toThrow("finite");
  });
});
