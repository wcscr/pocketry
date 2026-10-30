import {
  getHandler,
  previewMeshVolume,
  getFitCheckHandler,
  getSurfaceFitCheckHandler,
  context,
  nonManifoldEdgeCount,
  printableMeshVolume,
  REQUEST,
} from "./bin-worker-handlers.test-support";
import { describe, expect, it, vi } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { binTotalHeightMm } from "@shared/gridfinity/standard";
import { parseBinSpec } from "@shared/gridfinity/types";
import { WorkerCancelledError } from "@/lib/worker/protocol";
import { partitionPocketFloorTriangles } from "./pocket-floor-mesh";
import { createBasicPocket } from "./basic-shape";
import { type BuildBinRequest, type BuildSurfaceFitCheckRequest } from "./worker-api";

it("keeps a complete preview surface beneath a colored slanted tab border", async () => {
  const request: BuildBinRequest = {
    spec: parseBinSpec({
      gridX: 1, gridY: 4, heightUnits: 2.5, lip: "none", fill: "none",
      wallSlant: { axis: "y", angleDeg: 45 },
      labelTab: { wall: "north", width: "full" },
    }),
    quality: { circularSegments: 32 },
    stackingRimMaterialThicknessMm: 1.25,
    borderWidthMm: 0.95,
  };
  const handler = getHandler();
  const preview = (await handler(request, context())).value;
  const printable = (await handler({ ...request, exportTopology: true }, context())).value;
  expect(preview.materialMeshes?.stackingRim).toBeDefined();
  expect(previewMeshVolume(preview.materialMeshes!.body)).toBeCloseTo(
    previewMeshVolume(preview.mesh), 2,
  );
  expect(printableMeshVolume(printable.materialMeshes!.body)).toBeLessThan(
    printableMeshVolume(printable.mesh),
  );
  expect(printableMeshVolume(printable.materialMeshes!.body) +
    printableMeshVolume(printable.materialMeshes!.stackingRim!)).toBeCloseTo(
      printableMeshVolume(printable.mesh), 2,
    );
});

