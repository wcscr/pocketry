import { wasm, arena, kernel, shape, spec, shapesById } from "./pocket-split.test-support";
import { describe, expect, it } from "vitest";
import {
  parseCutoutPlacement,
  resolvePocketDepth,
  transformPointPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import ryobiSeamFixture from "./fixtures/ryobi-split-pocket.json";
import ryobiReloadFixture from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";
import { parseProjectDoc } from "@shared/gridfinity/project";

describe("split-pocket solids", () => {

  // Full-resolution Ryobi meshes take 7–10 seconds on CI; keep export quality.
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("reloads the saved Ryobi with a 16 mm blade recess and 55 mm body recess at quality %j", quality => {
    // Reduced from the library backup reported after switching designs. Probe
    // inside the blade and body so swapped depths cannot pass a volume check.
    const doc = parseProjectDoc(JSON.parse(JSON.stringify(ryobiReloadFixture)))!;
    const cutout = doc.cutouts[0];
    const built = buildBinWithCutouts(kernel, doc.spec, {
      shapesById: new Map(doc.shapes.map(shape => [shape.id, shape])),
      cutouts: doc.cutouts, fingerHoles: doc.fingerHoles,
    }, quality, { floorInsertThicknessMm: 0.6 });
    const top = resolvePocketDepth(doc.spec, cutout.depth).infillTopZ;
    for (const { local, depth } of [
      { local: { x: -43, y: 80 }, depth: 16 },
      { local: { x: 2, y: -13 }, depth: 55 },
    ]) {
      const p = transformPointPlacement(local, cutout);
      for (const offset of [-0.2, 0.2]) {
        const probe = arena.track(arena.track(wasm.Manifold.cube([0.1, 0.1, 0.1]))
          .translate([p.x - 0.05, p.y - 0.05, top - depth + offset - 0.05]));
        const retained = arena.track(built.solid.intersect(probe)).volume();
        expect(retained).toBeCloseTo(offset < 0 ? 0.001 : 0, 8);
      }
    }
    expect(built.solid.status()).toBe("NoError");
  }, 30_000);

  // Match the full-resolution fixture budget used by the reload regression.
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("leaves no seam sheet above the Ryobi shelf at quality %j", quality => {
    // Reduced from the reported project: keep its outline, transform, split,
    // depths and bin geometry, without the unrelated shape-library history.
    const c = parseCutoutPlacement(ryobiSeamFixture.cutout);
    const binSpec = parseBinSpec(ryobiSeamFixture.spec);
    const tool: TracedShape = ryobiSeamFixture.shape;
    const built = buildBinWithCutouts(kernel, binSpec, {
      cutouts: [c], shapesById: new Map([[tool.id, tool]]), fingerHoles: [],
    }, quality, { floorInsertThicknessMm: 0.6 });
    const [a, b] = c.split!.boundary.map(p => transformPointPlacement(p, c));
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    const offset = nx * a.x + ny * a.y;
    const shelfZ = Math.max(...c.split!.depths.map(depth => resolvePocketDepth(binSpec, depth).floorZ!));
    const mesh = built.solid.getMesh();
    let upperSeamArea = 0;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const points = Array.from(mesh.triVerts.slice(i, i + 3), vertex => {
        const start = vertex * mesh.numProp;
        return Array.from(mesh.vertProperties.slice(start, start + 3));
      });
      if (!points.every(p => Math.abs(nx * p[0] + ny * p[1] - offset) < 1e-3) ||
          Math.max(...points.map(p => p[2])) <= shelfZ + c.bottomFilletMm + 1e-3) continue;
      const u = points[1].map((value, axis) => value - points[0][axis]);
      const v = points[2].map((value, axis) => value - points[0][axis]);
      upperSeamArea += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
    // A zero-thickness sheet can have negligible volume and still render as a
    // wall. Inspect surface area; the broken preview had >2600 mm² here.
    // Allow only tiny float32 triangles where the rounded perimeter meets it.
    expect(upperSeamArea).toBeLessThan(0.01);
    expect(built.solid.status()).toBe("NoError");
    const { body, pocketFloors } = built.materialParts!;
    expect(arena.track(body.intersect(pocketFloors!)).volume()).toBeLessThan(1e-6);
    expect(body.volume() + pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 5);
  }, 30_000);});
