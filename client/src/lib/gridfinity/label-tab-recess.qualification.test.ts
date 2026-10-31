import { describe, expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { labelTabSurfaces, labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { compartmentHeightMm, compartmentLayout, compartmentLabelTabPlacements } from "@shared/gridfinity/compartments";
import { wallSlantPointMm } from "@shared/gridfinity/wall-slant";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { ringBounds } from "@shared/geometry/rings";
import { withKernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { buildBin, PREVIEW_QUALITY } from "./bin";
import { buildLabelTab } from "./label-tab";

describe("recessed label shelves", () => {
  it("keeps the metric bin's internal dividers above the label shelves", async () => {
    const spec = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, fill: "none", lip: "none",
      wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8,
      compartments: { rows: 2, columns: 3, dividerThicknessMm: 1.2 },
      labelTab: { wall: "south", scope: "compartments", recessMm: 0.4 } });
    await withKernel(kernel => {
      const built = buildBin(kernel, spec, PREVIEW_QUALITY).solid;
      const { columnCenters } = compartmentLayout(spec);
      const tabs = compartmentLabelTabPlacements(spec);
      for (const tab of [tabs[0], tabs[3]]) for (const x of columnCenters) {
        const z = 38.3;
        const p = wallSlantPointMm(spec, { x, y: tab.y + tab.depth / 2 }, z);
        const probe = kernel.arena.track(kernel.arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([p.x, p.y, z]));
        expect(kernel.arena.track(built.intersect(probe)).volume()).toBeCloseTo(0.001, 6);
      }
    });
  });
  it.each(["north", "south", "east", "west"] as const)("lowers %s shelves while preserving walls, dividers and attachment", async wall => {
    await withKernel(kernel => {
      for (const scope of ["outer", "compartments"] as const) for (const lip of ["none", "standard"] as const) {
        const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip,
          compartments: { rows: 2, columns: 2 }, labelTab: { wall, scope, width: "full", recessMm: 0.4 } });
        const plain = buildBin(kernel, { ...spec, labelTab: null }, PREVIEW_QUALITY).solid;
        const built = buildBin(kernel, spec, PREVIEW_QUALITY).solid;
        const added = kernel.arena.track(built.subtract(plain));
        expect(buildLabelTab(kernel, spec, 24)!.boundingBox().max[2]).toBeCloseTo(labelTabTopZ(spec), 6);
        // CSG subtraction can retain zero-volume coincident wall fragments.
        expect(kernel.arena.track(added.trimByPlane([0, 0, 1], labelTabTopZ(spec) + 0.01)).volume()).toBeLessThan(1e-5);
        expect(built.boundingBox()).toEqual(plain.boundingBox());
        expect(built.status()).toBe("NoError");
        expect(built.decompose().map(p => kernel.arena.track(p))).toHaveLength(1);
        expect(extractPrintableMeshData(kernel, built).indices.length).toBeGreaterThan(0);
        const surfaces = labelTabSurfaces(spec);
        expect(surfaces).toHaveLength(scope === "outer" ? 1 : 4);
        for (const surface of surfaces) {
          const b = ringBounds(surface.ring)!;
          const probe = (z: number) => kernel.arena.track(kernel.arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true))
            .translate([(b.minX + b.maxX) / 2 + (wall === "north" || wall === "south" ? 3 : 0),
              (b.minY + b.maxY) / 2 + (wall === "east" || wall === "west" ? 3 : 0), z]));
          expect(kernel.arena.track(added.intersect(probe(surface.z - 0.1))).volume()).toBeCloseTo(0.001, 6);
          expect(kernel.arena.track(added.intersect(probe(surface.z + 0.1))).volume()).toBeCloseTo(0, 7);
        }
        expect(labelTabTopZ(spec)).toBeCloseTo((scope === "compartments" ? BASE_HEIGHT + compartmentHeightMm(spec) : 42) - 0.4);
      }
    });
  });

  it.each([null, { axis: "y" as const, angleDeg: 30 }])("keeps shallow recessed tabs above the base (%j)", async wallSlant => {
    await withKernel(kernel => {
      for (const scope of ["outer", "compartments"] as const) {
        const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none", lip: "none", wallSlant,
          compartments: { rows: 2, columns: 2 }, labelTab: { wall: "south", scope, recessMm: 0.4 } });
        const plain = buildBin(kernel, { ...spec, labelTab: null }, PREVIEW_QUALITY).solid;
        const built = buildBin(kernel, spec, PREVIEW_QUALITY).solid;
        const added = kernel.arena.track(built.subtract(plain));
        expect(added.boundingBox().min[2]).toBeGreaterThanOrEqual(BASE_HEIGHT - 1e-5);
        expect(buildLabelTab(kernel, spec, 24)!.boundingBox().max[2]).toBeCloseTo(13.6, 6);
        expect(kernel.arena.track(added.slice(13.8)).area()).toBeLessThan(1e-5);
        expect(built.decompose().map(p => kernel.arena.track(p))).toHaveLength(1);
      }
    });
  });
});
