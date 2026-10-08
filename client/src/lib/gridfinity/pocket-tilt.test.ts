import { adjustPocketsForFillHeight } from "@shared/gridfinity/fill-height-edit";
import { Quaternion, Vector3 } from "three";
import { pocketTransformPatch } from "./pocket-transform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePlacedPocketDepth, resolvePocketDepth, transformPointPlacement, untransformPointPlacement, resizeCutoutPlacementFromHandle, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { validateLayout } from "@shared/gridfinity/validate";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { buildRigidPocket, buildCutoutCutters } from "./cutouts";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { buildSurfaceFitCheckSolid } from "./fit-check";
import { fitRectangularBinToPlacements, autoArrangeLayout } from "./autoplace";
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

describe("tilted pockets", () => {
  it.each([
    { rounded: false, split: false, fillHeightPercent: 100 },
    { rounded: true, split: false, fillHeightPercent: 100 },
    { rounded: true, split: true, fillHeightPercent: 70 },
    { rounded: true, split: true, fillHeightPercent: 100, raisedSection: true },
  ])("preserves partial legacy openings and their colored export geometry: %j", ({ rounded, split, fillHeightPercent, raisedSection = false }) => {
    const legacy = parseCutoutPlacement({ ...pocket, tilt: { xDeg: 30, yDeg: 0 }, depth: { mode: "mm", value: 6 },
      zOffsetMm: raisedSection ? 2 : undefined,
      topFilletMm: rounded ? 1 : 0, bottomFilletMm: rounded ? 0.5 : 0,
      split: split ? { boundary: [{ x: -3, y: raisedSection ? 8 : 0 }, { x: 3, y: raisedSection ? 8 : 0 }],
        depths: [{ mode: "mm", value: raisedSection ? 4 : 6 }, { mode: "mm", value: raisedSection ? 6 : 10 }] } : undefined });
    const bin = { ...spec, heightUnits: 4, fillHeightPercent };
    const resolved = resolvePlacedPocketDepth(bin, legacy.depth, shape, legacy);
    expect(resolved.floorZ).toBeLessThan(resolved.infillTopZ);
    expect(resolved.highestFloorZ).toBeGreaterThan(resolved.infillTopZ);
    expect(validateLayout(bin, [legacy], shapes).filter(issue => issue.severity === "error")).toEqual([]);
    const layout = { shapesById: shapes, cutouts: [legacy], fingerHoles: [] };
    const built = buildBinWithCutouts(kernel, bin, layout, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    const unrounded = buildBinWithCutouts(kernel, bin, { ...layout, cutouts: [{ ...legacy, topFilletMm: 0 }] }, EXPORT_QUALITY);
    expect(built.validationIssues).toEqual([]);
    if (rounded) expect(unrounded.solid.volume() - built.solid.volume()).toBeGreaterThan(0.01);
    const reference = extractMeshData(kernel, built.solid);
    const mesh = extractPrintableMeshData(kernel, built.solid);
    expectPrintableTopology(mesh);
    expectSameGeometry(reference, mesh, "legacy partial opening");
    const parts = [built.materialParts!.body, built.materialParts!.pocketFloors!]
      .map(part => extractPrintableMeshData(kernel, part));
    parts.forEach(part => expectPrintableTopology(part));
    expect(Math.abs(parts.reduce((sum, part) => sum + signedMeshVolume(part), 0) - built.solid.volume())).toBeLessThan(0.05);
    expectPartitionOccupancy(reference, parts);
  }, 30_000);

  it("retains the existing top round of a contained shallow legacy seat lowered in Z", () => {
    const lowered = parseCutoutPlacement({ ...pocket, tilt: { xDeg: 30, yDeg: 0 },
      depth: { mode: "mm", value: 6 }, zOffsetMm: -15, topFilletMm: 5 });
    const resolved = resolvePlacedPocketDepth(spec, lowered.depth, shape, lowered);
    expect(resolved.infillTopZ - resolved.highestFloorZ!).toBeGreaterThan(10);
    const build = (topFilletMm: number) => buildBinWithCutouts(kernel, spec,
      { shapesById: shapes, cutouts: [{ ...lowered, topFilletMm }], fingerHoles: [] }, EXPORT_QUALITY).solid;
    // Legacy shafts clear to the fill even when their authored extrusion is
    // shallow. Preserve the 5 mm round; a source-depth/2 cap would shrink it to 3.
    expect(build(3).volume() - build(5).volume()).toBeGreaterThan(1);
  });

  it.each([undefined, { xDeg: 30, yDeg: 0 }])("leaves the bin unchanged for a legacy source raised above the fill at %j", tilt => {
    const raised = parseCutoutPlacement({ ...pocket, tilt, depth: { mode: "mm", value: 6 }, zOffsetMm: 100, topFilletMm: 2 });
    const empty = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY).solid;
    const built = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [raised], fingerHoles: [] },
      EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    expect(built.solid.volume()).toBeCloseTo(empty.volume(), 6);
    expect(built.materialParts).toBeNull();
    expectSameGeometry(extractMeshData(kernel, empty), extractPrintableMeshData(kernel, built.solid), "raised legacy source");
  });

  it("keeps the actual tilted seat solid stationary after a fill-height edit", () => {
    const next = { ...spec, fillHeightPercent: 75 };
    const adjusted = adjustPocketsForFillHeight([pocket], spec, next).cutouts!;
    const a = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [pocket], fingerHoles: [] }, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    const b = buildBinWithCutouts(kernel, next, { shapesById: shapes, cutouts: adjusted, fingerHoles: [] }, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    expect(b.solid.status()).toBe("NoError");
    expect(b.validationIssues).toEqual([]);
    const before = a.materialParts!.pocketFloors!, after = b.materialParts!.pocketFloors!;
    expect(arena.track(before.subtract(after)).volume()).toBeLessThan(1e-4);
    expect(arena.track(after.subtract(before)).volume()).toBeLessThan(1e-4);
    const restored = adjustPocketsForFillHeight(adjusted, next, next, false).cutouts!;
    const off = buildBinWithCutouts(kernel, next, { shapesById: shapes, cutouts: restored, fingerHoles: [] }, EXPORT_QUALITY).solid;
    const originalDepth = buildBinWithCutouts(kernel, next, { shapesById: shapes, cutouts: [pocket], fingerHoles: [] }, EXPORT_QUALITY).solid;
    expect(arena.track(off.subtract(originalDepth)).volume()).toBeLessThan(1e-4);
    expect(arena.track(originalDepth.subtract(off)).volume()).toBeLessThan(1e-4);
  });

  it("keeps a 35 mm axial pocket within a shorter vertical depth, with a larger mouth", () => {
    const resolved = resolvePlacedPocketDepth(spec, pocket.depth, shape, pocket);
    expect(resolved.axialDepthMm).toBe(35);
    expect(resolved.depthMm).toBeCloseTo(38 / Math.sqrt(2), 8);
    const { cutters } = buildCutoutCutters(kernel, shapes, [pocket], spec, EXPORT_QUALITY);
    const cutter = arena.track(kernel.Manifold.union(cutters));
    expect(cutter.status()).toBe("NoError");
    expect(cutter.boundingBox().min[2]).toBeCloseTo(resolved.floorZ!, 4);
    const opening = arena.track(cutter.slice(resolved.infillTopZ));
    const bounds = opening.bounds();
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(6 * Math.sqrt(2), 4);
    expect(opening.area()).toBeCloseTo(6 * 32 * Math.sqrt(2), 3);
    expect(validateLayout(spec, [pocket], shapes).filter(i => i.severity === "error")).toEqual([]);
  });

  it("preserves the lowest floor with remaining-floor mode and nonzero clearance", () => {
    const remaining = { ...pocket, clearanceMm: 0.5, depth: { mode: "remaining" as const, floorThicknessMm: 7 } };
    const resolved = resolvePlacedPocketDepth(spec, remaining.depth, shape, remaining);
    expect(resolved.floorZ).toBeCloseTo(7, 8);
    const built = buildCutoutCutters(kernel, shapes, [remaining], spec, EXPORT_QUALITY);
    expect(arena.track(kernel.Manifold.union(built.cutters)).boundingBox().min[2]).toBeGreaterThanOrEqual(7 - 0.001);
  });

  it("shares invertible mouth placement with resize/contour editing under combined tilt", () => {
    const combined = { ...pocket, zOffsetMm: 4, rotationDeg: 37, tilt: { xDeg: -20, yDeg: 35 }, mirrored: true, scaleX: 1.2, scaleY: 0.8, position: { x: 20, y: -8 } };
    const source = { x: 2, y: -10 };
    const recovered = untransformPointPlacement(transformPointPlacement(source, combined), combined);
    expect(recovered.x).toBeCloseTo(source.x, 8); expect(recovered.y).toBeCloseTo(source.y, 8);
    const anchor = { x: -3, y: -16 };
    const target = transformPointPlacement({ x: 5, y: 20 }, combined);
    const resized = resizeCutoutPlacementFromHandle(combined, shape.bboxMm, "ne", target);
    expect(transformPointPlacement(anchor, resized).x).toBeCloseTo(transformPointPlacement(anchor, combined).x, 8);
    expect(transformPointPlacement(anchor, resized).y).toBeCloseTo(transformPointPlacement(anchor, combined).y, 8);
    expect(resized.tilt).toEqual(combined.tilt);
  });

  it("has the same solid when tilt is zero or absent", () => {
    const flat = { ...pocket, tilt: undefined };
    const a = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [flat], fingerHoles: [] }, EXPORT_QUALITY).solid;
    const b = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [{ ...flat, tilt: { xDeg: 0, yDeg: 0 } }], fingerHoles: [] }, EXPORT_QUALITY).solid;
    expect(a.volume()).toBe(b.volume());
    expect(arena.track(a.subtract(b)).volume()).toBeCloseTo(0, 8);
  });

  it("finds shafts that collide below separate openings and rejects a wall breach", () => {
    const left = { ...pocket, position: { x: -12, y: 0 }, tilt: { xDeg: 0, yDeg: -45 } };
    const right = { ...pocket, id: "right", position: { x: 12, y: 0 } };
    expect(validateLayout(spec, [left, right], shapes).some(i => i.code === "cutout-overlap")).toBe(false);
    const built = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [left, right], fingerHoles: [] }, EXPORT_QUALITY);
    expect(built.validationIssues.find(i => i.code === "tilted-pocket-overlap")?.severity).toBe("warning");
    const wall = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [{ ...pocket, position: { x: -65, y: 0 } }], fingerHoles: [] }, EXPORT_QUALITY);
    expect(wall.validationIssues.some(i => i.code === "tilted-pocket-wall")).toBe(true);
  });

  it("rotates split seats and produces valid, nonoverlapping floor colors", () => {
    const split = { ...pocket, bottomFilletMm: 0.5, topFilletMm: 1, split: { boundary: [{ x: -3, y: 0 }, { x: 3, y: 0 }], depths: [{ mode: "mm" as const, value: 25 }, { mode: "mm" as const, value: 35 }] as const } };
    const cutout = parseCutoutPlacement(split);
    const built = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [cutout], fingerHoles: [] }, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    expect(built.solid.status()).toBe("NoError");
    expect(built.validationIssues).toEqual([]);
    expect(built.materialParts?.pocketFloors?.volume()).toBeGreaterThan(1);
    expect(arena.track(built.materialParts!.body.intersect(built.materialParts!.pocketFloors!)).volume()).toBeCloseTo(0, 5);
    expect(built.materialParts!.body.volume() + built.materialParts!.pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 3);
    const surface = buildSurfaceFitCheckSolid(kernel, spec, { shapesById: shapes, cutouts: [cutout], fingerHoles: [] }, 0.8, EXPORT_QUALITY, "outline");
    expect(surface.status()).toBe("NoError");
    expect(surface.boundingBox().max[2]).toBeCloseTo(0.8, 5);
  });

  it("warns about a thin web between converging shafts whose mouths are far apart", () => {
    const distance = 38 / Math.sqrt(2) + 0.25;
    const left = { ...pocket, position: { x: -distance, y: 0 }, tilt: { xDeg: 0, yDeg: -45 } };
    const right = { ...pocket, id: "right", position: { x: distance, y: 0 } };
    expect(validateLayout(spec, [left, right], shapes).filter(i => i.code === "thin-material")).toEqual([]);
    const built = buildBinWithCutouts(kernel, spec, { shapesById: shapes, cutouts: [left, right], fingerHoles: [] }, EXPORT_QUALITY);
    expect(built.validationIssues.some(i => i.code === "tilted-pocket-overlap")).toBe(false);
    expect(built.validationIssues.some(i => i.code === "tilted-pocket-thin-material")).toBe(true);
  });

  it("opens both ends of a through pocket and rejects near-horizontal axes", () => {
    const through = { ...pocket, depth: { mode: "through" as const } };
    const built = buildCutoutCutters(kernel, shapes, [through], spec, EXPORT_QUALITY);
    const union = arena.track(kernel.Manifold.union(built.cutters));
    expect(arena.track(union.slice(0)).area()).toBeGreaterThan(1);
    expect(arena.track(union.slice(resolvePocketDepth(spec, through.depth).cutterTopZ - 1)).area()).toBeGreaterThan(1);
    const horizontal = { ...pocket, tilt: { xDeg: 89, yDeg: 89 } };
    expect(() => buildCutoutCutters(kernel, shapes, [horizontal], spec, EXPORT_QUALITY)).toThrow(/combined/);
  });

  it("round-trips independent angles and history, and migrates version 19 without tilt", () => {
    const doc = { spec, cutouts: [pocket, { ...pocket, id: "copy", tilt: { xDeg: 15, yDeg: -30 } }], fingerHoles: [] };
    const current = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape], ...doc, history: { stack: [{ doc, label: "Tilt pockets" }], index: 0 } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(current)))).toEqual(current);
    const old = { ...current, schemaVersion: 19, cutouts: [{ ...pocket, tilt: undefined }], history: undefined };
    expect(parseProjectDoc(old)?.cutouts[0].tilt).toBeUndefined();
    expect(parseProjectDoc(old)?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(parseProjectDoc({ ...current, cutouts: [{ ...pocket, tilt: { xDeg: NaN, yDeg: 45 } }] })).toBeNull();
  });

  it("fits and arranges occupied shafts while preserving tilt", () => {
    const fitted = fitRectangularBinToPlacements([pocket], shapes, spec);
    const arranged = autoArrangeLayout([pocket, { ...pocket, id: "copy" }], shapes, spec.lip, spec.gridPitch, [], spec)!;
    expect(fitted.cutouts[0].tilt).toEqual(pocket.tilt);
    expect(arranged.cutouts.every(p => p.tilt?.yDeg === 45)).toBe(true);
    const built = buildBinWithCutouts(kernel, { ...spec, gridX: arranged.gridX, gridY: arranged.gridY }, { shapesById: shapes, cutouts: arranged.cutouts, fingerHoles: [] }, EXPORT_QUALITY);
    expect(built.validationIssues).toEqual([]);
  });
});

