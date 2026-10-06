import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel, Mesh } from "manifold-3d";
import { parseBinSpec } from "@shared/gridfinity/types";
import { DEFAULT_PEG_BOTTOM, pegBottomExtensionMm, pegBottomRootHeightMm, ultim8PegCenters, ULTIM8_COLLAR_HEIGHT_MM, ULTIM8_ROOT_HEIGHT_MM } from "@shared/gridfinity/peg-bottom";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold } from "@/lib/manifold/runtime";
import { buildBinWithCutouts, binDimensionsMm, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildPegBottom } from "./peg-bottom";
import { buildCutoutCutters } from "./cutouts";
import { fingerHoleSchema, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { pocketDepthChangePatch } from "@shared/gridfinity/pocket-depth-change";
import { rigidPocket } from "@shared/gridfinity/rigid-pocket";
import { createBasicPocket } from "./basic-shape";

let wasm: ManifoldToplevel;
let arena = new Arena();
beforeAll(async () => { wasm = await loadManifold(); });
afterEach(() => { arena.dispose(); arena = new Arena(); });
const spec = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3, lip: "none", pegBottom: DEFAULT_PEG_BOTTOM, ...patch });

/** All down-facing faces except build-plate contacts must be 45 degrees or steeper. */
function checkSupportFree(mesh: Mesh, bottom: number, bridgeZ?: number): void {
  let slopes = 0;
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const points = Array.from(mesh.triVerts.subarray(i, i + 3), v => Array.from(mesh.vertProperties.subarray(v * mesh.numProp, v * mesh.numProp + 3)));
    const [a, b, c] = points;
    const u = b.map((x, j) => x - a[j]), v = c.map((x, j) => x - a[j]);
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    if (nz >= -1e-8 || points.every(p => Math.abs(p[2] - bottom) < 1e-5)) continue;
    if (bridgeZ !== undefined && points.every(p => Math.abs(p[2] - bridgeZ) < 1e-5)) continue;
    expect(-nz / Math.hypot(nx, ny), JSON.stringify(points)).toBeLessThanOrEqual(1.00001);
    slopes++;
  }
  expect(slopes).toBeGreaterThan(0);
}

