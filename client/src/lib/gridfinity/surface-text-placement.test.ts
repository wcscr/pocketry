import { describe, expect, it } from "vitest";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec } from "@shared/gridfinity/types";
import { signedDistanceToInterior } from "@shared/gridfinity/cutout";
import { withKernel } from "@/lib/manifold/runtime";
import { outlineBounds } from "@/lib/geometry/outline";
import { buildBinWithCutouts, PREVIEW_QUALITY } from "./bin";
import { createBasicPocket } from "./basic-shape";
import { surfaceTextOutline } from "./surface-text";
import { placeSurfaceTextOnSurface, surfaceTextObstacles } from "./surface-text-placement";
import { expectAllSurfaceTextBuilt } from "./surface-text.test-support";

const fresh = surfaceTextSchema.parse({ id: "new", text: "Text", font: "helvetiker", position: { x: 0, y: 0 } });

describe("new surface text placement", () => {
  it("starts at the front centre of an empty solid bin, inside the stacking lip", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3 });
    const placed = placeSurfaceTextOnSurface(spec, fresh, []);
    expect(placed.position.x).toBeCloseTo(0, 0);
    expect(placed.position.y).toBeLessThan(-25);
    const b = outlineBounds(surfaceTextOutline(placed))!;
    for (const corner of [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]) {
      expect(signedDistanceToInterior(corner, spec)).toBeGreaterThan(1.5 + 1.65 - 1e-6);
    }
  });

  it("moves off a central pocket so the whole bin still previews with the label", async () => {
    // The reported case: a narrow driver bin whose only free space is above and below the pocket.
    const pocket = createBasicPocket("rectangle", { x: -8, y: -50 }, { x: 8, y: 50 }, "driver")!;
    const spec = parseBinSpec({ gridPitch: "half", gridX: 2, gridY: 7, heightUnits: 3 });
    const label = placeSurfaceTextOnSurface(spec, fresh, surfaceTextObstacles(spec, [pocket.cutout], [pocket.shape], []));
    expect(label.position).not.toEqual({ x: 0, y: 0 });
    expect(Math.abs(label.position.y)).toBeGreaterThan(50);
    await withKernel(kernel => {
      expectAllSurfaceTextBuilt(buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [label] }, {
        cutouts: [pocket.cutout], shapesById: new Map([[pocket.shape.id, pocket.shape]]), fingerHoles: [],
      }, PREVIEW_QUALITY), 1);
    });
  });

  it("avoids existing labels and stays put when nothing fits", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3 });
    const first = placeSurfaceTextOnSurface(spec, fresh, []);
    const withFirst = { ...spec, surfaceTexts: [first] };
    const second = placeSurfaceTextOnSurface(withFirst, { ...fresh, id: "second" }, surfaceTextObstacles(withFirst, [], [], []));
    const a = outlineBounds(surfaceTextOutline(first))!, b = outlineBounds(surfaceTextOutline(second))!;
    expect(a.maxY < b.minY || b.maxY < a.minY || a.maxX < b.minX || b.maxX < a.minX).toBe(true);
    const full = createBasicPocket("rectangle", { x: -40, y: -40 }, { x: 40, y: 40 }, "full")!;
    expect(placeSurfaceTextOnSurface(spec, fresh, surfaceTextObstacles(spec, [full.cutout], [full.shape], []))).toBe(fresh);
  });

  it("leaves tab and hollow-bin labels to tab placement", () => {
    const hollow = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none" });
    expect(placeSurfaceTextOnSurface(hollow, fresh, [])).toBe(fresh);
    const tabbed = { ...fresh, surface: "label-tab" as const };
    expect(placeSurfaceTextOnSurface(parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), tabbed, [])).toBe(tabbed);
  });

  it("keeps clear of a solid bin's label-tab shelf", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, labelTab: { wall: "south", width: "full" } });
    const placed = placeSurfaceTextOnSurface(spec, fresh, surfaceTextObstacles(spec, [], [], []));
    const b = outlineBounds(surfaceTextOutline(placed))!;
    const shelf = surfaceTextObstacles(spec, [], [], [])[0].ring;
    expect(b.minY).toBeGreaterThan(Math.max(...shelf.map(p => p.y)));
  });
});