it.each([undefined, { xDeg: 0, yDeg: 45 }])("translates a pocket floor in Z and preserves its clearance path (%j)", tilt => {
  const original = { ...pocket, tilt, depth: { mode: "remaining" as const, floorThicknessMm: 10 } };
  const moved = { ...original, zOffsetMm: -3 };
  const resolved = resolvePlacedPocketDepth(spec, moved.depth, shape, moved);
  expect(resolved.floorZ).toBeCloseTo(7, 8);
  expect(resolved.axialDepthMm).toBeCloseTo(resolvePlacedPocketDepth(spec, original.depth, shape, original).axialDepthMm!, 8);
  const built = buildCutoutCutters(kernel, shapes, [moved], spec, EXPORT_QUALITY);
  const cutter = arena.track(kernel.Manifold.union(built.cutters));
  expect(cutter.status()).toBe("NoError");
  expect(cutter.boundingBox().min[2]).toBeCloseTo(7, 4);
  const mouth = arena.track(cutter.slice(resolved.infillTopZ)).bounds();
  const centre = transformPointPlacement({ x: 0, y: 0 }, moved);
  expect((mouth.min[0] + mouth.max[0]) / 2).toBeCloseTo(centre.x, 4);
  expect((mouth.min[1] + mouth.max[1]) / 2).toBeCloseTo(centre.y, 4);
  const base = arena.track(kernel.Manifold.union(buildCutoutCutters(kernel, shapes, [original], spec, EXPORT_QUALITY).cutters));
  // Below the bin top, the cavity is an exact rigid translation of the original.
  const clip = arena.track(kernel.Manifold.cube([150, 150, 40]).translate([-75, -75, 0]));
  const expected = arena.track(arena.track(base.translate([0, 0, -3])).intersect(clip));
  const actual = arena.track(cutter.intersect(clip));
  expect(arena.track(expected.subtract(actual)).volume()).toBeCloseTo(0, 4);
  expect(arena.track(actual.subtract(expected)).volume()).toBeCloseTo(0, 4);
});

