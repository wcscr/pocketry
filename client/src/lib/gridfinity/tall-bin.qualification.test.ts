import { beforeAll, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { MAX_HEIGHT_UNITS, parseBinSpec } from "@shared/gridfinity/types";
import { binTotalHeightMm } from "@shared/gridfinity/standard";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { buildBin, EXPORT_QUALITY } from "./bin";

let wasm: Awaited<ReturnType<typeof loadManifold>>;
beforeAll(async () => { wasm = await loadManifold(); });

it.each([
  { heightUnits: 50.5, lip: "standard", fill: "none", wallThicknessMm: null },
  { heightUnits: 51, lip: "none", fill: "none", wallThicknessMm: 2 },
  { heightUnits: MAX_HEIGHT_UNITS, lip: "standard", fill: "none", wallThicknessMm: 3 },
  { heightUnits: MAX_HEIGHT_UNITS, lip: "none", fill: "solid", wallThicknessMm: 0.95 },
] as const)("exports a closed $heightUnits U $fill bin with $lip lip at its actual height", options => {
  const arena = new Arena();
  try {
    const kernel = createKernel(wasm, arena);
    const spec = parseBinSpec({ gridX: 2, gridY: 2, ...options });
    const built = buildBin(kernel, spec, EXPORT_QUALITY);
    const heightMm = binTotalHeightMm(spec.heightUnits, spec.lip === "standard");
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    expect(built.solid.boundingBox().min[2]).toBeCloseTo(0, 6);
    expect(built.solid.boundingBox().max[2]).toBeCloseTo(heightMm, 4);
    expect(built.solid.volume()).toBeGreaterThan(0);

    const mesh = extractPrintableMeshData(kernel, built.solid);
    const model = strFromU8(unzipSync(writeThreeMf([{ name: "Tall bin", mesh }]))["3D/3dmodel.model"]);
    const z = [...model.matchAll(/<vertex x="[^"]+" y="[^"]+" z="([^"]+)"/g)].map(match => Number(match[1]));
    expect(Math.min(...z)).toBeCloseTo(0, 4);
    expect(Math.max(...z)).toBeCloseTo(heightMm, 3);

    const stl = new DataView(writeBinarySTL(mesh));
    const triangles = stl.getUint32(80, true);
    expect(triangles).toBe(mesh.indices.length / 3);
    let stlMaxZ = -Infinity;
    for (let triangle = 0; triangle < triangles; triangle++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        stlMaxZ = Math.max(stlMaxZ, stl.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + 8, true));
      }
    }
    expect(stlMaxZ).toBeCloseTo(heightMm, 3);
    if (spec.heightUnits <= 51) expect(stlMaxZ).toBeLessThan(360);
  } finally {
    arena.dispose();
  }
});

it.each([[7.5, 0.95], [8, 1.2], [15, 1.2], [15.5, 1.2], [16, 1.6], [60, 1.6]])(
  "builds a %sU automatic hollow bin with an actual %s mm wall and unchanged stacking surfaces", (heightUnits, thickness) => {
    const arena = new Arena();
    try {
      const kernel = createKernel(wasm, arena);
      const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits, fill: "none" });
      expect(spec.wallThicknessMm).toBeNull();
      const automatic = buildBin(kernel, spec, EXPORT_QUALITY).solid;
      const thin = buildBin(kernel, { ...spec, wallThicknessMm: 0.95 }, EXPORT_QUALITY).solid;
      expect(automatic.status()).toBe("NoError");
      expect(automatic.decompose().map(part => arena.track(part))).toHaveLength(1);
      expect(automatic.boundingBox()).toEqual(thin.boundingBox());
      const probe = (inset: number) => arena.track(
        arena.track(kernel.Manifold.cube([0.01, 0.01, 0.01], true)).translate([41.75 - inset, 0, heightUnits * 3.5]),
      );
      expect(arena.track(automatic.intersect(probe(thickness - 0.01))).volume()).toBeCloseTo(0.01 ** 3, 10);
      expect(arena.track(automatic.intersect(probe(thickness + 0.01))).volume()).toBeLessThan(1e-10);
      // Preserve the foot and lip rather than thickening their mating surfaces.
      expect(arena.track(automatic.slice(0.2)).area()).toBeCloseTo(arena.track(thin.slice(0.2)).area(), 8);
      expect(arena.track(automatic.trimByPlane([0, 0, 1], heightUnits * 7 - 1)).volume())
        .toBeCloseTo(arena.track(thin.trimByPlane([0, 0, 1], heightUnits * 7 - 1)).volume(), 8);
      expect(extractPrintableMeshData(kernel, automatic).indices.length).toBeGreaterThan(0);
    } finally {
      arena.dispose();
    }
  },
);