describe("bin worker handlers", () => {

  it("validates authored rounding before approximating a draft", async () => {
    const { shape, cutout } = createBasicPocket("rectangle", { x: -10, y: -10 }, { x: 10, y: 10 }, "invalid")!;
    await expect(getHandler()({ ...REQUEST, previewDraft: true,
      layout: { shapes: [shape], cutouts: [{ ...cutout, topFilletMm: -1 }], fingerHoles: [] },
    }, context())).rejects.toThrow();
  });

  it("builds a bin and nominates its buffers for transfer", async () => {
    const progress = vi.fn();
    const result = await getHandler()(REQUEST, context({ progress }));

    const { mesh, stats } = result.value;
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.normals).not.toBeNull();
    expect(mesh.indices.length % 3).toBe(0);
    expect(stats.triangles).toBe(mesh.indices.length / 3);
    expect(stats.volumeMm3).toBeGreaterThan(0);
    expect(stats.buildMs).toBeGreaterThan(0);

    expect(result.transfer).toContain(mesh.positions.buffer);
    expect(result.transfer).toContain(mesh.indices.buffer);
    expect(result.transfer).toContain(mesh.normals!.buffer);

    // Progress is monotonic and lands short of 1 (the client sets 1 itself).
    const values = progress.mock.calls.map(([value]) => value as number);
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(values.at(-1)!).toBeLessThan(1);
  });

  it("re-validates the spec at the worker boundary", async () => {
    await expect(
      getHandler()(
        { spec: { gridX: 0, gridY: 1, heightUnits: 2 }, quality: { circularSegments: 16 } },
        context(),
      ),
    ).rejects.toThrow();
  });

  it("rejects with a cancellation once the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getHandler()(REQUEST, context({ signal: controller.signal })),
    ).rejects.toThrow(WorkerCancelledError);
  });

  it("builds a layout's pockets and reports per cutout", async () => {
    const shape = {
      id: "s1",
      name: "square",
      outlineMm: [
        {
          outer: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 },
          ],
          holes: [],
        },
      ],
      bboxMm: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      pointCount: 4,
      sourceMmPerPx: 0.2,
    };
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3, fill: "solid" });
    const placement = parseCutoutPlacement({
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
      depth: { mode: "remaining", floorThicknessMm: 7 },
    });
    const withPocket = await getHandler()(
      {
        spec,
        quality: { circularSegments: 16, cutoutVertexBudget: 150 },
        layout: {
          shapes: [shape],
          cutouts: [placement],
          fingerHoles: [],
        },
      },
      context(),
    );
    const plain = await getHandler()(
      {
        spec,
        quality: { circularSegments: 16, cutoutVertexBudget: 150 },
      },
      context(),
    );

    expect(withPocket.value.cutoutReports).toEqual([{ id: "c1", emptied: false }]);
    expect(withPocket.value.materialMeshes).toBeUndefined();
    expect(plain.value.cutoutReports).toEqual([]);
    expect(withPocket.value.stats.volumeMm3).toBeLessThan(plain.value.stats.volumeMm3);

    const floorZ = resolvePocketDepth(spec, placement.depth).floorZ;
    expect(floorZ).not.toBeNull();
    const partition = partitionPocketFloorTriangles(withPocket.value.mesh, [floorZ!]);
    expect(partition.floorIndexCount).toBeGreaterThan(0);
    const floorIndices = partition.indices.slice(partition.bodyIndexCount);
    const xs = Array.from(floorIndices, (index) => withPocket.value.mesh.positions[index * 3]);
    const ys = Array.from(
      floorIndices,
      (index) => withPocket.value.mesh.positions[index * 3 + 1],
    );
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(10);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);

    const multicolor = await getHandler()(
      {
        spec,
        quality: { circularSegments: 16, cutoutVertexBudget: 150 },
        layout: { shapes: [shape], cutouts: [placement], fingerHoles: [] },
        pocketFloorMaterialThicknessMm: 0.8,
        stackingRimMaterialThicknessMm: 1.2,
      },
      context(),
    );
    const materialMeshes = multicolor.value.materialMeshes;
    expect(multicolor.value.mesh.normals).toBeNull();
    expect(materialMeshes).toBeDefined();
    expect(materialMeshes!.body.indices.length).toBeGreaterThan(0);
    expect(materialMeshes!.body.normals).not.toBeNull();
    expect(materialMeshes!.pocketFloors!.indices.length).toBeGreaterThan(0);
    expect(materialMeshes!.pocketFloors!.normals).not.toBeNull();
    expect(materialMeshes!.stackingRim!.indices.length).toBeGreaterThan(0);
    expect(materialMeshes!.stackingRim!.normals).not.toBeNull();
    const floorZs = Array.from(
      materialMeshes!.pocketFloors!.positions.filter((_, index) => index % 3 === 2),
    );
    expect(Math.min(...floorZs)).toBeCloseTo(floorZ! - 0.8, 5);
    expect(Math.max(...floorZs)).toBeCloseTo(floorZ!, 5);
    const rimZs = Array.from(
      materialMeshes!.stackingRim!.positions.filter((_, index) => index % 3 === 2),
    );
    const rimTopZ = binTotalHeightMm(spec.heightUnits, true);
    expect(Math.min(...rimZs)).toBeCloseTo(rimTopZ - 1.2, 5);
    expect(Math.max(...rimZs)).toBeCloseTo(rimTopZ, 5);
    expect(multicolor.transfer).toContain(materialMeshes!.body.positions.buffer);
    expect(multicolor.transfer).toContain(materialMeshes!.body.indices.buffer);
    expect(multicolor.transfer).toContain(materialMeshes!.body.normals!.buffer);
    expect(multicolor.transfer).toContain(
      materialMeshes!.pocketFloors!.positions.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.pocketFloors!.indices.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.pocketFloors!.normals!.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.stackingRim!.positions.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.stackingRim!.indices.buffer,
    );
    expect(multicolor.transfer).toContain(
      materialMeshes!.stackingRim!.normals!.buffer,
    );
  });

  it("returns the exact material partition for a sectioned preview", async () => {
    const result = await getHandler()(
      {
        ...REQUEST,
        section: { axis: "x", offsetMm: 0 },
        stackingRimMaterialThicknessMm: 5,
      },
      context(),
    );

    expect(result.value.materialMeshes?.stackingRim).toBeDefined();
    expect(result.value.mesh.normals).toBeNull();
    for (const mesh of [
      result.value.materialMeshes!.body,
      result.value.materialMeshes!.stackingRim!,
    ]) {
      const xs = Array.from(
        mesh.positions.filter((_, index) => index % 3 === 0),
      );
      expect(Math.max(...xs)).toBeLessThanOrEqual(0.001);
      expect(mesh.normals).not.toBeNull();
    }
  });

  it("keeps fallback normals when requested materials have no printable volume", async () => {
    const result = await getHandler()({
      spec: { gridX: 1, gridY: 1, heightUnits: 3, lip: "none", fill: "solid" },
      quality: { circularSegments: 16 },
      pocketFloorMaterialThicknessMm: 0.6,
    }, context());
    expect(result.value.materialMeshes).toBeUndefined();
    expect(result.value.mesh.normals?.length).toBe(result.value.mesh.positions.length);
    expect(result.value.mesh.indices.length).toBeGreaterThan(0);
  });

  it.each([undefined, 1.25].flatMap(stackingRimMaterialThicknessMm =>
    [-62.75, -63].map(offsetMm => ({ stackingRimMaterialThicknessMm, offsetMm })),
  ))("handles an empty aggregate at X=$offsetMm with rim material=$stackingRimMaterialThicknessMm", async ({ stackingRimMaterialThicknessMm, offsetMm }) => {
    const request: BuildBinRequest = {
      spec: { gridX: 3, gridY: 7, heightUnits: 3, fill: "solid" },
      quality: { circularSegments: 16 }, stackingRimMaterialThicknessMm,
    };
    const whole = await getHandler()(request, context());
    const cut = await getHandler()({ ...request, section: { axis: "x", offsetMm } }, context());
    expect(cut.value.mesh.indices).toHaveLength(0);
    expect(cut.value.stats.triangles).toBe(0);
    expect(cut.value.stats.volumeMm3).toBe(whole.value.stats.volumeMm3);
    if (cut.value.materialMeshes) {
      // Independent boolean trims can leave tiny coplanar fragments exactly
      // on the boundary. Every surviving body vertex still needs its normal.
      const body = cut.value.materialMeshes.body;
      expect(body.normals?.length).toBe(body.positions.length);
      if (offsetMm < -62.75) expect(body.positions).toHaveLength(0);
      expect(cut.value.materialMeshes.stackingRim).toBeUndefined();
    }
    expect(new Set(cut.transfer).size).toBe(cut.transfer.length);
    const moved = structuredClone(cut.value, { transfer: cut.transfer });
    expect(moved.mesh.indices).toHaveLength(0);
  });

  it("rejects a malformed layout at the boundary", async () => {
    await expect(
      getHandler()(
        {
          spec: { gridX: 1, gridY: 1, heightUnits: 2 },
          quality: { circularSegments: 16 },
          layout: {
            shapes: [],
            cutouts: [{ id: "c1", shapeId: "s1", position: { x: Number.NaN, y: 0 } }],
          },
        } as never,
        context(),
      ),
    ).rejects.toThrow();
  });

  it("rejects out-of-range material thicknesses at the worker boundary", async () => {
    await expect(
      getHandler()(
        {
          ...REQUEST,
          stackingRimMaterialThicknessMm: 7.36,
        },
        context(),
      ),
    ).rejects.toThrow("Stacking-rim material thickness must be between 0.2 and 7.35 mm");
  });

  it.each([NaN, Infinity, -1, 0, 0.19, 20.01])("rejects invalid border width %s before building", async borderWidthMm => {
    await expect(getHandler()({ ...REQUEST, borderWidthMm }, context()))
      .rejects.toThrow("Top-border color width must be between 0.2 and 20 mm");
  });});

