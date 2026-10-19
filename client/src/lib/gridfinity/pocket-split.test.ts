import { wasm, arena, kernel, shape, spec, shapesById, pocket, layout } from "./pocket-split.test-support";
import { adjustPocketsForFillHeight } from "@shared/gridfinity/fill-height-edit";
import { describe, expect, it } from "vitest";
import { resolvePocketDepth, transformPointPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { autoArrangeLayout } from "./autoplace";

describe("split-pocket solids", () => {
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("preserves both split seats after adjusting fill height at quality %j", quality => {
    const original = pocket({ depth: { mode: "mm", value: 12 } });
    original.split!.depths = [{ mode: "mm", value: 12 }, { mode: "mm", value: 18 }];
    const lowered = { ...spec, fillHeightPercent: 75 };
    const adjusted = adjustPocketsForFillHeight([original], spec, lowered).cutouts![0];
    const before = buildBinWithCutouts(kernel, spec, layout(original), quality, { floorInsertThicknessMm: 0.6 });
    const after = buildBinWithCutouts(kernel, lowered, layout(adjusted), quality, { floorInsertThicknessMm: 0.6 });
    expect(after.solid.status()).toBe("NoError");
    const a = before.materialParts!.pocketFloors!, b = after.materialParts!.pocketFloors!;
    expect(arena.track(a.subtract(b)).volume()).toBeLessThan(1e-5);
    expect(arena.track(b.subtract(a)).volume()).toBeLessThan(1e-5);
  });

  it("keeps fixed and remaining-floor split depths at a lowered fill surface", () => {
    const lowered = parseBinSpec({ ...spec, fillHeightPercent: 50 });
    const c = pocket();
    const base = buildBin(kernel, lowered, EXPORT_QUALITY).solid;
    const built = buildBinWithCutouts(kernel, lowered, layout(c), EXPORT_QUALITY);
    // Half of the 26.8 mm fill above the base: top 20.4, remaining floor 2.
    expect(base.volume() - built.solid.volume()).toBeCloseTo(600 * (6 + 18.4), 5);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(s => arena.track(s))).toHaveLength(1);
  });

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

  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("builds edited contours with unchanged split coordinates at quality %j", quality => {
    const c = pocket();
    const edited = { ...shape, outlineMm: [{ outer: shape.outlineMm[0].outer.map((p, i) => i === 2 ? { ...p, y: 14 } : p), holes: [] }] };
    const base = buildBin(kernel, spec, quality).solid;
    const built = buildBinWithCutouts(kernel, spec, { ...layout(c), shapesById: new Map([[edited.id, edited]]) }, quality);
    expect(built.solid.status()).toBe("NoError");
    const deep = resolvePocketDepth(spec, c.split!.depths[1]).depthMm!;
    // The sloped top extends each side by a different amount; the step stays x=0.
    expect(base.volume() - built.solid.volume()).toBeCloseTo(630 * 6 + 690 * deep, 5);
    expect(c.split!.boundary).toEqual([{ x: 0, y: -10 }, { x: 0, y: 10 }]);
  });

  it("rejects a split line that no longer crosses the outline at the build boundary", () => {
    const c = pocket(); c.split!.boundary = [{ x: 40, y: -10 }, { x: 40, y: 10 }];
    expect(() => buildBinWithCutouts(kernel, spec, layout(c), PREVIEW_QUALITY)).toThrow("two connected sections");
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
  });});
