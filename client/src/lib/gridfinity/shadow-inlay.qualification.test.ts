import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fingerHoleSchema, parseCutoutPlacement, resolvePocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { createKernel, type Kernel } from "@/lib/manifold/kernel";
import { loadManifold } from "@/lib/manifold/runtime";
import type { ManifoldToplevel } from "manifold-3d";
import { buildBinWithCutouts, EXPORT_QUALITY, type BinLayout } from "./bin";
import { buildCutoutCutters } from "./cutouts";
import { buildShadowInlaySolid } from "./fit-check";

let wasm: ManifoldToplevel;
let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none" });
const layoutFor = (shape: TracedShape, cutout: BinLayout["cutouts"][number]): BinLayout => ({
  shapesById: new Map([[shape.id, shape]]), cutouts: [cutout], fingerHoles: [],
});
const rectangle = (id: string, minX: number, minY: number, maxX: number, maxY: number): TracedShape => ({
  id, name: id, bboxMm: { minX, minY, maxX, maxY }, pointCount: 4, sourceMmPerPx: 1,
  outlineMm: [{ outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }], holes: [] }],
});
const shape: TracedShape = { id: "tool", name: "Asymmetric tool", outlineMm: [{ outer: [
  { x: -12, y: -8 }, { x: 16, y: -8 }, { x: 16, y: 4 },
  { x: 4, y: 4 }, { x: 4, y: 9 }, { x: -12, y: 9 },
], holes: [[{ x: -8, y: -3 }, { x: -8, y: 2 }, { x: -3, y: 2 }, { x: -3, y: -3 }]] }],
  bboxMm: { minX: -12, minY: -8, maxX: 16, maxY: 9 }, pointCount: 10, sourceMmPerPx: 1 };

