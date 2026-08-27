import { ringBounds } from "@shared/geometry/rings";
import type { Outline, Point } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { cShapeRing, polygonArea, rectRing } from "@/lib/geometry/fixtures";
import { buildOutline, outlineArea } from "@/lib/geometry/outline";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold } from "@/lib/manifold/runtime";

import { generateDXF } from "./dxf";
import { toModelSpace, type ExportScale } from "./scale";
import {
  extrudeOutlineWithKernel,
  generateSTL,
  writeBinarySTL,
  type StlMesh,
} from "./stl";

type Vec3 = [number, number, number];

interface Facet {
  normal: Vec3;
  vertices: [Vec3, Vec3, Vec3];
}

const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;

/**
 * Reads back a binary STL. Everything below asserts against the actual bytes
 * rather than the mesh that produced them, so the writer is covered too.
 */
function parseSTL(buffer: ArrayBuffer): { header: string; count: number; facets: Facet[] } {
  const view = new DataView(buffer);
  const header = new TextDecoder()
    .decode(new Uint8Array(buffer, 0, HEADER_BYTES))
    .replace(/\0+$/, "");
  const count = view.getUint32(HEADER_BYTES, true);

  const facets: Facet[] = [];
  for (let i = 0; i < count; i++) {
    const base = HEADER_BYTES + 4 + i * TRIANGLE_BYTES;
    const read = (offset: number): Vec3 => [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    facets.push({
      normal: read(base),
      vertices: [read(base + 12), read(base + 24), read(base + 36)],
    });
    // The attribute byte count is unused by every mainstream reader.
    expect(view.getUint16(base + 48, true)).toBe(0);
  }
  return { header, count, facets };
}

/** Σ v0 · (v1 × v2) / 6 — the volume enclosed by a closed, outward-wound mesh. */
function signedVolume(facets: readonly Facet[]): number {
  let total = 0;
  for (const { vertices } of facets) {
    const [a, b, c] = vertices;
    const cross: Vec3 = [
      b[1] * c[2] - b[2] * c[1],
      b[2] * c[0] - b[0] * c[2],
      b[0] * c[1] - b[1] * c[0],
    ];
    total += a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2];
  }
  return total / 6;
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Euler characteristic of the surface, plus a real watertightness check.
 *
 * Vertices are deduped by their exact float32 bytes, which is safe because
 * neighbouring facets share the same stored values. For a closed, consistently
 * wound surface every directed half-edge appears exactly once and its opposite
 * exists; `genus` then follows from V − E + F = 2 − 2g.
 */
function topology(facets: readonly Facet[]): {
  vertices: number;
  edges: number;
  genus: number;
  watertight: boolean;
} {
  const ids = new Map<string, number>();
  const idOf = (vertex: Vec3): number => {
    const key = vertex.join(",");
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    ids.set(key, ids.size);
    return ids.size - 1;
  };

  const halfEdges = new Map<string, number>();
  for (const { vertices } of facets) {
    const corners = vertices.map(idOf);
    for (let i = 0; i < 3; i++) {
      const key = `${corners[i]}>${corners[(i + 1) % 3]}`;
      halfEdges.set(key, (halfEdges.get(key) ?? 0) + 1);
    }
  }

  let watertight = halfEdges.size === facets.length * 3;
  for (const [key, count] of halfEdges) {
    const [from, to] = key.split(">");
    if (count !== 1 || !halfEdges.has(`${to}>${from}`)) watertight = false;
  }

  const vertices = ids.size;
  const edges = halfEdges.size / 2;
  const characteristic = vertices - edges + facets.length;
  return { vertices, edges, genus: (2 - characteristic) / 2, watertight };
}

/** Facets lying flat on the build plate. */
function baseFacets(facets: readonly Facet[]): Facet[] {
  return facets.filter(({ vertices }) => vertices.every((v) => v[2] === 0));
}

/** Unsigned XY area of a facet. */
function facetAreaXY({ vertices }: Facet): number {
  const [a, b, c] = vertices;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

/** How many facets cover `point` in XY. Exactly 1 for a valid triangulation. */
function coverage(facets: readonly Facet[], point: Point): number {
  const side = (a: Vec3, b: Vec3): number =>
    (b[0] - a[0]) * (point.y - a[1]) - (b[1] - a[1]) * (point.x - a[0]);

  return facets.filter(({ vertices }) => {
    const [a, b, c] = vertices;
    const s0 = side(a, b);
    const s1 = side(b, c);
    const s2 = side(c, a);
    return (s0 > 0 && s1 > 0 && s2 > 0) || (s0 < 0 && s1 < 0 && s2 < 0);
  }).length;
}

/**
 * Relative-error assertion. Volumes here run to five figures, where an absolute
 * `toBeCloseTo` tolerance is either meaningless or hostage to float32 rounding.
 */
function expectClose(actual: number, expected: number, tolerance = 1e-4): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tolerance);
}