describe("section view (G4)", () => {
  it("trims the displayed mesh but keeps whole-bin stats", async () => {
    const handler = getHandler();
    const full = await handler(REQUEST, context());
    const cut = await handler(
      { ...REQUEST, section: { axis: "x", offsetMm: 0 } },
      context(),
    );

    // The 1×1 bin spans ±20.875; keeping x ≤ 0 halves the mesh extent.
    const xs: number[] = [];
    for (let i = 0; i < cut.value.mesh.positions.length; i += 3) {
      xs.push(cut.value.mesh.positions[i]);
    }
    expect(Math.max(...xs)).toBeLessThanOrEqual(1e-6);
    expect(Math.min(...xs)).toBeLessThan(-20);

    // Stats still describe the uncut bin.
    expect(cut.value.stats.volumeMm3).toBeCloseTo(full.value.stats.volumeMm3, 6);
  });

  it("cuts along y as well", async () => {
    const cut = await getHandler()(
      { ...REQUEST, section: { axis: "y", offsetMm: 5 } },
      context(),
    );
    const ys: number[] = [];
    for (let i = 1; i < cut.value.mesh.positions.length; i += 3) {
      ys.push(cut.value.mesh.positions[i]);
    }
    expect(Math.max(...ys)).toBeLessThanOrEqual(5 + 1e-6);
  });});