describe("shadow inlay floor fit", () => {
  it.each([
    { radius: 0, thickness: 0.6, depth: 10, clearance: 0 },
    { radius: 2, thickness: 0.6, depth: 10, clearance: 0.4 },
    { radius: 6, thickness: 0.8, depth: 3, clearance: -0.2 },
    { radius: 1, thickness: 2, depth: 10, clearance: -0.2 },
  ])("fits the actual floor with $radius mm rounding and $thickness mm thickness", ({ radius, thickness, depth, clearance }) => {
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 7, y: -4 },
      rotationDeg: 37, mirrored: true, scaleX: 1.3, scaleY: 0.9, clearanceMm: clearance,
      depth: { mode: "mm", value: depth }, cornerRoundMm: 0.4, topFilletMm: 1, bottomFilletMm: radius });
    const inlay = buildShadowInlaySolid(kernel, spec, layoutFor(shape, cutout), cutout.id, thickness, EXPORT_QUALITY);
    const cavity = buildCutoutCutters(kernel, new Map([[shape.id, shape]]), [cutout], spec, EXPORT_QUALITY).cutters[0];
    const floorZ = resolvePocketDepth(spec, cutout.depth).floorZ!;
    const placed = arena.track(arena.track(inlay.rotate([0, 0, cutout.rotationDeg]))
      .translate([cutout.position.x, cutout.position.y, floorZ]));
    expect(inlay.status()).toBe("NoError");
    expect(inlay.boundingBox().min[2]).toBeCloseTo(0, 8);
    expect(inlay.boundingBox().max[2]).toBeCloseTo(thickness, 8);
    expect(arena.track(placed.subtract(cavity)).volume()).toBeLessThan(1e-6);
    expect(inlay.volume()).toBeGreaterThan(1);
    // Inspect the serialized coordinates as well as the native CSG solid.
    const stl = new DataView(writeBinarySTL(extractPrintableMeshData(kernel, inlay)));
    const edges = new Map<string, number>();
    let signedVolume = 0;
    for (let face = 0; face < stl.getUint32(80, true); face++) {
      const vertices = [0, 1, 2].map(corner => [0, 1, 2].map(axis =>
        stl.getFloat32(84 + face * 50 + 12 + corner * 12 + axis * 4, true)));
      const [a, b, c] = vertices;
      signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1])
        + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      const keys = vertices.map(vertex => vertex.join(","));
      expect(new Set(keys).size).toBe(3);
      for (let corner = 0; corner < 3; corner++) {
        const edge = [keys[corner], keys[(corner + 1) % 3]].sort().join("/");
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    expect(signedVolume).toBeCloseTo(inlay.volume(), 3);
    const bottom = arena.track(inlay.slice(1e-5));
    const top = arena.track(inlay.slice(thickness - 1e-5));
    if (radius > 0) expect(top.area()).toBeGreaterThan(bottom.area());
    // The island is empty at every height, rather than filled as in the former template.
    const islandProbe = arena.track(arena.track(wasm.Manifold.cube([1, 1, thickness]))
      .translate([6.5, -1, 0]));
    expect(arena.track(inlay.intersect(islandProbe)).volume()).toBeLessThan(1e-8);
  });

  it("provides the requested edge gap on a sharp rectangular seat", () => {
    const rectangle = { ...shape, outlineMm: [{ outer: [
      { x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 },
    ], holes: [] }] };
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 10 }, clearanceMm: 0.5, cornerRoundMm: 0, bottomFilletMm: 0 });
    const inlay = buildShadowInlaySolid(kernel, spec, layoutFor(rectangle, cutout), cutout.id, 0.6, EXPORT_QUALITY, 0.3);
    expect(inlay.boundingBox().min[0]).toBeCloseTo(-10.2, 5);
    expect(inlay.boundingBox().max[0]).toBeCloseTo(10.2, 5);
  });

  it("rejects bottom rounding that leaves no printable flat seat", () => {
    const narrow = { ...shape, outlineMm: [{ outer: [
      { x: -1, y: -10 }, { x: 1, y: -10 }, { x: 1, y: 10 }, { x: -1, y: 10 },
    ], holes: [] }] };
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 10 }, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 2 });
    expect(() => buildShadowInlaySolid(kernel, spec, layoutFor(narrow, cutout), cutout.id, 0.6, EXPORT_QUALITY)).toThrow(/flat seat|nothing to cut/);
  });

  it("leaves edge clearance around a separate kept island in the finished bin", () => {
    const island: TracedShape = { ...shape, id: "island", name: "Island", pointCount: 4,
      bboxMm: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
      outlineMm: [{ outer: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }], holes: [] }] };
    const depth = { mode: "mm", value: 8 } as const;
    const pocketShape = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [] }] };
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 8, y: -4 },
      rotationDeg: 30, depth, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 2 });
    const retained = parseCutoutPlacement({ id: "keep", shapeId: island.id, role: "hole",
      position: cutout.position, rotationDeg: cutout.rotationDeg, depth, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 0 });
    const layout: BinLayout = {
      shapesById: new Map([[pocketShape.id, pocketShape], [island.id, island]]),
      cutouts: [cutout, retained], fingerHoles: [],
    };
    const inlay = buildShadowInlaySolid(kernel, spec, layout, cutout.id, 0.6, EXPORT_QUALITY, 0.2);
    const floor = resolvePocketDepth(spec, depth).floorZ!;
    const placed = arena.track(arena.track(inlay.rotate([0, 0, cutout.rotationDeg])).translate([8, -4, floor]));
    const bin = buildBinWithCutouts(kernel, spec, layout, EXPORT_QUALITY);
    expect(bin.validationIssues).toEqual([]);
    expect(arena.track(placed.intersect(bin.solid)).volume()).toBeLessThan(1e-6);
    // Probe along the sides without assuming that the corner clearance is square.
    for (const [width, length] of [[6.38, 6], [6, 6.38]]) {
      const band = arena.track(arena.track(wasm.Manifold.cube([width, length, 0.6])).translate([-width / 2, -length / 2, 0]));
      expect(arena.track(inlay.intersect(band)).volume()).toBeLessThan(1e-6);
    }
    expect(inlay.volume()).toBeGreaterThan(1);
    expect(writeBinarySTL(extractPrintableMeshData(kernel, inlay)).byteLength).toBeGreaterThan(84);
  });

  it.each([0.6, 10])("rejects a %s mm inlay for an 8 mm cavity sealed beneath the fill", (depthMm) => {
    const surface = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      elevationMm: surface - 12, depth: { mode: "mm", value: 8 } });
    const layout = layoutFor(shape, cutout);
    const [cavity] = buildCutoutCutters(kernel, layout.shapesById, layout.cutouts, spec, EXPORT_QUALITY).cutters;
    expect(cavity.boundingBox().max[2]).toBeCloseTo(surface - 4, 6);
    expect(() => buildShadowInlaySolid(kernel, spec, layout, cutout.id, depthMm, EXPORT_QUALITY))
      .toThrow(depthMm < 8 ? "cannot pass through the pocket opening" : "does not fit in the finished pocket");
  });

  it("accepts a buried cavity opened by a shallower finger access cut", () => {
    const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
    const tool = rectangle("tool", -10, -5, 10, 5);
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: tool.id, position: { x: 0, y: 0 },
      elevationMm: top - 12, depth: { mode: "mm", value: 8 }, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 0, topFilletMm: 0 });
    const layout = layoutFor(tool, cutout);
    layout.fingerHoles = [fingerHoleSchema.parse({ id: "access", center: { x: 0, y: 0 }, diameterMm: 24, depthMm: 5 })];
    const inlay = buildShadowInlaySolid(kernel, spec, layout, cutout.id, 0.6, EXPORT_QUALITY);
    expect(inlay.volume()).toBeCloseTo(19.6 * 9.6 * 0.6, 5);
  });

  it("rejects a seat that would tip after a deep finger-access cut", () => {
    const tool = rectangle("tool", -10, -5, 10, 5);
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: tool.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 8 }, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 0 });
    const layout = layoutFor(tool, cutout);
    layout.fingerHoles = [fingerHoleSchema.parse({ id: "access", center: { x: -5, y: 0 }, diameterMm: 24, depthMm: 13 })];
    expect(() => buildShadowInlaySolid(kernel, spec, layout, cutout.id, 0.6, EXPORT_QUALITY)).toThrow("would tip");
  });

  it("requires floor support under every piece when a fillet divides the inlay", () => {
    const tool: TracedShape = { ...rectangle("tool", -20, -6, 20, 6), pointCount: 12,
      outlineMm: [{ outer: [
        { x: -20, y: -6 }, { x: -8, y: -6 }, { x: -8, y: -0.5 }, { x: 8, y: -0.5 },
        { x: 8, y: -6 }, { x: 20, y: -6 }, { x: 20, y: 6 }, { x: 8, y: 6 },
        { x: 8, y: 0.5 }, { x: -8, y: 0.5 }, { x: -8, y: 6 }, { x: -20, y: 6 },
      ], holes: [] }] };
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: tool.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 8 }, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 2 });
    const layout = layoutFor(tool, cutout);
    const exportInlay = () => buildShadowInlaySolid(kernel, spec, layout, cutout.id, 0.6, EXPORT_QUALITY);
    expect(arena.trackAll(exportInlay().decompose())).toHaveLength(2);
    const opening = rectangle("opening", -22, -8, -6, 8);
    layout.shapesById = new Map([[tool.id, tool], [opening.id, opening]]);
    layout.cutouts = [cutout, parseCutoutPlacement({ id: "through", shapeId: opening.id, position: { x: 0, y: 0 },
      depth: { mode: "through" }, clearanceMm: 0, cornerRoundMm: 0 })];
    expect(exportInlay).toThrow("no supporting floor for at least one shadow inlay piece");
  });

  it.each([
    { halfSize: 18, hasSupport: false },
    { halfSize: 3, hasSupport: true },
  ])("checks the remaining seat after a through cut (support=$hasSupport)", ({ halfSize, hasSupport }) => {
    const depth = { mode: "mm", value: 8 } as const;
    const cutout = parseCutoutPlacement({ id: "blind", shapeId: shape.id,
      position: { x: 0, y: 0 }, depth, bottomFilletMm: 2 });
    const opening: TracedShape = { ...shape, id: "opening", name: "Through opening", pointCount: 4,
      bboxMm: { minX: -halfSize, minY: -halfSize, maxX: halfSize, maxY: halfSize },
      outlineMm: [{ outer: [
        { x: -halfSize, y: -halfSize }, { x: halfSize, y: -halfSize },
        { x: halfSize, y: halfSize }, { x: -halfSize, y: halfSize },
      ], holes: [] }] };
    const through = parseCutoutPlacement({ id: "through", shapeId: opening.id,
      position: cutout.position, depth: { mode: "through" }, cornerRoundMm: 0 });
    const layout: BinLayout = {
      shapesById: new Map([[shape.id, shape], [opening.id, opening]]),
      cutouts: [cutout, through], fingerHoles: [],
    };
    const exportInlay = () => buildShadowInlaySolid(kernel, spec, layout, cutout.id, 0.6, EXPORT_QUALITY);
    if (!hasSupport) {
      expect(exportInlay).toThrow("no supporting floor for at least one shadow inlay piece");
      return;
    }
    const inlayBase = arena.track(exportInlay().slice(0.001));
    const floor = resolvePocketDepth(spec, depth).floorZ!;
    const { solid } = buildBinWithCutouts(kernel, spec, layout, EXPORT_QUALITY);
    const binSeat = arena.track(solid.slice(floor - 0.001));
    const contact = arena.track(inlayBase.intersect(binSeat)).area();
    expect(contact).toBeGreaterThan(0);
    expect(contact).toBeLessThan(inlayBase.area());
  });
});
