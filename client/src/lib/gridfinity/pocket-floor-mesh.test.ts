import { describe, expect, it } from "vitest";

import type { MeshData } from "@/lib/mesh/mesh-data";

import {
  partitionPocketFloorTriangles,
} from "./pocket-floor-mesh";

function sampleMesh(): MeshData {
  return {
    positions: new Float32Array([
      // Upward pocket floor at z=7.
      0, 0, 7, 2, 0, 7, 0, 2, 7,
      // Downward face at the same height: must not be painted.
      4, 0, 7, 4, 2, 7, 6, 0, 7,
      // Upward top surface at a different height: must not be painted.
      0, 0, 40, 2, 0, 40, 0, 2, 40,
      // Sloped face touching the floor height: must not be painted.
      8, 0, 7, 10, 0, 7, 8, 2, 8,
    ]),
    normals: null,
    indices: new Uint32Array([
      0, 1, 2,
      3, 4, 5,
      6, 7, 8,
      9, 10, 11,
    ]),
  };
}

describe("partitionPocketFloorTriangles", () => {
  it("moves only horizontal upward-facing floor triangles into the second material group", () => {
    const partition = partitionPocketFloorTriangles(sampleMesh(), [7]);

    expect(partition.bodyIndexCount).toBe(9);
    expect(partition.floorIndexCount).toBe(3);
    expect(partition.indices).toEqual(
      new Uint32Array([
        3, 4, 5,
        6, 7, 8,
        9, 10, 11,
        0, 1, 2,
      ]),
    );
  });

  it("keeps one unchanged body group when there are no blind-pocket floor heights", () => {
    const mesh = sampleMesh();
    const partition = partitionPocketFloorTriangles(mesh, []);
    expect(partition.indices).toBe(mesh.indices);
    expect(partition.bodyIndexCount).toBe(mesh.indices.length);
    expect(partition.floorIndexCount).toBe(0);
  });

  it("keeps one unchanged body group when the requested floor is absent", () => {
    const mesh = sampleMesh();
    const partition = partitionPocketFloorTriangles(mesh, [12]);
    expect(partition.indices).toBe(mesh.indices);
    expect(partition.bodyIndexCount).toBe(mesh.indices.length);
    expect(partition.floorIndexCount).toBe(0);
  });
});
