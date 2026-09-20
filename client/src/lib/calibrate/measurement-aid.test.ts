import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { loadManifold, withKernel } from "@/lib/manifold/runtime";
import type { ThreeMfMesh } from "@/lib/mesh/threemf";
import { mmPerPixel } from "@shared/geometry/scale";
import { runAutoCalibration } from "./auto-calibrate";
import { MEASUREMENT_AIDS, MEASUREMENT_AID_LENGTHS, referenceStripMarkers } from "./reference-strip";
import { measurementAidBlank, measurementAidMeshes, measurementAidStl, measurementAidThreeMf } from "./measurement-aid-mesh";
import { measurementAidRulerMarks } from "./measurement-aid";
import { solveReferenceStrip } from "./solve-reference-strip";

// The shipped OpenCV ArUco API is untyped.
let cv: any;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);

/** Render the actual exported top triangles, independently of the print artwork. */
function photograph(mesh: ThreeMfMesh, length: number, scale: number): ImageData {
  const pad = 50, width = length * scale + 2 * pad, height = 15 * scale + 2 * pad;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = Array.from(mesh.indices.slice(offset, offset + 3)).map((index) => ({
      x: mesh.positions[index * 3], y: mesh.positions[index * 3 + 1], z: mesh.positions[index * 3 + 2],
    }));
    if (!vertices.every(({ z }) => Math.abs(z - 2) < 1e-5)) continue;
    const [a, b, c] = vertices.map(({ x, y }) => ({ x: pad + x * scale, y: pad + (15 - y) * scale }));
    const cross = (p: typeof a, q: typeof a, x: number, y: number) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    for (let row = Math.floor(Math.min(a.y, b.y, c.y)); row < Math.ceil(Math.max(a.y, b.y, c.y)); row++) {
      for (let col = Math.floor(Math.min(a.x, b.x, c.x)); col < Math.ceil(Math.max(a.x, b.x, c.x)); col++) {
        const signs = [cross(a, b, col + .5, row + .5), cross(b, c, col + .5, row + .5), cross(c, a, col + .5, row + .5)];
        if (signs.every((v) => v <= 0) || signs.every((v) => v >= 0)) {
          const at = (row * width + col) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function expectClosed(mesh: ThreeMfMesh): void {
  const edges = new Map<string, { count: number; winding: number }>();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    for (let i = 0; i < 3; i++) {
      const a = mesh.indices[offset + i], b = mesh.indices[offset + (i + 1) % 3];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++; edge.winding += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  expect([...edges.values()].every(({ count, winding }) => count === 2 && winding === 0)).toBe(true);
}

describe("50/100/200 mm printable measurement aids", () => {
  it.each(MEASUREMENT_AID_LENGTHS)("exports a closed %s × 15 × 2 mm assembly with finished edges and recessed STL", async (length) => {
    const wasm = await loadManifold();
    await withKernel((kernel) => {
      const parts = measurementAidMeshes(kernel, length);
      const solids = parts.map(({ mesh }) => {
        expectClosed(mesh);
        const solid = kernel.arena.track(new kernel.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) })));
        expect(solid.status()).toBe("NoError");
        expect(solid.volume()).toBeGreaterThan(0);
        return solid;
      });
      const blank = measurementAidBlank(kernel, length);
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
  });

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
  });

  it("rejects mixed lengths, multiple rulers and wrong spacing", () => {
    const markers = (length: 50 | 100 | 200) => referenceStripMarkers(MEASUREMENT_AIDS[length]).map(({ id, center, corners }) => ({ id, centerPx: center, cornersPx: corners }));
    const short = markers(50), medium = markers(100), long = markers(200);
    // Scale up so even the shortest baseline exceeds the minimum 40 pixels.
    const zoom = (ms: ReturnType<typeof markers>) => ms.map((m) => ({ ...m, centerPx: { x: m.centerPx.x * 4, y: m.centerPx.y * 4 }, cornersPx: m.cornersPx.map((p) => ({ x: p.x * 4, y: p.y * 4 })) as typeof m.cornersPx }));
    expect(solveReferenceStrip(zoom(short))?.mmPerPx).toBe(.25);
    expect(solveReferenceStrip(zoom([short[0], medium[1]]))).toBeNull();
    expect(solveReferenceStrip(zoom([...medium, ...long]))).toBeNull();
    expect(solveReferenceStrip(zoom(medium.map((m, i) => ({ ...m, id: MEASUREMENT_AIDS[50].markerIds[i] }))))).toBeNull();
  });

  it.each(MEASUREMENT_AID_LENGTHS)("keeps %s mm ruler ticks at physical millimetres and outside marker quiet zones", (length) => {
    const marks = measurementAidRulerMarks(length);
    for (let mm = 1; mm < length; mm++) {
      const ticks = marks.filter((mark) => Math.abs(mark.x + mark.width / 2 - mm) < 1e-8 && mark.width === .4 && (mark.y < 1 || mark.y > 13));
      expect(ticks).toHaveLength(2);
      expect(ticks[0].height).toBe(mm % 10 === 0 ? 1.15 : mm % 5 === 0 ? .95 : .7);
    }
    for (const { corners } of referenceStripMarkers(MEASUREMENT_AIDS[length])) {
      const x0 = corners[0].x - 1.5, y0 = corners[0].y - 1.5;
      const x1 = corners[2].x + 1.5, y1 = corners[2].y + 1.5;
      expect(marks.some(({ x, y, width, height }) => x < x1 && x + width > x0 && y < y1 && y + height > y0 + 1e-8)).toBe(false);
    }
  });
});
