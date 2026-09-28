import { describe, expect, it } from "vitest";
import { withKernel } from "@/lib/manifold/runtime";
import { toCrossSection } from "@/lib/geometry/offset";
import { objectEdges } from "@/lib/mesh/object-edges";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { buildObjectCavity } from "./object-cavity";
import { resolvedObjectGeometry } from "./object-geometry";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { buildRigidPocket } from "./cutouts";

describe("views of one source solid", () => {
  it("draws twelve cube edges without face diagonals, even after its arena closes", async () => {
    const view = await withKernel(kernel => resolvedObjectGeometry(kernel,
      kernel.arena.track(kernel.Manifold.cube([10, 20, 30])), 20));
    const edges = objectEdges(view.mesh);
    expect(edges).toHaveLength(24);
    for (let i = 0; i < edges.length; i += 2) {
      expect(edges[i].filter((value, axis) => value !== edges[i + 1][axis])).toHaveLength(1);
    }
    await withKernel(kernel => {
      expect(toCrossSection(kernel, view.full).area()).toBeCloseTo(200);
      expect(toCrossSection(kernel, view.opening).area()).toBeCloseTo(200);
    });
  });

  it("accepts a rotated non-extruded model, with a finite surface intersection", async () => {
    await withKernel(kernel => {
      const source = kernel.arena.track(kernel.Manifold.hull([[0, 0, 0], [8, 0, 0], [0, 6, 0], [0, 0, 10]]));
      const solid = buildObjectCavity(kernel, source,
        { rotation: { xDeg: 145, yDeg: -90, zDeg: 32 }, position: { x: 3, y: -2 }, elevationMm: 7 }, Infinity)!;
      const view = resolvedObjectGeometry(kernel, solid, 10);
      expect(objectEdges(view.mesh)).toHaveLength(12);
      expect(toCrossSection(kernel, view.opening).area()).toBeCloseTo(kernel.arena.track(solid.slice(10 - 1e-7)).area(), 5);
      expect(resolvedObjectGeometry(kernel, solid, 40).opening).toEqual([]);
      expect(resolvedObjectGeometry(kernel, solid, 6).opening).toEqual([]);
    });
  });

  it("handles empty solids and keeps smoothly rounded sources visible as a surface", async () => {
    await withKernel(kernel => {
      const empty = resolvedObjectGeometry(kernel, kernel.arena.track(kernel.Manifold.union([])), 10);
      expect(empty.full).toEqual([]);
      expect(empty.opening).toEqual([]);
      expect(objectEdges(empty.mesh)).toEqual([]);
      const sphere = resolvedObjectGeometry(kernel, kernel.arena.track(kernel.Manifold.sphere(10, 64)), 0);
      expect(sphere.mesh.indices.length).toBeGreaterThan(0);
      expect(objectEdges(sphere.mesh).length).toBeLessThan(sphere.mesh.indices.length / 4);
    });
  });

  it("uses the actual rounded, mirrored split cutter for every preview view", async () => {
    const shape: TracedShape = { id: "s", name: "Holed step", sourceMmPerPx: 1, pointCount: 10,
      bboxMm: { minX: 0, minY: 0, maxX: 30, maxY: 20 }, outlineMm: [{
        outer: [[0,0],[30,0],[30,10],[20,10],[20,20],[0,20]].map(([x,y]) => ({x,y})),
        holes: [[[5,5],[5,10],[10,10],[10,5]].map(([x,y]) => ({x,y}))],
      }] };
    const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none", fill: "solid" });
    const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 3, y: -4 },
      elevationMm: 30, rotationDeg: 23, tilt: { xDeg: 70, yDeg: -20 }, mirrored: true,
      depth: { mode: "mm", value: 6 }, clearanceMm: 0.4, cornerRoundMm: 1, bottomFilletMm: 1,
      split: { boundary: [{x:0,y:12},{x:30,y:12}], depths: [{mode:"mm",value:6},{mode:"mm",value:12}] } });
    await withKernel(kernel => {
      const view = resolvedPocketGeometry(kernel, shape, cutout, spec);
      const source = buildRigidPocket(kernel, shape, cutout, spec, { circularSegments: 64, cutoutVertexBudget: 600 }).cutters[0];
      expect(view.mesh.indices.length).toBe(source.getMesh().triVerts.length);
      expect(Array.from(view.mesh.positions).every(Number.isFinite)).toBe(true);
      for (const [actual, expected] of [[view.full, kernel.arena.track(source.project())],
        [view.opening, kernel.arena.track(source.slice(42 - 1e-7))]] as const) {
        const section = toCrossSection(kernel, actual);
        expect(kernel.arena.track(section.subtract(expected)).area()).toBeCloseTo(0, 5);
        expect(kernel.arena.track(expected.subtract(section)).area()).toBeCloseTo(0, 5);
      }
    });
  });
});