describe("fit template worker handler", () => {
  const shape = {
    id: "fit-shape",
    name: "Fit wrench",
    outlineMm: [
      {
        outer: [
          { x: -10, y: -5 },
          { x: 10, y: -5 },
          { x: 10, y: 5 },
          { x: -10, y: 5 },
        ],
        holes: [
          [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 },
          ],
        ],
      },
    ],
    bboxMm: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
    pointCount: 8,
    sourceMmPerPx: 0.2,
  };

  it("exports a filled standalone outline at the requested depth", async () => {
    const result = await getFitCheckHandler()(
      {
        shape,
        cutout: {
          id: "fit-cutout",
          shapeId: shape.id,
          position: { x: 40, y: -20 },
          scaleX: 1.5,
          scaleY: 0.5,
          clearanceMm: 1,
          cornerRoundMm: 0,
          fingerHoles: [
            {
              id: "ignored-hole",
              center: { x: 10, y: 0 },
              diameterMm: 18,
              kind: "straight",
              depthMm: 12,
            },
          ],
        },
        depthMm: 2.5,
        quality: { circularSegments: 24, cutoutVertexBudget: 600 },
      },
      context(),
    );

    const positions = result.value.mesh.positions;
    const xs: number[] = [];
    const zs: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
      xs.push(positions[index]);
      zs.push(positions[index + 2]);
    }
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(2.5, 6);
    // The placement and finger access position are intentionally ignored;
    // placement scale is retained while position and finger access features are ignored;
    // clearance grows the 30 mm wide outline to roughly 32 mm.
    expect(Math.min(...xs)).toBeCloseTo(-16, 1);
    expect(Math.max(...xs)).toBeCloseTo(16, 1);
    // Filling the 2x2 interior ring yields the full expanded rectangle.
    expect(result.value.stats.volumeMm3).toBeCloseTo(32 * 7 * 2.5, -1);
    expect(result.transfer).toContain(result.value.mesh.positions.buffer);
    expect(result.transfer).toContain(result.value.mesh.indices.buffer);
  });

  it("exports an inward-offset fit template after placement scale", async () => {
    const result = await getFitCheckHandler()({
      shape,
      cutout: { id: "fit-cutout", shapeId: shape.id, position: { x: 40, y: -20 },
        scaleX: 1.5, scaleY: 0.5, clearanceMm: -0.5, cornerRoundMm: 0 },
      depthMm: 2.5, quality: { circularSegments: 24, cutoutVertexBudget: 600 },
    }, context());
    const xs = Array.from(result.value.mesh.positions).filter((_, index) => index % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-14.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(14.5, 5);
    expect(result.value.stats.volumeMm3).toBeCloseTo(29 * 4 * 2.5, 4);
  });

  it("rejects a fit template erased by inward clearance", async () => {
    await expect(getFitCheckHandler()({
      shape,
      cutout: { id: "fit-cutout", shapeId: shape.id, position: { x: 0, y: 0 },
        scaleY: 0.05, clearanceMm: -0.5, cornerRoundMm: 0 },
      depthMm: 2, quality: { circularSegments: 24 },
    }, context())).rejects.toThrow("collapsed");
  });

  it("rejects an out-of-range template depth", async () => {
    await expect(
      getFitCheckHandler()(
        {
          shape,
          cutout: {
            id: "fit-cutout",
            shapeId: shape.id,
            position: { x: 0, y: 0 },
          },
          depthMm: 0.1,
          quality: { circularSegments: 16 },
        },
        context(),
      ),
    ).rejects.toThrow("thickness");
  });});

