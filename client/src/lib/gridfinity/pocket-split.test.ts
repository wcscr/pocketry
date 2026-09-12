import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, transformPointPlacement, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { autoArrangeLayout } from "./autoplace";

let wasm: ManifoldToplevel;
let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "tool", name: "Tool", outlineMm: [{ outer: [{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }], holes: [] }],
  bboxMm: { minX: -30, minY: -10, maxX: 30, maxY: 10 }, pointCount: 4, sourceMmPerPx: 1 };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 5, flatBottom: true });
const shapesById = new Map([[shape.id, shape]]);
const pocket = (extra: Partial<CutoutPlacement> = {}) => parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, cornerRoundMm: 0, bottomFilletMm: 0,
  split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "remaining", floorThicknessMm: 2 }] }, ...extra });
const layout = (c: CutoutPlacement) => ({ cutouts: [c], shapesById, fingerHoles: [] });

describe("split-pocket solids", () => {
  it("removes the analytic volume of two depths and keeps one connected bin", () => {
    const c = pocket();
    const base = buildBin(kernel, spec, PREVIEW_QUALITY).solid;
    const built = buildBinWithCutouts(kernel, spec, layout(c), PREVIEW_QUALITY);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(s => arena.track(s))).toHaveLength(1);
    const deep = resolvePocketDepth(spec, c.split!.depths[1]).depthMm!;
    expect(base.volume() - built.solid.volume()).toBeCloseTo(600 * (6 + deep), 5);
    expect(built.cutoutReports).toEqual([{ id: c.id, emptied: false }]);
  });

  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("equal depths preserve the unsplit rounded solid at quality %j", quality => {
    const c = pocket({ depth: { mode: "mm", value: 6 }, clearanceMm: 0.4, topFilletMm: 1, bottomFilletMm: 2.8, cornerRoundMm: 1 });
    c.split!.depths = [c.depth, c.depth];
    const split = buildBinWithCutouts(kernel, spec, layout(c), quality).solid;
    const whole = buildBinWithCutouts(kernel, spec, layout({ ...c, split: undefined }), quality).solid;
    expect(arena.track(split.subtract(whole)).volume()).toBeLessThan(1e-6);
    expect(arena.track(whole.subtract(split)).volume()).toBeLessThan(1e-6);
  });

  it.each([false, true])("keeps section identity and a sharp step after rotation, scaling and mirroring=%s", mirrored => {
    const c = pocket({ mirrored, rotationDeg: 37, scaleX: 1.3, scaleY: 0.7, position: { x: 4, y: -6 }, bottomFilletMm: 2.8, topFilletMm: 1 });
    const built = buildBinWithCutouts(kernel, spec, layout(c), EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    const retained = (localX: number, z: number) => {
      const p = transformPointPlacement({ x: localX, y: 0 }, c);
      const probe = arena.track(arena.track(wasm.Manifold.cube([0.1, 0.1, 0.1])).translate([p.x - 0.05, p.y - 0.05, z - 0.05]));
      return arena.track(built.solid.intersect(probe)).volume();
    };
    const top = resolvePocketDepth(spec, c.depth).infillTopZ;
    expect(retained(-10, top - 5.5)).toBeLessThan(1e-8);
    expect(retained(-10, top - 6.5)).toBeCloseTo(0.001, 8);
    expect(retained(10, 2.5)).toBeLessThan(1e-8);
    expect(retained(10, 1.5)).toBeCloseTo(0.001, 8);
    expect(retained(-0.2, 20)).toBeCloseTo(0.001, 8);
    expect(retained(0.2, 20)).toBeLessThan(1e-8);
    const { body, pocketFloors } = built.materialParts!;
    expect(pocketFloors).not.toBeNull();
    expect(arena.track(body.intersect(pocketFloors!)).volume()).toBeLessThan(1e-6);
    expect(body.volume() + pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 5);
  });

  it("rejects stale boundaries at the build boundary", () => {
    const c = pocket(); c.split!.boundary[0] = { x: 0, y: -9 };
    expect(() => buildBinWithCutouts(kernel, spec, layout(c), PREVIEW_QUALITY)).toThrow("Redraw the split");
  });

  it("keeps one continuous opening when a shallow section limits the shared top round", () => {
    const c = pocket({ topFilletMm: 5 });
    c.split!.depths[0] = { mode: "mm", value: 1 };
    const split = buildBinWithCutouts(kernel, spec, layout(c), EXPORT_QUALITY).solid;
    const reference = buildBinWithCutouts(kernel, spec, layout({ ...c, split: undefined, topFilletMm: 0.5, depth: { mode: "mm", value: 6 } }), EXPORT_QUALITY).solid;
    const z = resolvePocketDepth(spec, c.depth).infillTopZ - 0.1;
    const a = arena.track(split.slice(z)), b = arena.track(reference.slice(z));
    expect(arena.track(a.subtract(b)).area()).toBeLessThan(1e-6);
    expect(arena.track(b.subtract(a)).area()).toBeLessThan(1e-6);
  });

  it("supports a through section and auto-arranges the whole pocket with its split intact", () => {
    const c = pocket(); c.split!.depths[1] = { mode: "through" };
    const built = buildBinWithCutouts(kernel, spec, layout(c), PREVIEW_QUALITY);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(s => arena.track(s))).toHaveLength(1);
    const arranged = autoArrangeLayout([c], shapesById, spec.lip, spec.gridPitch, [], spec);
    expect(arranged).not.toBeNull();
    expect(arranged!.cutouts).toHaveLength(1);
    expect(arranged!.cutouts[0].split).toEqual(c.split);
  });
});
