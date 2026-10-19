import { cv, photograph, expectClosed } from "./measurement-aid.test-support";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { loadManifold, withKernel } from "@/lib/manifold/runtime";
import { extractMeshData } from "@/lib/mesh/mesh-data";
import {
  expectPartitionOccupancy,
  expectPrintableTopology,
  signedMeshVolume,
} from "@/lib/mesh/mesh-contract.test-helpers";
import { mmPerPixel } from "@shared/geometry/scale";
import { runAutoCalibration } from "./auto-calibrate";
import { MEASUREMENT_AIDS, MEASUREMENT_AID_LENGTHS } from "./reference-strip";
import {
  measurementAidBlank,
  measurementAidMeshes,
  measurementAidStl,
  measurementAidThreeMf,
} from "./measurement-aid-mesh";

describe("50/100/200 mm printable measurement aids", () => {
  it.each(MEASUREMENT_AID_LENGTHS)("exports a closed %s × 15 × 2 mm assembly with finished edges and recessed STL", async (length) => {
    const wasm = await loadManifold();
    await withKernel((kernel) => {
      const parts = measurementAidMeshes(kernel, length);
      const blank = measurementAidBlank(kernel, length);
      const reference = extractMeshData(kernel, blank);
      const meshes = parts.map(({ mesh }) => ({ positions: new Float32Array(mesh.positions), indices: new Uint32Array(mesh.indices), normals: null }));
      // Preserve an independent reference before any importer can repair or
      // reinterpret the exported geometry. The checks below this block remain
      // separate evidence that the kernel also accepts the printable meshes.
      for (const mesh of meshes) expectPrintableTopology(mesh, "measurement aid material");
      expect(meshes.reduce((sum, mesh) => sum + signedMeshVolume(mesh), 0)).toBeCloseTo(signedMeshVolume(reference), 4);
      expectPartitionOccupancy(reference, meshes);
      const solids = parts.map(({ mesh }) => {
        expectClosed(mesh);
        const solid = kernel.arena.track(new kernel.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) })));
        expect(solid.status()).toBe("NoError");
        expect(solid.volume()).toBeGreaterThan(0);
        return solid;
      });
      expect(solids[0].volume() + solids[1].volume()).toBeCloseTo(blank.volume(), 4);
      expect(kernel.arena.track(solids[0].intersect(solids[1])).volume()).toBeCloseTo(0, 6);
      const combined = kernel.arena.track(solids[0].add(solids[1]));
      expect(combined.boundingBox()).toEqual({ min: [0, 0, 0], max: [length, 15, 2] });
      // Cross-sections prove a 45-degree lower chamfer, straight walls, then a top round.
      for (const [z, inset] of [[0.1, 0.2], [1, 0], [1.75, 0], [1.875, .25 * (1 - Math.cos(Math.PI / 6))]]) {
        const bounds = kernel.arena.track(combined.slice(z)).bounds();
        expect(bounds.min[0]).toBeCloseTo(inset, 4);
        expect(bounds.max[0]).toBeCloseTo(length - inset, 4);
      }
      expect(solids[1].boundingBox().min[2]).toBeCloseTo(1.6, 5);
      expect(solids[1].boundingBox().max[2]).toBe(2);

      const zip = unzipSync(measurementAidThreeMf(kernel, length));
      const model = strFromU8(zip["3D/3dmodel.model"]);
      expect(model).toContain('unit="millimeter"');
      expect(model.match(/<item /g)).toHaveLength(1);
      expect(model.match(/<component /g)).toHaveLength(2);
      expect(model).toContain("#FFFFFFFF"); expect(model).toContain("#000000FF");
      const settings = strFromU8(zip["Metadata/model_settings.config"]);
      expect(settings).toContain('key="extruder" value="1"');
      expect(settings).toContain('key="extruder" value="2"');

      const stl = measurementAidStl(kernel, length);
      const view = new DataView(stl);
      expect(view.getUint32(80, true)).toBe(parts[0].mesh.indices.length / 3);
      expect(stl.byteLength).toBe(84 + 50 * view.getUint32(80, true));
      // STL must contain the recessed carrier, not the unmarked solid blank.
      let deepestDetail = false;
      for (let i = 0; i < view.getUint32(80, true); i++) {
        for (let vertex = 0; vertex < 3; vertex++) {
          if (Math.abs(view.getFloat32(84 + i * 50 + 12 + vertex * 12 + 8, true) - 1.6) < 1e-5) deepestDetail = true;
        }
      }
      expect(deepestDetail).toBe(true);
    });
  }, 30_000);

  it.each(MEASUREMENT_AID_LENGTHS)("automatically selects the %s mm design from its exported markers, with labels and ticks visible", async (length) => {
    const parts = await withKernel((kernel) => measurementAidMeshes(kernel, length));
    for (const scale of [4, 6]) {
      const photo = photograph(parts[1].mesh, length, scale);
      const source = cv.matFromImageData(photo), rotated = new cv.Mat();
      try {
        for (const rotation of [null, cv.ROTATE_90_CLOCKWISE, cv.ROTATE_180]) {
          if (rotation !== null) cv.rotate(source, rotated, rotation);
          const image = rotation === null ? photo : { data: new Uint8ClampedArray(rotated.data), width: rotated.cols, height: rotated.rows, colorSpace: "srgb" } as ImageData;
          const result = runAutoCalibration(cv, image);
          expect(result.kind).toBe("calibrated-strip");
          if (result.kind !== "calibrated-strip") continue;
          expect(result.calibration.lengthMm).toBe(MEASUREMENT_AIDS[length].centerSpacingMm);
          expect(mmPerPixel(result.calibration)).toBeCloseTo(1 / scale, 3);
          expect("perspectiveProposal" in result).toBe(false);
        }
      } finally { source.delete(); rotated.delete(); }
    }
  });});
