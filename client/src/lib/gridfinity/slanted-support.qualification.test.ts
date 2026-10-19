import { beforeAll, expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { binWidthMm, binLengthMm } from "@shared/gridfinity/bin-size";
import { wallSlantHeightMm } from "@shared/gridfinity/wall-slant";
import { validateBinSpec } from "@shared/gridfinity/validate";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";
import { buildBin, buildBinWithCutouts, binDimensionsMm, EXPORT_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { unzipSync, strFromU8 } from "fflate";

let wasm: ManifoldToplevel;
beforeAll(async () => { wasm = await loadManifold(); });

it("allows a warned support wedge through the worker and printable STL/3MF export", async () => {
  const spec = parseBinSpec({ gridX: 1, gridY: 2, heightUnits: 12, lip: "none",
    wallSlant: { axis: "x", side: "negative", angleDeg: 75 } });
  const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as
    (request: BuildBinRequest, context: HandlerContext) => Promise<TransferableResult<BuildBinResult>>;
  const result = (await handler({ spec, quality: EXPORT_QUALITY, exportTopology: true, stackingRimMaterialThicknessMm: 1.25 },
    { signal: new AbortController().signal, progress: () => {} })).value;
  expect(result.validationIssues?.filter(issue => issue.severity === "error")).toEqual([]);
  expect(result.materialMeshes?.stackingRim).toBeUndefined();
  expectPrintableTopology(result.mesh, "exported support wedge");
  const stl = writeBinarySTL(result.mesh);
  expect(new DataView(stl).getUint32(80, true)).toBe(result.mesh.indices.length / 3);
  const model = strFromU8(unzipSync(writeThreeMf([{ name: "75 degree support wedge", mesh: result.mesh }]))["3D/3dmodel.model"]);
  expect(model).toContain("75 degree support wedge");
});

it.each([0.1, -0.1])("colors only a ridge that reaches the requested rim, with %s mm clearance", clearanceMm => {
  const arena = new Arena();
  const kernel = createKernel(wasm, arena);
  try {
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 6, lip: "none",
      wallSlant: { axis: "x", side: "negative", angleDeg: Math.atan(41.5 / (35 - clearanceMm)) * 180 / Math.PI } });
    const built = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY, { rimInsertThicknessMm: 1.25 });
    const rim = built.materialParts?.stackingRim;
    if (clearanceMm > 0) expect(rim ?? null).toBeNull();
    else {
      expect(rim?.volume()).toBeGreaterThan(0);
      expectPrintableTopology(extractPrintableMeshData(kernel, rim!), "requested-height wedge rim");
    }
  } finally { arena.dispose(); }
});

it.each(["x", "y"] as const)("exports steep %s support wedges with either wall vertical and the base unchanged", axis => {
  const arena = new Arena();
  const kernel = createKernel(wasm, arena);
  try {
    for (const side of ["negative", "positive"] as const) {
      for (const angle of [60, 75, 89]) {
        for (const fill of ["none", "solid"] as const) {
          const spec = parseBinSpec({ gridX: 1, gridY: 2, heightUnits: 12, lip: "none", fill,
            wallSlant: { axis, side, angleDeg: side === "negative" ? angle : -angle } });
          const built = buildBin(kernel, spec, EXPORT_QUALITY);
          const upright = buildBin(kernel, { ...spec, wallSlant: null }, EXPORT_QUALITY);
          const span = axis === "x" ? binWidthMm(spec) : binLengthMm(spec);
          const height = BASE_HEIGHT + span / Math.tan(angle * Math.PI / 180);
          expect(built.solid.status()).toBe("NoError");
          expect(built.solid.boundingBox().max[2]).toBeCloseTo(height, 5);
          expect(binDimensionsMm(spec).totalHeightMm).toBeCloseTo(height, 5);
          expect(built.parts.base.boundingBox()).toEqual(upright.parts.base.boundingBox());
          expect(built.parts.base.volume()).toBeCloseTo(upright.parts.base.volume(), 6);
          const componentVolumes = built.solid.decompose().map(part => arena.track(part).volume());
          // A closed hollow wedge also has a negatively oriented cavity shell.
          expect(componentVolumes.filter(volume => volume > 1e-6), `${axis}/${side}/${angle}/${fill}: ${componentVolumes}`).toHaveLength(1);
          const z = BASE_HEIGHT + (height - BASE_HEIGHT) * 0.5;
          const bounds = arena.track(built.parts.wall!.slice(z)).bounds();
          const i = axis === "x" ? 0 : 1;
          expect(bounds.min[i]).toBeCloseTo(side === "positive" ? -span / 2 : 0, 4);
          expect(bounds.max[i]).toBeCloseTo(side === "negative" ? span / 2 : 0, 4);
          expect(arena.track(built.solid.slice(height + 0.01)).isEmpty()).toBe(true);
          expect(validateBinSpec(spec).ok).toBe(true);
          expect(validateBinSpec(spec).issues).toContainEqual(expect.objectContaining({ code: "slanted-wall-closure", severity: "warning" }));
          expectPrintableTopology(extractPrintableMeshData(kernel, built.solid), `${axis}/${side}/${angle}/${fill}`);
        }
      }
    }
  } finally { arena.dispose(); }
});

it.each(["none", "solid"] as const)("keeps %s wedges below the requested rim free of rim color", fill => {
  const arena = new Arena();
  const kernel = createKernel(wasm, arena);
  try {
    const spec = parseBinSpec({ gridX: 1, gridY: 2, heightUnits: 12, lip: "none", fill,
      wallSlant: { axis: "x", angleDeg: 75, side: "negative" } });
    const built = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 1.25 });
    expect(built.materialParts?.stackingRim ?? null).toBeNull();
    if (!built.materialParts) {
      expect(fill).toBe("solid");
      expectPrintableTopology(extractPrintableMeshData(kernel, built.solid), "single-color support wedge");
      return;
    }
    const parts = [built.materialParts.body, built.materialParts.pocketFloors].filter(part => part !== null);
    const meshes = parts.map(part => extractPrintableMeshData(kernel, part));
    meshes.forEach((mesh, i) => expectPrintableTopology(mesh, `wedge material ${i}`));
    expect(meshes.reduce((volume, mesh) => volume + signedMeshVolume(mesh), 0)).toBeCloseTo(built.solid.volume(), 2);
  } finally { arena.dispose(); }
});

it.each(["north", "south", "east", "west"] as const)("clips a %s label tab with a custom-footprint wedge without floating parts", wall => {
  const arena = new Arena();
  const kernel = createKernel(wasm, arena);
  try {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 12, lip: "none", fill: "none",
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      labelTab: { wall, width: "full" }, wallSlant: { axis: "x", angleDeg: -75, side: "positive" } });
    const built = buildBin(kernel, spec, EXPORT_QUALITY);
    expect(built.solid.decompose().map(part => arena.track(part).volume()).filter(volume => volume > 1e-6)).toHaveLength(1);
    expectPrintableTopology(extractPrintableMeshData(kernel, built.solid), `custom wedge/${wall}`);
    expect(built.solid.boundingBox().max[2]).toBeLessThanOrEqual(wallSlantHeightMm(spec) + 1e-5);
  } finally { arena.dispose(); }
});
