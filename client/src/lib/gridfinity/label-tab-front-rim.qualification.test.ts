import { expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { labelTabSurfaces, labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { labelTabFrontRimWidthMm } from "@shared/gridfinity/label-tab";
import { ringBounds } from "@shared/geometry/rings";
import { wallSlantPointMm } from "@shared/gridfinity/wall-slant";
import { withKernel } from "@/lib/manifold/runtime";
import { buildBin, PREVIEW_QUALITY } from "./bin";

it.each(["north", "south", "east", "west"] as const)("frames %s shelves at wall height, with continuous attached rims", async wall => {
  for (const scope of ["outer", "compartments"] as const) for (const slanted of [false, true]) {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: slanted ? "none" : "standard",
      wallThicknessMm: 1.6, wallSlant: slanted ? { axis: wall === "north" || wall === "south" ? "y" : "x", angleDeg: 30 } : null,
      compartments: { rows: 2, columns: 2 }, labelTab: { wall, scope, width: "full", recessMm: 0.5, frontRim: true } });
    const open = { ...spec, labelTab: { ...spec.labelTab!, frontRim: false } };
    const upright = { ...open, wallSlant: null };
    await withKernel(kernel => {
      const before = buildBin(kernel, open, PREVIEW_QUALITY).solid;
      const after = buildBin(kernel, spec, PREVIEW_QUALITY).solid;
      const added = kernel.arena.track(after.subtract(before));
      expect(after.status()).toBe("NoError");
      expect(after.decompose().map(p => kernel.arena.track(p)).filter(p => p.volume() > 1e-6)).toHaveLength(1);
      expect(kernel.arena.track(before.subtract(after)).volume()).toBeLessThan(1e-5);
      expect(added.volume()).toBeGreaterThan(1);
      expect(kernel.arena.track(added.trimByPlane([0, 0, 1], labelTabTopZ(spec) + 0.50001)).volume()).toBeLessThan(1e-5);
      const width = labelTabFrontRimWidthMm(spec, 100);
      for (const surface of labelTabSurfaces(upright)) {
        const b = ringBounds(surface.ring)!;
        const p = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        if (wall === "north") p.y = b.minY + width / 2;
        if (wall === "south") p.y = b.maxY - width / 2;
        if (wall === "east") p.x = b.minX + width / 2;
        if (wall === "west") p.x = b.maxX - width / 2;
        // The centre of an outer tab crosses an existing internal divider.
        if (wall === "north" || wall === "south") p.x += 3;
        else p.y += 3;
        const z = labelTabTopZ(spec) + 0.25, warped = wallSlantPointMm(spec, p, z);
        const probe = kernel.arena.track(kernel.arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([warped.x, warped.y, z]));
        expect(kernel.arena.track(added.intersect(probe)).volume(), JSON.stringify({ wall, scope, slanted, p, warped, z, bounds: added.boundingBox() })).toBeCloseTo(0.001, 6);
      }
    });
  }
});
