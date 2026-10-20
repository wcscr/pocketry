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
  { heightUnits: 50.5, lip: "standard", fill: "none", wallThicknessMm: 0.95 },
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
