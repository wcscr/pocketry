import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePlacedPocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { validateLayout } from "@shared/gridfinity/validate";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { extractMeshData, extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { expectPartitionOccupancy, expectPrintableTopology, expectSameGeometry, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";

const shape: TracedShape = { id: "rectangle", name: "Board slot", source: "basic-shape", sourceMmPerPx: null, pointCount: 4,
  bboxMm: { minX: -3, maxX: 3, minY: -16, maxY: 16 },
  outlineMm: [{ outer: [{ x: -3, y: -16 }, { x: 3, y: -16 }, { x: 3, y: 16 }, { x: -3, y: 16 }], holes: [] }] };
const shapes = new Map([[shape.id, shape]]);
const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6, lip: "none", fill: "solid" });
const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, tilt: { xDeg: 0, yDeg: 45 }, depth: { mode: "mm", value: 35 }, cornerRoundMm: 0, bottomFilletMm: 0, topFilletMm: 0 });
let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterAll(() => arena.dispose());

import { getHandler, context, printableMeshVolume } from "./bin-worker-handlers.test-support";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { strFromU8, unzipSync } from "fflate";

describe("surface-anchored pocket partial openings", () => {
  it.each([
    { rounded: false, split: false, fillHeightPercent: 100 },
    { rounded: true, split: false, fillHeightPercent: 100 },
    { rounded: true, split: true, fillHeightPercent: 70 },
    { rounded: true, split: true, fillHeightPercent: 100, raisedSection: true },
  ])("preserves partial surface-anchored openings and their colored export geometry: %j", ({ rounded, split, fillHeightPercent, raisedSection = false }) => {
    const surface = parseCutoutPlacement({ ...pocket, tilt: { xDeg: 30, yDeg: 0 }, depth: { mode: "mm", value: 6 },
      zOffsetMm: raisedSection ? 2 : undefined,
      topFilletMm: rounded ? 1 : 0, bottomFilletMm: rounded ? 0.5 : 0,
      split: split ? { boundary: [{ x: -3, y: raisedSection ? 8 : 0 }, { x: 3, y: raisedSection ? 8 : 0 }],
        depths: [{ mode: "mm", value: raisedSection ? 4 : 6 }, { mode: "mm", value: raisedSection ? 6 : 10 }] } : undefined });
    const bin = { ...spec, heightUnits: 4, fillHeightPercent };
    const resolved = resolvePlacedPocketDepth(bin, surface.depth, shape, surface);
    expect(resolved.floorZ).toBeLessThan(resolved.infillTopZ);
    expect(resolved.highestFloorZ).toBeGreaterThan(resolved.infillTopZ);
    expect(validateLayout(bin, [surface], shapes).filter(issue => issue.severity === "error")).toEqual([]);
    const layout = { shapesById: shapes, cutouts: [surface], fingerHoles: [] };
    const built = buildBinWithCutouts(kernel, bin, layout, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    const unrounded = buildBinWithCutouts(kernel, bin, { ...layout, cutouts: [{ ...surface, topFilletMm: 0 }] }, EXPORT_QUALITY);
    expect(built.validationIssues).toEqual([]);
    if (rounded) expect(unrounded.solid.volume() - built.solid.volume()).toBeGreaterThan(0.01);
    const reference = extractMeshData(kernel, built.solid);
    const mesh = extractPrintableMeshData(kernel, built.solid);
    expectPrintableTopology(mesh);
    expectSameGeometry(reference, mesh, "surface partial opening");
    const parts = [built.materialParts!.body, built.materialParts!.pocketFloors!]
      .map(part => extractPrintableMeshData(kernel, part));
    parts.forEach(part => expectPrintableTopology(part));
    expect(Math.abs(parts.reduce((sum, part) => sum + signedMeshVolume(part), 0) - built.solid.volume())).toBeLessThan(0.05);
    expectPartitionOccupancy(reference, parts);
  }, 30_000);

  it("retains the existing top round of a contained shallow surface-anchored seat lowered in Z", () => {
    const lowered = parseCutoutPlacement({ ...pocket, tilt: { xDeg: 30, yDeg: 0 },
      depth: { mode: "mm", value: 6 }, zOffsetMm: -15, topFilletMm: 5 });
    const resolved = resolvePlacedPocketDepth(spec, lowered.depth, shape, lowered);
    expect(resolved.infillTopZ - resolved.highestFloorZ!).toBeGreaterThan(10);
    const build = (topFilletMm: number) => buildBinWithCutouts(kernel, spec,
      { shapesById: shapes, cutouts: [{ ...lowered, topFilletMm }], fingerHoles: [] }, EXPORT_QUALITY).solid;
    // Surface-anchored shafts clear to the fill even when their authored extrusion is
    // shallow. Preserve the 5 mm round; a source-depth/2 cap would shrink it to 3.
    expect(build(3).volume() - build(5).volume()).toBeGreaterThan(1);
  });

  it.each([undefined, { xDeg: 30, yDeg: 0 }])("leaves the bin unchanged for a surface-anchored source raised above the fill at %j", tilt => {
    const raised = parseCutoutPlacement({ ...pocket, tilt, depth: { mode: "mm", value: 6 }, zOffsetMm: 100, topFilletMm: 2 });
    const empty = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY).solid;
    const built = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [raised], fingerHoles: [] },
      EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    expect(built.solid.volume()).toBeCloseTo(empty.volume(), 6);
    expect(built.materialParts).toBeNull();
    expectSameGeometry(extractMeshData(kernel, empty), extractPrintableMeshData(kernel, built.solid), "raised surface source");
  });

  it.each([19, PROJECT_SCHEMA_VERSION])("exports a reopened surface-anchored partial pocket from schema %s", async schemaVersion => {
    const surface = parseCutoutPlacement({ ...pocket, tilt: { xDeg: 30, yDeg: 0 }, depth: { mode: "mm", value: 6 },
      topFilletMm: 1, bottomFilletMm: 0.5 });
    const parsed = parseProjectDoc(JSON.parse(JSON.stringify({schemaVersion, shapes:[shape],
      spec:{...spec,heightUnits:4},cutouts:[surface],fingerHoles:[]})));
    expect(parsed).not.toBeNull();
    expect(parsed!.cutouts[0].elevationMm).toBeUndefined();
    const result = (await getHandler()({ spec:parsed!.spec, quality:EXPORT_QUALITY, exportTopology:true,
      pocketFloorMaterialThicknessMm:0.6,
      layout:{shapes:parsed!.shapes,cutouts:parsed!.cutouts,fingerHoles:[]}}, context())).value;
    expect(result.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
    expect(printableMeshVolume(result.mesh)).toBeGreaterThan(0);
    expect(writeBinarySTL(result.mesh).byteLength).toBe(84+50*result.mesh.indices.length/3);
    const parts = Object.entries(result.materialMeshes!).map(([name, mesh]) => ({ name, mesh }));
    const xml = strFromU8(unzipSync(writeThreeMf(parts))["3D/3dmodel.model"]);
    expect(xml.match(/<triangle /g)?.length).toBe(parts.reduce((count, part) => count + part.mesh.indices.length / 3, 0));
  });
});