it("round-trips Z placement and history, migrates v20, and checks floor limits", () => {
  const moved = { ...pocket, zOffsetMm: 3 };
  const doc = { spec, cutouts: [moved], fingerHoles: [] };
  const project = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape], ...doc, history: { stack: [{ doc, label: "Move in Z" }], index: 0 } };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
  expect(parseProjectDoc({ ...project, schemaVersion: 20, history: undefined, cutouts: [pocket] })?.cutouts[0].zOffsetMm).toBeUndefined();
  expect(parseProjectDoc({ ...project, cutouts: [{ ...moved, zOffsetMm: Infinity }] })).toBeNull();
  expect(validateLayout(spec, [{ ...moved, zOffsetMm: -100 }], shapes).some(i => i.code === "too-deep")).toBe(true);
  expect(validateLayout(spec, [{ ...moved, zOffsetMm: 100 }], shapes).some(i => i.code === "too-shallow")).toBe(true);
});

it.each([-30, 30])("keeps both ends of a Z-translated tilted through pocket open (Z=%s)", zOffsetMm => {
  const through = { ...pocket, zOffsetMm, depth: { mode: "through" as const } };
  const cutter = arena.track(kernel.Manifold.union(buildCutoutCutters(kernel, shapes, [through], spec, EXPORT_QUALITY).cutters));
  for (const z of [0, 42]) expect(arena.track(cutter.slice(z)).area()).toBeCloseTo(6 * 32 * Math.sqrt(2), 3);
});