function minZ(facets: readonly Facet[]): number {
  return Math.min(...facets.flatMap(({ vertices }) => vertices.map((v) => v[2])));
}

function maxZ(facets: readonly Facet[]): number {
  return Math.max(...facets.flatMap(({ vertices }) => vertices.map((v) => v[2])));
}

/** A 100×100 square with a 20×20 hole. */
function annulus(): Outline {
  return buildOutline([rectRing(0, 0, 100, 100), rectRing(40, 40, 20, 20)]);
}

const uncalibrated: ExportScale = { mmPerPx: null, imageHeight: 200 };
const calibrated: ExportScale = { mmPerPx: 0.5, imageHeight: 200 };

describe("writeBinarySTL — file structure", () => {
  it("is exactly 84 + 50·T bytes with a matching count field", async () => {
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    const { count, facets } = parseSTL(buffer);

    expect(buffer.byteLength).toBe(84 + 50 * count);
    expect(facets).toHaveLength(count);
    expect(count).toBeGreaterThan(0);
  });

  it("does not start with the word solid", async () => {
    // Several readers sniff the first five bytes instead of checking the
    // length, and would then parse a binary file as ASCII.
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    expect(parseSTL(buffer).header.startsWith("solid")).toBe(false);
  });

  it("defuses a caller-supplied header that would look like ASCII", () => {
    const mesh = triangleMesh();
    const { header } = parseSTL(writeBinarySTL(mesh, "solid tool-42"));

    expect(header.startsWith("solid")).toBe(false);
    expect(header).toContain("tool-42");
  });

  it("keeps a custom header, truncated to 80 bytes", () => {
    const mesh = triangleMesh();
    expect(parseSTL(writeBinarySTL(mesh, "ToolTrace / hammer")).header).toBe(
      "ToolTrace / hammer",
    );
    const long = "x".repeat(200);
    expect(writeBinarySTL(mesh, long).byteLength).toBe(84 + 50);
    expect(parseSTL(writeBinarySTL(mesh, long)).header).toHaveLength(80);
  });

  it("writes an 84-byte file for an empty mesh", () => {
    const buffer = writeBinarySTL({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    });
    expect(buffer.byteLength).toBe(84);
    expect(parseSTL(buffer).count).toBe(0);
  });

  it("rejects a malformed index list", () => {
    expect(() =>
      writeBinarySTL({ positions: new Float32Array(9), indices: new Uint32Array(4) }),
    ).toThrow(/multiple of 3/);
    expect(() =>
      writeBinarySTL({
        positions: new Float32Array(9),
        indices: Uint32Array.from([0, 1, 7]),
      }),
    ).toThrow(/past the vertex list/);
  });
});

