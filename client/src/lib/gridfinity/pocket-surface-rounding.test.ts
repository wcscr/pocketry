import { arena, kernel, shape, spec, pocket, layout, cutter } from "./pocket-surface-rounding.test-support";
import { expect, it } from "vitest";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import { toCrossSection } from "@/lib/geometry/offset";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { buildSurfaceFitCheckSolid } from "./fit-check";

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("rounds a raised opening at the bin surface at quality %j", quality => {
  const top = resolvePocketDepth(spec, pocket.depth).infillTopZ;
  const rounded = buildBinWithCutouts(kernel, spec, layout(), quality).solid;
  const sharp = buildBinWithCutouts(kernel, spec, layout({ ...pocket, topFilletMm: 0 }), quality).solid;
  const probe = arena.track(kernel.Manifold.cube([0.1,0.1,0.1]).translate([10.7,-0.05,top-0.15]));
  expect(arena.track(sharp.intersect(probe)).volume()).toBeCloseTo(0.001, 7);
  expect(arena.track(rounded.intersect(probe)).volume()).toBeCloseTo(0, 7);
  expect(rounded.status()).toBe("NoError");
  expect(rounded.volume()).toBeLessThan(sharp.volume());
  const lower = arena.track(kernel.Manifold.cube([100,100,top-pocket.topFilletMm-0.1]).translate([-50,-50,0]));
  expect(arena.track(arena.track(sharp.subtract(rounded)).intersect(lower)).volume()).toBeLessThan(1e-6);
  expect(arena.track(rounded.subtract(sharp)).volume()).toBeLessThan(1e-6);
});

it("keeps a flush rigid pocket equivalent to the existing upright rounded bin", () => {
  const top = resolvePocketDepth(spec, pocket.depth).infillTopZ;
  const p = { ...pocket, elevationMm: top - 10, depth: { mode: "mm" as const, value: 10 } };
  const rigid = buildBinWithCutouts(kernel, spec, layout(p), EXPORT_QUALITY).solid;
  const legacy = buildBinWithCutouts(kernel, spec, layout({ ...p, elevationMm: undefined }), EXPORT_QUALITY).solid;
  expect(arena.track(rigid.subtract(legacy)).volume()).toBeLessThan(1e-5);
  expect(arena.track(legacy.subtract(rigid)).volume()).toBeLessThan(1e-5);
});

it.each([100, 50])("follows the actual fill surface at %s percent and shares its outline with inspection and fit tests", fillHeightPercent => {
  const bin = { ...spec, fillHeightPercent };
  const p = { ...pocket, elevationMm: 7 };
  const top = resolvePocketDepth(bin, p.depth).infillTopZ;
  const rounded = cutter(p, bin), sharp = cutter({ ...p, topFilletMm: 0 }, bin);
  const mouth = arena.track(rounded.slice(top - 1e-7));
  expect(mouth.bounds().max[0]).toBeCloseTo(12, 5);
  expect(mouth.area()).toBeGreaterThan(arena.track(sharp.slice(top - 1e-7)).area());
  const view = resolvedPocketGeometry(kernel, shape, p, bin);
  const outline = toCrossSection(kernel, view.opening);
  expect(arena.track(outline.subtract(mouth)).area()).toBeLessThan(1e-5);
  expect(arena.track(mouth.subtract(outline)).area()).toBeLessThan(1e-5);
  const fit = buildSurfaceFitCheckSolid(kernel, bin, layout(p), 0.8, EXPORT_QUALITY, "full");
  const openingProbe = arena.track(kernel.Manifold.cube([0.1,0.1,0.1]).translate([10.7,-0.05,0.65]));
  expect(arena.track(fit.intersect(openingProbe)).volume()).toBeCloseTo(0, 7);
});

it("does not create a rim or change the tool cap when the whole pocket is submerged", () => {
  const p = { ...pocket, elevationMm: 8, depth: { mode: "mm" as const, value: 10 } };
  const rounded = cutter(p), sharp = cutter({ ...p, topFilletMm: 0 });
  expect(arena.track(rounded.subtract(sharp)).volume()).toBeLessThan(1e-6);
  expect(arena.track(sharp.subtract(rounded)).volume()).toBeLessThan(1e-6);
  expect(resolvedPocketGeometry(kernel, shape, p, spec).opening).toEqual([]);
});