describe("support-free peg bottoms", () => {
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("builds a connected, watertight base with no unsupported underside at %j quality", quality => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const solid = buildPegBottom(kernel, s, quality.circularSegments);
    expect(solid.status()).toBe("NoError");
    const pieces = solid.decompose();
    pieces.forEach(p => arena.track(p));
    expect(pieces).toHaveLength(1);
    const bottom = -pegBottomExtensionMm(s);
    expect(solid.boundingBox().min[2]).toBeCloseTo(bottom, 6);
    expect(solid.boundingBox().max[2]).toBeCloseTo(7, 6);
    const shafts = arena.track(solid.slice(-ULTIM8_ROOT_HEIGHT_MM - 1));
    expect(shafts.area()).toBeGreaterThan(0);
    checkSupportFree(solid.getMesh(), bottom);
  });
  it.each(["full", "half", "quarter"] as const)("supports small rectangles and custom footprints on %s pitch", gridPitch => {
    const kernel = createKernel(wasm, arena);
    for (const s of [spec({ gridPitch }), spec({ gridPitch, gridX: 2, gridY: 2,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } })]) {
      const solid = buildPegBottom(kernel, s, 24);
      expect(solid.status()).toBe("NoError");
      checkSupportFree(solid.getMesh(), -pegBottomExtensionMm(s));
    }
  });
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("builds a shorter connected bridged web with a 45 degree perimeter at %j quality", quality => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ gridPitch: "quarter", gridX: 2, gridY: 2, pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged" } });
    const solid = buildPegBottom(kernel, s, quality.circularSegments);
    expect(solid.status()).toBe("NoError");
    const pieces = solid.decompose();
    pieces.forEach(p => arena.track(p));
    expect(pieces).toHaveLength(1);
    expect(pegBottomExtensionMm(s)).toBeCloseTo(7.8);
    const bridgeZ = -pegBottomRootHeightMm(s) + ULTIM8_COLLAR_HEIGHT_MM;
    checkSupportFree(solid.getMesh(), -pegBottomExtensionMm(s), bridgeZ);
    expect(arena.track(solid.slice(bridgeZ + 0.1)).area()).toBeGreaterThan(arena.track(solid.slice(bridgeZ - 0.1)).area());
  });
  it.each(["full", "half", "quarter"] as const)("handles single, collinear and wider rectangular peg layouts on %s pitch", gridPitch => {
    const kernel = createKernel(wasm, arena);
    for (const [gridX, gridY] of [[1, 1], [1, 3], [2, 2], [3, 3]]) {
      const s = spec({ gridPitch, gridX, gridY, pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged" } });
      const solid = buildPegBottom(kernel, s, 24);
      expect(solid.status()).toBe("NoError");
      checkSupportFree(solid.getMesh(), -pegBottomExtensionMm(s), -pegBottomRootHeightMm(s) + ULTIM8_COLLAR_HEIGHT_MM);
    }
  });
  it("rejects custom bridged footprints with an actionable alternative", () => {
    const kernel = createKernel(wasm, arena);
    expect(() => buildPegBottom(kernel, spec({ gridX: 2, gridY: 2,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged" } }), 24)).toThrow(/sloped underside/);
  });
  it("includes extension in overall dimensions without moving the rim", () => {
    const normal = binDimensionsMm(spec({ pegBottom: null }));
    const pegs = binDimensionsMm(spec());
    expect(pegs.heightToRimMm).toBe(normal.heightToRimMm);
    expect(pegs.totalHeightMm).toBe(normal.totalHeightMm + pegBottomExtensionMm(spec()));
  });
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("opens a rectangle inside a finger groove through the floor and roots at %j quality", quality => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ gridX: 3 });
    const pocket = createBasicPocket("rectangle", { x: 27, y: -2 }, { x: 33, y: 2 }, "groove-through")!;
    pocket.cutout.depth = { mode: "remaining", floorThicknessMm: 2 };
    const finger = fingerHoleSchema.parse({ id: "groove", kind: "oblong-deep-scoop", center: { x: 0, y: 0 }, lengthMm: 100, diameterMm: 18, depthMm: 12 });
    const build = (cutout: CutoutPlacement) => buildBinWithCutouts(kernel, s, {
      shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [cutout], fingerHoles: [finger],
    }, quality).solid;
    const probe = arena.track(kernel.Manifold.cylinder(pegBottomExtensionMm(s) + 23, 0.4, 0.4, 24)
      .translate([30, 0, -pegBottomExtensionMm(s) - 0.5]));
    const blind = build(pocket.cutout);
    expect(arena.track(blind.intersect(probe)).volume()).toBeGreaterThan(0.1);
    const through = { ...pocket.cutout, ...pocketDepthChangePatch(s, pocket.shape, pocket.cutout, { mode: "through" }) };
    const solid = build(through);
    expect(arena.track(solid.intersect(probe)).volume()).toBeLessThan(1e-6);
    expect(solid.status()).toBe("NoError");
    expect(solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    // A subsequent rigid Z move must still restore material beneath the finite object.
    const raised = { ...rigidPocket(through, pocket.shape, s), elevationMm: 3 };
    expect(arena.track(build(raised).intersect(probe)).volume()).toBeGreaterThan(0.1);
  }, 15_000);

  it("through pockets remove the full shaft/root height and leave no disconnected stubs", () => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const pocket = createBasicPocket("circle", { x: 0, y: 0 }, { x: 5, y: 0 }, "through")!;
    pocket.cutout.depth = { mode: "through" };
    const result = buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY);
    expect(result.solid.status()).toBe("NoError");
    const probe = arena.track(kernel.Manifold.cylinder(pegBottomExtensionMm(s) + 22, 0.5, 0.5, 24).translate([0, 0, -pegBottomExtensionMm(s) - 0.5]));
    expect(arena.track(result.solid.intersect(probe)).volume()).toBeLessThan(1e-6);
    const pieces = result.solid.decompose();
    pieces.forEach(p => arena.track(p));
    expect(pieces).toHaveLength(1);
  });
  const overlapCases = [PREVIEW_QUALITY, EXPORT_QUALITY].flatMap(quality =>
    (["sloped", "bridged"] as const).map(underside => ({ quality, underside })),
  );
  it.each(overlapCases)("omits complete partially and fully overlapped pegs at $underside/$quality.circularSegments quality", ({ quality, underside }) => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ fill: "none", pegBottom: { ...DEFAULT_PEG_BOTTOM, underside } });
    const centers = ultim8PegCenters(s);
    const z = -pegBottomRootHeightMm(s) - 1;
    const fullPegArea = arena.track(kernel.CrossSection.circle(s.pegBottom!.diameterMm / 2, quality.circularSegments)).area();
    for (const [start, end] of [
      [{ x: 1.8, y: -1 }, { x: 4, y: 1 }], // Centre outside; shaft edge overlaps.
      [{ x: -2.5, y: -2.5 }, { x: 2.5, y: 2.5 }], // Whole shaft beneath opening.
    ]) {
      const pocket = createBasicPocket("rectangle", start, end, "overlap")!;
      pocket.cutout.depth = { mode: "through" };
      const result = buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, quality,
        { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 0.6 });
      const shafts = arena.track(result.solid.slice(z));
      expect(shafts.area()).toBeCloseTo((centers.length - 1) * fullPegArea, 5);
      for (const { x, y } of centers) {
        const disk = arena.track(arena.track(kernel.CrossSection.circle(s.pegBottom!.diameterMm / 2, quality.circularSegments)).translate([x, y]));
        expect(arena.track(shafts.intersect(disk)).area()).toBeCloseTo(x === 0 && y === 0 ? 0 : fullPegArea, 5);
      }
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
      const cutters = buildCutoutCutters(kernel, new Map([[pocket.shape.id, pocket.shape]]), [pocket.cutout], s, quality).cutters;
      const finishedBase = arena.track(result.parts.base.subtract(arena.track(kernel.Manifold.union(cutters))));
      checkSupportFree(finishedBase.getMesh(), -pegBottomExtensionMm(s), underside === "bridged"
        ? -pegBottomRootHeightMm(s) + ULTIM8_COLLAR_HEIGHT_MM : undefined);
      // The multicolor body uses the same complete omission.
      expect(arena.track(result.materialParts!.body.slice(z)).area()).toBeCloseTo(shafts.area(), 5);
    }
  });
  it("retains pegs beneath blind pockets and accounts for through-pocket clearance", () => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const pocket = createBasicPocket("rectangle", { x: 2.6, y: -1 }, { x: 4.6, y: 1 }, "clearance")!;
    const build = (cutout: CutoutPlacement) => buildBinWithCutouts(kernel, s,
      { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [cutout], fingerHoles: [] }, EXPORT_QUALITY).solid;
    const z = -pegBottomRootHeightMm(s) - 1;
    const original = arena.track(buildPegBottom(kernel, s, EXPORT_QUALITY.circularSegments).slice(z)).area();
    const fullPegArea = arena.track(kernel.CrossSection.circle(2.4, EXPORT_QUALITY.circularSegments)).area();
    expect(arena.track(build({ ...pocket.cutout, clearanceMm: 0.3, depth: { mode: "remaining", floorThicknessMm: 2 } }).slice(z)).area()).toBeCloseTo(original, 5);
    expect(arena.track(build({ ...pocket.cutout, depth: { mode: "through" } }).slice(z)).area()).toBeCloseTo(original, 5);
    expect(arena.track(build({ ...pocket.cutout, clearanceMm: 0.3, cornerRoundMm: 0.3, depth: { mode: "through" } }).slice(z)).area()).toBeCloseTo(original - fullPegArea, 5);
  });
  it.each([false, true].flatMap(mirrored => [false, true].map(rigid => ({ mirrored, rigid }))))(
    "omits only the through half of a transformed split pocket, mirrored=$mirrored/rigid=$rigid", ({ mirrored, rigid }) => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const pocket = createBasicPocket("rectangle", { x: -10, y: -3 }, { x: 10, y: 3 }, "split")!;
    pocket.cutout = { ...pocket.cutout, rotationDeg: 180, mirrored, scaleX: 1.1, scaleY: 1.2,
      ...(rigid ? { elevationMm: 0 } : {}),
      split: { boundary: [{ x: 0, y: -3 }, { x: 0, y: 3 }], depths: [
        { mode: "through", ...(rigid ? { sourceDepthMm: 16 } : {}) },
        { mode: "remaining", floorThicknessMm: 2, ...(rigid ? { sourceDepthMm: 8 } : {}) },
      ] } };
    const result = buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY);
    const shafts = arena.track(result.solid.slice(-pegBottomRootHeightMm(s) - 1));
    const areaAt = (x: number) => arena.track(shafts.intersect(arena.track(
      arena.track(kernel.CrossSection.circle(2.4, EXPORT_QUALITY.circularSegments)).translate([x, 0]),
    ))).area();
    expect(areaAt(0)).toBeLessThan(1e-6); // Straddles the split boundary.
    expect(areaAt(mirrored ? -10 : 10)).toBeLessThan(1e-6);
    expect(areaAt(mirrored ? 10 : -10)).toBeGreaterThan(17);
    expect(result.solid.status()).toBe("NoError");
  });
  it("preserves pegs inside holes in the through-pocket outline", () => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const pocket = createBasicPocket("rectangle", { x: -7, y: -7 }, { x: 7, y: 7 }, "ring")!;
    pocket.shape.outlineMm[0].holes = [[{ x: -3, y: -3 }, { x: -3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: -3 }]];
    pocket.cutout.depth = { mode: "through" };
    const result = buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY);
    const shafts = arena.track(result.solid.slice(-pegBottomRootHeightMm(s) - 1));
    expect(arena.track(shafts.intersect(arena.track(kernel.CrossSection.circle(2.4, EXPORT_QUALITY.circularSegments)))).area()).toBeGreaterThan(17);
    const overlapping = arena.track(arena.track(kernel.CrossSection.circle(2.4, EXPORT_QUALITY.circularSegments)).translate([5, 5]));
    expect(arena.track(shafts.intersect(overlapping)).area()).toBeLessThan(1e-6);
  });
  it.each([false, true])("matches peg omission to the actual tilted through cut, rigid=%s", rigid => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const pocket = createBasicPocket("rectangle", { x: 1.8, y: -1 }, { x: 4, y: 1 }, "tilted")!;
    pocket.cutout = { ...pocket.cutout, depth: { mode: "through" }, tilt: { xDeg: 0, yDeg: 5 },
      ...(rigid ? { elevationMm: 0 } : {}) };
    const shapes = new Map([[pocket.shape.id, pocket.shape]]);
    const through = buildCutoutCutters(kernel, shapes, [pocket.cutout], s, EXPORT_QUALITY).throughCutters!;
    expect(through).toHaveLength(1);
    const result = buildBinWithCutouts(kernel, s, { shapesById: shapes, cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY);
    const shafts = arena.track(result.solid.slice(-pegBottomRootHeightMm(s) - 1));
    const sweep = arena.track(arena.track(arena.track(through[0].trimByPlane([0, 0, -1], 0))
      .trimByPlane([0, 0, 1], -pegBottomExtensionMm(s))).project());
    let omitted = 0;
    for (const { x, y } of ultim8PegCenters(s)) {
      const disk = arena.track(arena.track(kernel.CrossSection.circle(2.4, EXPORT_QUALITY.circularSegments)).translate([x, y]));
      const overlaps = arena.track(disk.intersect(sweep)).area() > 1e-8;
      if (overlaps) omitted++;
      expect(arena.track(shafts.intersect(disk)).area()).toBeCloseTo(overlaps ? 0 : disk.area(), 5);
    }
    // A finite tilted source only touches the slab at its lowest edge. It
    // has no opening into the roots; an ordinary through shaft still does.
    if (rigid) expect(omitted).toBe(0);
    else expect(omitted).toBeGreaterThan(0);
    expect(result.solid.status()).toBe("NoError");
  });
  it.each(overlapCases)("restores pegs when a finite through pocket is raised at $underside/$quality.circularSegments quality", ({ quality, underside }) => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ pegBottom: { ...DEFAULT_PEG_BOTTOM, underside } });
    const pocket = createBasicPocket("rectangle", { x: 1.8, y: -1 }, { x: 4, y: 1 }, "finite through")!;
    const source: CutoutPlacement = { ...pocket.cutout, elevationMm: 0, insertionMode: "vertical",
      depth: { mode: "through", sourceDepthMm: 16 } };
    const shapesById = new Map([[pocket.shape.id, pocket.shape]]);
    const build = (elevationMm: number) => buildBinWithCutouts(kernel, s,
      { shapesById, cutouts: [{ ...source, elevationMm }], fingerHoles: [] }, quality,
      { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 0.6 });
    const z = -pegBottomRootHeightMm(s) - 1;
    const pegArea = arena.track(kernel.CrossSection.circle(2.4, quality.circularSegments)).area();
    const fullArea = ultim8PegCenters(s).length * pegArea;
    const seated = build(0);
    expect(arena.track(seated.solid.slice(z)).area()).toBeCloseTo(fullArea - pegArea, 5);
    const below = arena.track(kernel.Manifold.cylinder(pegBottomExtensionMm(s) + 0.5, 0.1, 0.1, 24)
      .translate([3, 0, -pegBottomExtensionMm(s)]));
    expect(arena.track(seated.solid.intersect(below)).volume()).toBeLessThan(1e-6);
    for (const elevation of [1, 30]) {
      const raised = build(elevation);
      expect(arena.track(raised.solid.slice(z)).area()).toBeCloseTo(fullArea, 5);
      expect(arena.track(raised.materialParts!.body.slice(z)).area()).toBeCloseTo(fullArea, 5);
      expect(raised.solid.status()).toBe("NoError");
      expect(raised.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    }
    const clear = buildCutoutCutters(kernel, shapesById, [{ ...source, elevationMm: 30 }], s, quality);
    expect(clear.cutters).toEqual([]);
    expect(clear.throughCutters).toEqual([]);
  });
  it("reports when through pockets leave no printable peg anchors", () => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ gridX: 2, gridY: 2, gridPitch: "quarter" });
    const pocket = createBasicPocket("rectangle", { x: -9, y: -9 }, { x: 9, y: 9 }, "all")!;
    pocket.cutout.depth = { mode: "through" };
    expect(() => buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY)).toThrow(/overlap every ULTIM8 peg/);
  });

  it.each(["sloped", "bridged"] as const)("rejects an unsupported corner after omitting a peg in %s mode", underside => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ gridX: 2, gridY: 2, gridPitch: "quarter", pegBottom: { ...DEFAULT_PEG_BOTTOM, underside } });
    const pocket = createBasicPocket("rectangle", { x: 4, y: 4 }, { x: 6, y: 6 }, "corner")!;
    pocket.cutout.depth = { mode: "through" };
    expect(() => buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY)).toThrow(/unsupported/);
  });
  it("rejects a wide retained bridge when through pockets remove its anchors", () => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged" } });
    const pocket = createBasicPocket("rectangle", { x: -13, y: -13 }, { x: 13, y: 13 }, "unsupported-island")!;
    pocket.shape.outlineMm[0].holes = [[{ x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }]];
    pocket.cutout.depth = { mode: "through" };
    expect(() => buildBinWithCutouts(kernel, s, { shapesById: new Map([[pocket.shape.id, pocket.shape]]), cutouts: [pocket.cutout], fingerHoles: [] }, EXPORT_QUALITY)).toThrow(/long bridges/);
  });

});
