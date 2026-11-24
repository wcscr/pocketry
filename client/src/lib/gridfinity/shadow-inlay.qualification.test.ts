import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { EXPORT_QUALITY } from "./bin";
import { buildCutoutCutters } from "./cutouts";
import { buildFitCheckSolid } from "./fit-check";

let wasm: ManifoldToplevel;
let arena: Arena;
let kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none" });
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
    const inlay = buildFitCheckSolid(kernel, shape, cutout, thickness, EXPORT_QUALITY, spec);
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
    const inlay = buildFitCheckSolid(kernel, rectangle, cutout, 0.6, EXPORT_QUALITY, spec, 0.3);
    expect(inlay.boundingBox().min[0]).toBeCloseTo(-10.2, 5);
    expect(inlay.boundingBox().max[0]).toBeCloseTo(10.2, 5);
  });

  it("rejects bottom rounding that leaves no printable flat seat", () => {
    const narrow = { ...shape, outlineMm: [{ outer: [
      { x: -1, y: -10 }, { x: 1, y: -10 }, { x: 1, y: 10 }, { x: -1, y: 10 },
    ], holes: [] }] };
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 10 }, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 2 });
    expect(() => buildFitCheckSolid(kernel, narrow, cutout, 0.6, EXPORT_QUALITY, spec)).toThrow(/flat seat|nothing to cut/);
  });
});