describe("writeBinarySTL — normals", () => {
  it("computes a real per-facet normal", () => {
    // Regression: every legacy facet was hardcoded to (0, 0, 1), including the
    // bottom and the walls, so a slicer had to guess at the geometry.
    const mesh: StlMesh = {
      positions: Float32Array.from([0, 0, 0, 0, 0, 2, 0, 3, 0]),
      indices: Uint32Array.from([0, 1, 2]),
    };
    const [facet] = parseSTL(writeBinarySTL(mesh)).facets;

    // A triangle in the x = 0 plane, wound so the normal points at −x.
    expect(facet.normal).toEqual([-1, 0, 0]);
  });

  it("emits a zero normal for a degenerate facet", () => {
    // Legal per the spec, and readers recompute from the winding.
    const mesh: StlMesh = {
      positions: Float32Array.from([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      indices: Uint32Array.from([0, 1, 2]),
    };
    expect(parseSTL(writeBinarySTL(mesh)).facets[0].normal).toEqual([0, 0, 0]);
  });

  it("gives every facet of a real export a unit normal", async () => {
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    for (const facet of parseSTL(buffer).facets) {
      expect(length(facet.normal)).toBeCloseTo(1, 5);
    }
  });

  it("makes every normal perpendicular to its own facet", async () => {
    // Unit length alone does not catch the legacy bug: the hardcoded (0, 0, 1)
    // is a unit vector. Perpendicularity is what rules it out — it is wrong for
    // the base and 90° wrong for every side wall.
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    for (const { normal, vertices } of parseSTL(buffer).facets) {
      const [a, b, c] = vertices;
      for (const other of [b, c]) {
        const edge: Vec3 = [other[0] - a[0], other[1] - a[1], other[2] - a[2]];
        const dot =
          normal[0] * edge[0] + normal[1] * edge[1] + normal[2] * edge[2];
        expect(Math.abs(dot) / length(edge)).toBeLessThan(1e-5);
      }
    }
  });

  it("gives the side walls horizontal normals", async () => {
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    const walls = parseSTL(buffer).facets.filter(({ vertices }) =>
      vertices.some((v) => v[2] === 0) && vertices.some((v) => v[2] === 5),
    );

    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls) expect(Math.abs(wall.normal[2])).toBeLessThan(1e-5);
  });

  it("points the base facets down and the top facets up", async () => {
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    const { facets } = parseSTL(buffer);

    for (const facet of baseFacets(facets)) {
      expect(facet.normal[2]).toBeCloseTo(-1, 5);
    }
    const top = facets.filter(({ vertices }) => vertices.every((v) => v[2] === 5));
    expect(top.length).toBeGreaterThan(0);
    for (const facet of top) expect(facet.normal[2]).toBeCloseTo(1, 5);
  });
});

describe("generateSTL — solid", () => {
  it("rests on the build plate", async () => {
    const buffer = await generateSTL(annulus(), { heightMm: 7, scale: calibrated });
    const { facets } = parseSTL(buffer);

    expect(minZ(facets)).toBe(0);
    expect(maxZ(facets)).toBeCloseTo(7, 5);
  });

  it("encloses area × height, wound outward", async () => {
    // A negative volume would mean the whole solid is inside out — the mesh
    // would look right in a viewer and print as a cavity.
    const outline = annulus();
    const heightMm = 5;
    const buffer = await generateSTL(outline, { heightMm, scale: calibrated });
    const { facets } = parseSTL(buffer);

    const expected = outlineArea(toModelSpace(outline, calibrated)) * heightMm;
    expect(expected).toBeCloseTo((10000 - 400) * 0.25 * 5, 6);
    expect(signedVolume(facets)).toBeGreaterThan(0);
    expectClose(signedVolume(facets), expected);
  });

  it("is watertight and closed", async () => {
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    expect(topology(parseSTL(buffer).facets).watertight).toBe(true);
  });

  it("has genus 1 when the outline has a hole", async () => {
    // An extruded annulus is a torus: one handle. Getting this right is the
    // proof that the hole survived into the solid rather than being filled.
    const buffer = await generateSTL(annulus(), { heightMm: 5, scale: calibrated });
    expect(topology(parseSTL(buffer).facets).genus).toBe(1);
  });

  it("has genus 0 for a simple outline", async () => {
    const buffer = await generateSTL(buildOutline([rectRing(0, 0, 40, 40)]), {
      heightMm: 5,
      scale: calibrated,
    });
    expect(topology(parseSTL(buffer).facets).genus).toBe(0);
  });

  it("stays in pixel units when uncalibrated", async () => {
    const outline = buildOutline([rectRing(0, 0, 100, 100)]);
    const buffer = await generateSTL(outline, { heightMm: 5, scale: uncalibrated });
    const { facets } = parseSTL(buffer);

    // 100 px × 100 px × 5 "mm": the file is only meaningful once a ruler has
    // been set, which is why `describeScale` exists.
    expectClose(signedVolume(facets), 100 * 100 * 5);
  });

  it("rejects a height that would produce an empty solid", async () => {
    await expect(
      generateSTL(annulus(), { heightMm: 0, scale: calibrated }),
    ).rejects.toThrow(/positive/);
    await expect(
      generateSTL(annulus(), { heightMm: Number.NaN, scale: calibrated }),
    ).rejects.toThrow(/positive/);
  });

  it("produces an empty file for an empty outline", async () => {
    const buffer = await generateSTL([], { heightMm: 5, scale: calibrated });
    expect(buffer.byteLength).toBe(84);
  });
});

describe("generateSTL — concave outlines", () => {
  const heightMm = 5;

  it("triangulates a concave base without covering the bay", async () => {
    // Regression: the legacy writer fanned the base from the polygon centroid.
    // For a C that centroid sits *in the bay*, so the fan laid triangles across
    // empty space and cancelled them with inverted ones. Signed measures cannot
    // see that — the shoelace sum is fan-origin independent, and the legacy fan
    // sums to exactly ±7600 — so this counts *unsigned* coverage instead.
    const buffer = await generateSTL(buildOutline([cShapeRing()]), {
      heightMm,
      scale: uncalibrated,
    });
    const base = baseFacets(parseSTL(buffer).facets);

    // Off-lattice probes, to stay clear of any triangulation edge. The bay
    // probe sits where the legacy fan double-covered the void: it reports 2
    // there, against 0 for a real triangulation.
    const inBay: Point = { x: 52.3, y: 200 - 50.7 };
    const inMaterial: Point = { x: 17.3, y: 200 - 51.7 };
    expect(coverage(base, inBay)).toBe(0);
    expect(coverage(base, inMaterial)).toBe(1);
  });

  it("lays down exactly the polygon's area of base facets", async () => {
    // The same regression measured globally: a fan over a concave polygon
    // covers part of the plane twice, so Σ|facet| exceeds the polygon area
    // even though the signed sum still matches it. The legacy fan over this C
    // lays down 10800 units of facet for a 7600 unit polygon.
    const outline = buildOutline([cShapeRing()]);
    const buffer = await generateSTL(outline, { heightMm, scale: uncalibrated });
    const base = baseFacets(parseSTL(buffer).facets);
    const covered = base.reduce((sum, facet) => sum + facetAreaXY(facet), 0);

    expect(polygonArea(cShapeRing())).toBe(7600);
    expectClose(covered, 7600);
  });

  it("encloses the true volume, not the inflated one", async () => {
    const outline = buildOutline([cShapeRing()]);
    const buffer = await generateSTL(outline, { heightMm, scale: uncalibrated });
    const volume = signedVolume(parseSTL(buffer).facets);

    // 7600 px² × 5, not the 10000 px² of the C's hull.
    expect(volume).toBeGreaterThan(0);
    expectClose(volume, 7600 * heightMm);
    expect(volume).toBeLessThan(10000 * heightMm);
  });

  it("stays watertight over a concave outline", async () => {
    const buffer = await generateSTL(buildOutline([cShapeRing()]), {
      heightMm,
      scale: uncalibrated,
    });
    const { watertight, genus } = topology(parseSTL(buffer).facets);
    expect(watertight).toBe(true);
    expect(genus).toBe(0);
  });
});

describe("DXF and STL handedness", () => {
  /**
   * Regression for the mirrored-export bug: `generateDXF` negated y and
   * `generateSTL` did not, so every shadow board came out flipped relative to
   * its drawing. Both now go through `toModelSpace`.
   *
   * The image is 240 px tall while the C is 100 px, so a missing flip moves the
   * geometry rather than merely re-labelling a symmetric shape.
   */
  const scale: ExportScale = { mmPerPx: null, imageHeight: 240 };
  const outline = buildOutline([cShapeRing()]);

  /** The single LWPOLYLINE's vertices. */
  function dxfRing(): Point[] {
    const lines = generateDXF(outline, scale).split("\n");
    const points: Point[] = [];
    for (let i = 0; i + 3 < lines.length; i += 2) {
      if (lines[i].trim() !== "10") continue;
      points.push({ x: Number(lines[i + 1]), y: Number(lines[i + 3]) });
    }
    return points;
  }

  it("puts the bay at the same place in both formats", async () => {
    const buffer = await generateSTL(outline, { heightMm: 5, scale });
    const base = baseFacets(parseSTL(buffer).facets);

    // The bay's back wall is at x = 40, spanning pixel y 30..70 — which the
    // flip maps to 210 and 170. An unflipped STL would leave it at 30 and 70.
    const cornerYs = new Set(
      base
        .flatMap(({ vertices }) => vertices)
        .filter((v) => Math.abs(v[0] - 40) < 1e-6)
        .map((v) => v[1]),
    );
    expect([...cornerYs].sort((a, b) => a - b)).toEqual([170, 210]);

    const dxfCornerYs = new Set(
      dxfRing()
        .filter((p) => Math.abs(p.x - 40) < 1e-6)
        .map((p) => p.y),
    );
    expect([...dxfCornerYs].sort((a, b) => a - b)).toEqual([170, 210]);
  });

  it("agrees vertex for vertex", async () => {
    const buffer = await generateSTL(outline, { heightMm: 5, scale });
    const stlBase = baseFacets(parseSTL(buffer).facets).flatMap(({ vertices }) =>
      vertices.map((v) => ({ x: v[0], y: v[1] })),
    );

    for (const point of dxfRing()) {
      const matched = stlBase.some(
        (v) => Math.abs(v.x - point.x) < 1e-4 && Math.abs(v.y - point.y) < 1e-4,
      );
      expect(matched).toBe(true);
    }
    expect(ringBounds(dxfRing())).toEqual({
      minX: 0,
      minY: 140, // 240 − 100
      maxX: 100,
      maxY: 240,
    });
  });

  it("opens the bay toward the same side in both", async () => {
    const buffer = await generateSTL(outline, { heightMm: 5, scale });
    const base = baseFacets(parseSTL(buffer).facets);
    const ring = dxfRing();

    // +x is empty in both; −x is material in both.
    const bay: Point = { x: 83.7, y: 240 - 49.3 };
    const material: Point = { x: 17.3, y: 240 - 51.7 };
    expect(coverage(base, bay)).toBe(0);
    expect(coverage(base, material)).toBe(1);
    expect(pointInRingXY(ring, bay)).toBe(false);
    expect(pointInRingXY(ring, material)).toBe(true);
  });
});

describe("extrudeOutlineWithKernel", () => {
  it("tracks every handle it creates in the caller's arena", async () => {
    const wasm = await loadManifold();
    const arena = new Arena();
    const kernel = createKernel(wasm, arena);

    try {
      // The CrossSection and the extruded Manifold; `extrude` already rests on
      // z = 0, so no translate handle is created.
      extrudeOutlineWithKernel(kernel, toModelSpace(annulus(), calibrated), 5);
      expect(arena.size).toBe(2);
    } finally {
      arena.dispose();
    }
    expect(arena.size).toBe(0);
  });

  it("returns positions that outlive the arena", async () => {
    // The mesh is copied out of the kernel's memory; a view into it would be
    // dangling by the time the caller serialises it.
    const wasm = await loadManifold();
    const arena = new Arena();
    const mesh = extrudeOutlineWithKernel(
      createKernel(wasm, arena),
      toModelSpace(buildOutline([rectRing(0, 0, 100, 100)]), calibrated),
      5,
    );
    arena.dispose();

    expect(mesh.positions.length).toBeGreaterThan(0);
    expectClose(signedVolume(parseSTL(writeBinarySTL(mesh)).facets), 50 * 50 * 5);
  });
});

/** Crossing-number test in XY, for comparing a DXF ring with STL facets. */
function pointInRingXY(ring: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a.y > point.y === b.y > point.y) continue;
    const t = (point.y - a.y) / (b.y - a.y);
    if (point.x < a.x + t * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** One triangle, for exercising the writer without the kernel. */
function triangleMesh(): StlMesh {
  return {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2]),
  };
}
