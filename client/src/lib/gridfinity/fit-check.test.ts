import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fingerHoleSchema, parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildSurfaceFitCheckSolid } from "./fit-check";
import ryobiFixture from "./fixtures/ryobi-split-pocket.json";

let wasm: ManifoldToplevel;
let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());

const shape: TracedShape = { id: "tool", name: "Tool", outlineMm: [{ outer: [
  { x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: -6, y: 4 },
], holes: [] }], bboxMm: { minX: -6, minY: -4, maxX: 6, maxY: 4 }, pointCount: 4, sourceMmPerPx: 1 };

describe("surface fit outlines", () => {
  // This full-resolution mesh takes 8 seconds on CI, beyond Vitest's default.
  it("exports rounded Ryobi outlines without collapsed triangles", () => {
    const tool: TracedShape = ryobiFixture.shape;
    const outline = buildSurfaceFitCheckSolid(kernel, parseBinSpec(ryobiFixture.spec), {
      shapesById: new Map([[tool.id, tool]]),
      cutouts: [parseCutoutPlacement(ryobiFixture.cutout)], fingerHoles: [],
    }, 1.2, EXPORT_QUALITY, "outline");
    const mesh = outline.getMesh();
    let collapsedTriangles = 0;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const vertices = Array.from(mesh.triVerts.subarray(i, i + 3), vertex =>
        mesh.vertProperties.subarray(vertex * mesh.numProp, vertex * mesh.numProp + 3).join(","),
      );
      if (new Set(vertices).size < 3) collapsedTriangles++;
    }
    expect(collapsedTriangles).toBe(0);
  }, 30_000);

  it.each([false, true])("keeps only 5 mm tool bands at the chosen height (custom=%s)", custom => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6,
      ...(custom ? { footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } } : {}) });
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: -21, y: -21 },
      depth: { mode: "through" }, clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
    const layout = { shapesById: new Map([[shape.id, shape]]), cutouts: [cutout], fingerHoles: [] };
    const full = buildSurfaceFitCheckSolid(kernel, spec, layout, 1.6, PREVIEW_QUALITY);
    const outline = buildSurfaceFitCheckSolid(kernel, spec, layout, 1.6, PREVIEW_QUALITY, "outline");
    expect(outline.status()).toBe("NoError");
    expect(outline.boundingBox().min[0]).toBeCloseTo(-32);
    expect(outline.boundingBox().max[0]).toBeCloseTo(-10);
    expect(outline.boundingBox().min[1]).toBeCloseTo(-30);
    expect(outline.boundingBox().max[1]).toBeCloseTo(-12);
    expect(outline.boundingBox().min[2]).toBeCloseTo(0);
    expect(outline.boundingBox().max[2]).toBeCloseTo(1.6);
    expect(outline.volume()).toBeLessThan(full.volume());
    expect(arena.track(outline.subtract(full)).volume()).toBeLessThan(1e-7);
    const materialAt = (x: number, y: number) => {
      const probe = arena.track(arena.track(wasm.Manifold.cube([0.02, 0.02, 0.02])).translate([x - 0.01, y - 0.01, 0.8]));
      return arena.track(outline.intersect(probe)).volume();
    };
    expect(materialAt(41.75 - 4.9, -21)).toBeLessThan(1e-9);
    expect(materialAt(41.75 - 5.1, -21)).toBeLessThan(1e-9);
    // Only the tool band remains; the bin perimeter and pocket interior are empty.
    expect(materialAt(-27 - 4.9, -21)).toBeCloseTo(0.02 ** 3, 9);
    expect(materialAt(-27 - 5.1, -21)).toBeLessThan(1e-9);
    expect(materialAt(-21, -21)).toBeLessThan(1e-9);
  });

  it("does not clip the 5 mm band at the bin edge or add separate finger-hole bands", () => {
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 12, y: 0 },
      depth: { mode: "through" }, clearanceMm: 0, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
    const layout = { shapesById: new Map([[shape.id, shape]]), cutouts: [cutout], fingerHoles: [] };
    const small = buildSurfaceFitCheckSolid(kernel, parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2 }), layout, 1.2, PREVIEW_QUALITY, "outline");
    const large = buildSurfaceFitCheckSolid(kernel, parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 2 }), {
      ...layout, fingerHoles: [fingerHoleSchema.parse({ id: "access", center: { x: -30, y: 0 } })],
    }, 1.2, PREVIEW_QUALITY, "outline");
    expect(small.boundingBox().max[0]).toBeCloseTo(23);
    expect(small.boundingBox()).toEqual(large.boundingBox());
    expect(small.volume()).toBeCloseTo(large.volume(), 6);
  });

  it("requires a tool pocket instead of falling back to the bin or finger-hole outlines", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2 });
    const layout = { shapesById: new Map(), cutouts: [],
      fingerHoles: [fingerHoleSchema.parse({ id: "access", center: { x: 0, y: 0 } })] };
    expect(() => buildSurfaceFitCheckSolid(kernel, spec, layout, 1.2, PREVIEW_QUALITY, "outline"))
      .toThrow("Add a tool pocket");
  });
});