describe("complete surface fit test worker handler", () => {
  const shape = {
    id: "surface-shape",
    name: "Deep pliers",
    outlineMm: [
      {
        outer: [
          { x: -6, y: -4 },
          { x: 6, y: -4 },
          { x: 6, y: 4 },
          { x: -6, y: 4 },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: -6, minY: -4, maxX: 6, maxY: 4 },
    pointCount: 4,
    sourceMmPerPx: 0.2,
  };

  const request = (lip: "standard" | "none"): BuildSurfaceFitCheckRequest => ({
    spec: { gridX: 2, gridY: 1, heightUnits: 6, fill: "solid", lip },
    layout: {
      shapes: [shape],
      cutouts: [
        {
          id: "surface-cutout-left",
          shapeId: shape.id,
          position: { x: -15, y: 0 },
          clearanceMm: 0,
          cornerRoundMm: 0,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
        {
          id: "surface-cutout-right",
          shapeId: shape.id,
          position: { x: 15, y: 0 },
          clearanceMm: 0,
          cornerRoundMm: 0,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ],
      fingerHoles: [],
    },
    thicknessMm: 1.2,
    quality: { circularSegments: 32, cutoutVertexBudget: 600 },
  });

  it("exports the full pocket surface on the build plate without the stacking lip", async () => {
    const withLip = await getSurfaceFitCheckHandler()(request("standard"), context());
    const withoutLip = await getSurfaceFitCheckHandler()(request("none"), context());
    const positions = withLip.value.mesh.positions;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
      xs.push(positions[index]);
      ys.push(positions[index + 1]);
      zs.push(positions[index + 2]);
    }

    expect(Math.min(...xs)).toBeCloseTo(-83.5 / 2, 5);
    expect(Math.max(...xs)).toBeCloseTo(83.5 / 2, 5);
    expect(Math.min(...ys)).toBeCloseTo(-41.5 / 2, 5);
    expect(Math.max(...ys)).toBeCloseTo(41.5 / 2, 5);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(1.2, 6);
    // The source bin's lip choice changes only the source elevation; the
    // exported surface geometry itself contains no lip.
    expect(withLip.value.stats.volumeMm3).toBeCloseTo(
      withoutLip.value.stats.volumeMm3,
      5,
    );
    expect(withLip.transfer).toContain(withLip.value.mesh.positions.buffer);
    expect(withLip.transfer).toContain(withLip.value.mesh.indices.buffer);
  });

  it("rejects an unsafe paper-thin surface", async () => {
    await expect(
      getSurfaceFitCheckHandler()(
        { ...request("standard"), thicknessMm: 0.2 },
        context(),
      ),
    ).rejects.toThrow("thickness");
  });

  it("exports the outline style as a smaller manifold mesh at the requested thickness", async () => {
    const full = await getSurfaceFitCheckHandler()(request("standard"), context());
    const outline = await getSurfaceFitCheckHandler()({ ...request("standard"), style: "outline" }, context());
    expect(outline.value.stats.volumeMm3).toBeLessThan(full.value.stats.volumeMm3);
    expect(outline.value.stats.volumeMm3).toBeGreaterThan(0);
    expect(nonManifoldEdgeCount(outline.value.mesh)).toBe(0);
    const zs = Array.from(outline.value.mesh.positions).filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(0);
    expect(Math.max(...zs)).toBeCloseTo(1.2);
  });});