it("moves a finite tilted solid rigidly without changing thickness", () => {
  const original={...pocket,depth:{mode:"mm" as const,value:12},elevationMm:9};
  const patch=pocketTransformPatch(original,shape,spec,new Vector3(0,0,47),new Quaternion(),"translate")!;
  const before=buildRigidPocket(kernel,shape,original,spec,EXPORT_QUALITY).cutters[0];
  const after=buildRigidPocket(kernel,shape,{...original,...patch},spec,EXPORT_QUALITY).cutters[0];
  const shifted=arena.track(before.translate([0,0,5]));
  expect(arena.track(shifted.subtract(after)).volume()).toBeCloseTo(0,4);
  expect(arena.track(after.subtract(shifted)).volume()).toBeCloseTo(0,4);
  expect(patch.depth).toEqual(original.depth);
});
it("rotates a finite generated solid without twist or scaling and retains its lowest point", () => {
  const original={...pocket,depth:{mode:"mm" as const,value:12},elevationMm:9};
  const delta=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/18);
  const patch=pocketTransformPatch(original,shape,spec,new Vector3(0,0,42),delta,"rotate")!;
  const before=buildRigidPocket(kernel,shape,original,spec,EXPORT_QUALITY).cutters[0];
  const turned=arena.track(before.rotate([10,0,0]));
  const expected=arena.track(turned.translate([0,9*Math.sin(Math.PI/18),9-turned.boundingBox().min[2]]));
  const after=buildRigidPocket(kernel,shape,{...original,...patch},spec,EXPORT_QUALITY).cutters[0];
  expect(after.volume()).toBeCloseTo(before.volume(),4);
  expect(after.boundingBox().min[2]).toBeCloseTo(9,5);
  // Align translations; the two solids must then coincide exactly.
  const moved=arena.track(expected.translate(after.boundingBox().min.map((n,i)=>n-expected.boundingBox().min[i]) as [number,number,number]));
  expect(arena.track(moved.subtract(after)).volume()).toBeCloseTo(0,3);
  expect(arena.track(after.subtract(moved)).volume()).toBeCloseTo(0,3);
});
