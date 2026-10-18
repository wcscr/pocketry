import { describe, expect, it } from "vitest";
import type { CrossSection, Vec2 } from "manifold-3d";
import { withKernel, type Kernel } from "@/lib/manifold/runtime";
import { bottomFilletCutter, type ExtrusionBand } from "./fillet-stack";
import { clipExtrusionBands, planarInsertionCutter, sweepCrossSection } from "./planar-insertion-sweep";

function sameSection(kernel: Kernel, actual: CrossSection, expected: CrossSection) {
  expect(kernel.arena.track(actual.subtract(expected)).area()).toBeLessThan(1e-7);
  expect(kernel.arena.track(expected.subtract(actual)).area()).toBeLessThan(1e-7);
}

describe("planar insertion sweeps", () => {
  it("shrinks a hole only where translated material crosses it", async () => withKernel(kernel => {
    const { arena, CrossSection } = kernel;
    const source = arena.track(CrossSection.ofPolygons([
      [[0,0],[20,0],[20,20],[0,20]], [[5,5],[5,15],[15,15],[15,5]],
    ]));
    const expected = arena.track(CrossSection.ofPolygons([
      [[0,0],[23,0],[23,20],[0,20]], [[8,5],[8,15],[15,15],[15,5]],
    ]));
    sameSection(kernel, sweepCrossSection(kernel, source, [3,0]), expected);
  }));

  it.each([1,-1])("retains the concave opening when moving in X direction %s", async sign => withKernel(kernel => {
    const { arena, CrossSection } = kernel;
    const source = arena.track(CrossSection.ofPolygons([
      [[0,0],[20,0],[20,5],[5,5],[5,15],[20,15],[20,20],[0,20]],
    ]));
    const left = Math.min(0, sign * 3), right = 20 + Math.max(0, sign * 3), recess = 5 + Math.max(0, sign * 3);
    const expected = arena.track(CrossSection.ofPolygons([
      [[left,0],[right,0],[right,5],[recess,5],[recess,15],[right,15],[right,20],[left,20]],
    ]));
    sameSection(kernel, sweepCrossSection(kernel, source, [sign*3,0]), expected);
  }));

  it("clips diagonal split sections before they cross the original boundary", async () => withKernel(kernel => {
    const { arena, CrossSection } = kernel;
    const section = arena.track(CrossSection.ofPolygons([[[0,0],[8,0],[8,8],[0,8]]]));
    const bands = clipExtrusionBands(kernel, [{ section, bottom: 0, height: 4 }], [1,1], 8);
    expect(bands).toHaveLength(1);
    expect(bands[0].section.area()).toBeCloseTo(32, 8);
    const moved = arena.track(arena.track(bands[0].section.extrude(4)).translate([-4,0,0]));
    const swept = planarInsertionCutter(kernel, bands, [-4,0]);
    expect(arena.track(moved.subtract(swept)).volume()).toBeLessThan(1e-7);
    // This part of the swept object now lies across the original split plane.
    expect(arena.track(moved.trimByPlane([-1,-1,0],-8)).volume()).toBeGreaterThan(1);
  }));

  it.each([{ delta: [5,0] as Vec2 }, { delta: [0,-5] as Vec2 }])("retains the exact fillet bands along $delta", async ({ delta }) => withKernel(kernel => {
    const { arena, CrossSection, Manifold } = kernel;
    const section = arena.track(CrossSection.ofPolygons([[[0,0],[12,0],[12,12],[0,12]]]));
    const bands: ExtrusionBand[] = [];
    const source = bottomFilletCutter(kernel, section, 8, { radiusMm: 1, profileStepMm: .2, circularSegments: 16 }, bands);
    const rebuilt = arena.track(Manifold.union(bands.map(b => arena.track(arena.track(b.section.extrude(b.height)).translate([0,0,b.bottom])))));
    expect(arena.track(source.subtract(rebuilt)).volume()).toBeLessThan(1e-7);
    expect(arena.track(rebuilt.subtract(source)).volume()).toBeLessThan(1e-7);
    const swept = planarInsertionCutter(kernel, bands, delta);
    for (const fraction of [0,.01,.5,1]) {
      const moved = arena.track(source.translate([delta[0]*fraction,delta[1]*fraction,0]));
      expect(arena.track(moved.subtract(swept)).volume()).toBeLessThan(1e-7);
    }
  }));
});
