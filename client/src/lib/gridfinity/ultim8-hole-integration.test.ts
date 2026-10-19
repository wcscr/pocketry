import { expect, it } from "vitest";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { DEFAULT_PEG_BOTTOM } from "@shared/gridfinity/peg-bottom";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { generateUltim8JigSVG } from "@/lib/export/layout";
import { withKernel } from "@/lib/manifold/runtime";
import { createBasicPocket } from "./basic-shape";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";

const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 8.5 / 7, lip: "none",
  arbitrarySizeMm: { width: 51, length: 31 }, pegBottom: { ...DEFAULT_PEG_BOTTOM, density: 1 } });
const opening = createBasicPocket("rectangle", { x: -23, y: -13 }, { x: -12, y: -5 }, "opening")!;
const retained = createBasicPocket("rectangle", { x: -24, y: -14 }, { x: -17, y: -4 }, "kept")!;
const pocket = parseCutoutPlacement({ ...opening.cutout, depth: { mode: "through" }, clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
const hole = parseCutoutPlacement({ ...retained.cutout, role: "hole", depth: { mode: "through" }, clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
const shapes = [opening.shape, retained.shape];
const shapesById = new Map(shapes.map(shape => [shape.id, shape]));

it("keeps shafts beneath a retained hole and includes the same peg in the jig SVG", async () => {
  await withKernel(kernel => {
    const { arena, CrossSection } = kernel;
    const build = (cutouts: typeof pocket[]) => buildBinWithCutouts(kernel, spec, { shapesById, cutouts, fingerHoles: [] }, EXPORT_QUALITY);
    const plain = build([pocket]);
    const kept = build([pocket, hole]);
    expect(kept.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(kept.solid.status()).toBe("NoError");
    const shaft = arena.track(arena.track(CrossSection.circle(2.4, EXPORT_QUALITY.circularSegments)).translate([-20, -10]));
    const plainSlice = arena.track(plain.solid.slice(-1));
    const keptSlice = arena.track(kept.solid.slice(-1));
    expect(arena.track(plainSlice.intersect(shaft)).area()).toBeCloseTo(0, 6);
    expect(arena.track(keptSlice.intersect(shaft)).area()).toBeCloseTo(shaft.area(), 6);
  });
  const plain = await generateUltim8JigSVG(spec, [pocket], shapesById);
  const kept = await generateUltim8JigSVG(spec, [pocket, hole], shapesById);
  expect(plain).not.toContain('cx="5.5000" cy="25.5000"');
  expect(kept).toContain('cx="5.5000" cy="25.5000"');
});

it.each([39, 42, PROJECT_SCHEMA_VERSION])("preserves combined hole, insertion-axis, jig and color history data from schema %s", schemaVersion => {
  const axis = parseCutoutPlacement({ ...pocket, elevationMm: 0, insertionMode: "axis", insertionAxis: "x", depth: { mode: "mm", value: 4 } });
  const doc = { spec, cutouts: [axis, hole], fingerHoles: [] };
  const after = { ...DEFAULT_BIN_MATERIALS, colorStackingRim: false };
  const saved = { ...doc, schemaVersion, shapes, materials: after, history: { index: 1, stack: [
    { label: "Opened", doc },
    { label: "Jig settings", doc, materialChange: { before: DEFAULT_BIN_MATERIALS, after } },
  ] } };
  const restored = parseProjectDoc(saved)!;
  expect(restored).toEqual({ ...saved, schemaVersion: PROJECT_SCHEMA_VERSION });
  expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(restored))))).toEqual(restored);
});
