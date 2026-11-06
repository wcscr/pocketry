import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseBinSpec, type BinSpecInput } from "@shared/gridfinity/types";
import { TAB_DEPTH_MM, TAB_WIDTH_NOMINAL_MM } from "@shared/gridfinity/standard";
import { labelTabSurfaces, labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { wallSlantHeightMm } from "@shared/gridfinity/wall-slant";
import { withKernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { placeSurfaceTextOnTab } from "./surface-text";
import { getHandler, context, nonManifoldEdgeCount, printableMeshVolume, previewMeshVolume } from "./bin-worker-handlers.test-support";
import type { BuildBinRequest } from "./worker-api";
import { surfaceTextIssueText } from "./surface-text.test-support";

const custom = { kind: "custom" as const, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
const bin = (extra: Partial<BinSpecInput> = {}) => parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6,
  fill: "none", lip: "none", ...extra });

describe("adjustable label-tab solids", () => {
  it.each([
    { name: "truncated upright", heightUnits: 2, labelTab: { width: "center" } },
    { name: "short recessed slant", heightUnits: 2, wallSlant: { axis: "y", angleDeg: 30 }, labelTab: { wall: "south", recessMm: 0.5 } },
    { name: "rimmed outer", labelTab: { recessMm: 0.5, frontRim: true, width: "right" } },
    { name: "small repeated shelves", compartments: { rows: 4, columns: 4 }, labelTab: { scope: "compartments", width: "left" } },
    { name: "custom compartments", footprint: custom, compartments: { rows: 2, columns: 2 },
      labelTab: { scope: "compartments", recessMm: 0.5, frontRim: true } },
    { name: "custom boundary", footprint: custom,
      labelTab: { wall: "east", width: "center", edge: { cell: { x: 0, y: 1 }, side: "east" } } },
    { name: "retained width on full shelf", labelTab: { width: "full", widthMm: 12 } },
    { name: "solid fill", fill: "solid", labelTab: { width: "center" } },
  ] satisfies (Partial<BinSpecInput> & { name: string })[])("preserves exact legacy geometry for $name", async ({ name: _name, ...input }) => {
    const old = bin(input), explicit = parseBinSpec({ ...old,
      labelTab: { ...old.labelTab, depthMm: TAB_DEPTH_MM, widthMm: TAB_WIDTH_NOMINAL_MM } });
    expect(labelTabSurfaces(explicit)).toEqual(labelTabSurfaces(old));
    await withKernel(kernel => {
      const before = buildBin(kernel, old, PREVIEW_QUALITY).solid;
      const after = buildBin(kernel, explicit, PREVIEW_QUALITY).solid;
      expect(after.status()).toBe("NoError");
      expect(extractPrintableMeshData(kernel, after)).toEqual(extractPrintableMeshData(kernel, before));
    });
  });

  it.each(["north", "south", "east", "west"] as const)("shrinks %s outer and repeated tabs without losing slanted attachments", async wall => {
    for (const scope of ["outer", "compartments"] as const) for (const side of ["both", "positive", "negative"] as const) {
      const large = bin({ wallSlant: { axis: wall === "north" || wall === "south" ? "y" : "x",
        angleDeg: wall === "north" || wall === "east" ? -30 : 30, side },
      compartments: { rows: 2, columns: 3, scoop: true },
      labelTab: { wall, scope, width: "center", recessMm: 0.5, frontRim: true } });
      const small = parseBinSpec({ ...large, labelTab: { ...large.labelTab, depthMm: 5, widthMm: 12 } });
      await withKernel(kernel => {
        const before = buildBin(kernel, large, PREVIEW_QUALITY).solid;
        const after = buildBin(kernel, small, PREVIEW_QUALITY).solid;
        expect(after.status()).toBe("NoError");
        expect(after.volume()).toBeLessThan(before.volume());
        expect(after.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
        expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, after))).toBe(0);
      });
    }
  });

  it.each(["outer", "compartments"] as const)("clips custom %s tabs and closing wedges without floating material", async scope => {
    for (const angleDeg of [0, -30, -75]) {
      const spec = bin({ footprint: custom, heightUnits: angleDeg === -75 ? 12 : 6,
        wallSlant: angleDeg ? { axis: "x", angleDeg, side: "positive" } : null, compartments: { rows: 2, columns: 2 },
        labelTab: { wall: "east", scope, width: "center", edge: { cell: { x: 0, y: 1 }, side: "east" },
          depthMm: 4, widthMm: 10, recessMm: 0.5, frontRim: true } });
      await withKernel(kernel => {
        const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY,
          { rimInsertThicknessMm: 1.25, floorInsertThicknessMm: 0.6, colorDividerTops: true });
        expect(result.solid.status()).toBe("NoError");
        const components = result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6);
        expect(components, JSON.stringify({ scope, angleDeg, components: components.map(part => ({ volume: part.volume(), bounds: part.boundingBox() })) })).toHaveLength(1);
        expect(result.solid.boundingBox().max[2]).toBeLessThanOrEqual(wallSlantHeightMm(spec) + 1e-5);
        const { body, stackingRim, pocketFloors } = result.materialParts!;
        const parts = [body, stackingRim, pocketFloors].filter(part => part !== null);
        expect(parts.reduce((sum, part) => sum + part.volume(), 0)).toBeCloseTo(result.solid.volume(), 3);
        for (const part of parts) expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, part))).toBe(0);
      });
    }
  });

  it("keeps tiny front rims valid even when they consume the writing area", async () => {
    const spec = bin({ wallThicknessMm: 1.6, compartments: { rows: 3, columns: 4 },
      labelTab: { scope: "compartments", width: "center", depthMm: 1, widthMm: 1, recessMm: 0.5, frontRim: true } });
    expect(labelTabSurfaces(spec)).toEqual([]);
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY, { rimInsertThicknessMm: 1.25 });
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      const { body, stackingRim, pocketFloors } = result.materialParts!;
      for (const part of [body, stackingRim, pocketFloors].filter(part => part !== null)) {
        expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, part))).toBe(0);
      }
    });
  });

  it.each([{ widthMm: 10 }, { depthMm: 4 }])("attaches custom-edge tabs when only %j changes", async dimensions => {
    const spec = bin({ footprint: custom, labelTab: { wall: "east", width: "center",
      edge: { cell: { x: 0, y: 1 }, side: "east" }, ...dimensions } });
    await withKernel(kernel => {
      const result = buildBin(kernel, spec, EXPORT_QUALITY);
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, result.solid))).toBe(0);
    });
  });

  it("preserves authored text and rejects unsupported lettering after shrinking", async () => {
    const original = bin({ labelTab: { wall: "south", width: "center", recessMm: 0.5, frontRim: true } });
    original.surfaceTexts.push(placeSurfaceTextOnTab(original, surfaceTextSchema.parse({ id: "saved", text: "M1 4x6.5",
      sizeMm: 2, symbol: "pan-screw", symbolSizeMm: 3.5, symbolRotationDeg: 45, position: { x: 0, y: 0 } })));
    const small = parseBinSpec({ ...original, labelTab: { ...original.labelTab, depthMm: 3, widthMm: 6 } });
    expect(small.surfaceTexts).toEqual(original.surfaceTexts);
    await withKernel(kernel => {
      expect(buildBinWithCutouts(kernel, original, null, PREVIEW_QUALITY).textParts).toHaveLength(1);
      expect(surfaceTextIssueText(buildBinWithCutouts(kernel, small, null, PREVIEW_QUALITY))).toContain("must fit on a label tab");
    });
    expect(small.surfaceTexts).toEqual(original.surfaceTexts);
  });

  it("keeps minimum-sized end tabs valid and rejects text buried in thick walls", async () => {
    for (const width of ["full", "center", "left", "right"] as const) {
      const spec = bin({ wallThicknessMm: 3,
        labelTab: { wall: "north", width, depthMm: 1, widthMm: 1, recessMm: 0.5 } });
      await withKernel(kernel => {
        const result = buildBin(kernel, spec, EXPORT_QUALITY);
        expect(result.solid.status()).toBe("NoError");
        expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
        expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, result.solid))).toBe(0);
        const text = surfaceTextSchema.parse({ id: "buried", text: "I", sizeMm: 2, surface: "label-tab", position: { x: 0, y: 40 } });
        expect(surfaceTextIssueText(buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [text] }, null, EXPORT_QUALITY))).toContain("overlaps another label or the bin walls");
      });
    }
  });

  it("keeps resized tabs attached in small arbitrary bins with capped sub-bins", async () => {
    const spec = bin({ arbitrarySizeMm: { width: 20, length: 18 }, flatBottom: true, heightUnits: 2,
      compartments: { rows: 2, columns: 2 }, labelTab: { scope: "compartments", width: "right", depthMm: 4, widthMm: 8, recessMm: 0.5 } });
    await withKernel(kernel => {
      const built = buildBin(kernel, spec, EXPORT_QUALITY);
      expect(built.solid.status()).toBe("NoError");
      expect(built.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, built.solid))).toBe(0);
      expect(spec.labelTab).toMatchObject({ depthMm: 4, widthMm: 8 });
      expect(built.solid.boundingBox()).toEqual({ min: [-10, -9, 0], max: [10, 9, 14] });
    });
  });

  it("does not add welded seam faults to existing single-wall compartment exports", async () => {
    const spec = bin({ wallSlant: { axis: "y", angleDeg: 30, side: "negative" }, compartments: { rows: 2, columns: 2 } });
    await withKernel(kernel => {
      // This 30-degree negative-side warp has four welded faces on the floor
      // edge (0.6, 0.6, 7) -> (40.8, 0.6, 7), including with no tabs at all.
      // Keep this separate from strict closed-STL proof below: resizing
      // a tab must not add faults to either its original or tab-free baseline.
      const seamCount = (input: typeof spec) => nonManifoldEdgeCount({
        ...extractPrintableMeshData(kernel, buildBin(kernel, input, EXPORT_QUALITY).solid), normals: new Float32Array(0),
      });
      const standard = parseBinSpec({ ...spec, labelTab: { wall: "south", scope: "compartments", width: "center", recessMm: 0.5, frontRim: true } });
      const small = parseBinSpec({ ...standard, labelTab: { ...standard.labelTab, depthMm: 7, widthMm: 18 } });
      expect(seamCount(small)).toBe(seamCount(standard));
      expect(seamCount(small)).toBe(seamCount(spec));
    });
  });

  it("exports resized shelves, front-rim colors and authored labels with matching worker geometry", async () => {
    const spec = bin({ wallSlant: { axis: "y", angleDeg: 30, side: "both" },
      compartments: { rows: 2, columns: 2 },
      labelTab: { wall: "south", scope: "compartments", width: "center", depthMm: 7, widthMm: 18, recessMm: 0.5, frontRim: true } });
    for (let i = 0; i < 4; i++) spec.surfaceTexts.push(placeSurfaceTextOnTab(spec, surfaceTextSchema.parse({
      id: String(i), text: `M${i + 2}`, sizeMm: 2, symbol: "hex-nut", symbolSizeMm: 2.5, position: { x: 0, y: 0 } })));
    const originalLabels = structuredClone(spec.surfaceTexts);
    const request: BuildBinRequest = { spec, quality: EXPORT_QUALITY, colorDividerTops: true,
      stackingRimMaterialThicknessMm: 1.25, pocketFloorMaterialThicknessMm: 0.6 };
    const preview = (await getHandler()(request, context())).value;
    const exported = (await getHandler()({ ...request, exportTopology: true }, context())).value;
    expect(exported.textMeshes).toHaveLength(4);
    expect(spec.surfaceTexts).toEqual(originalLabels);
    expect(previewMeshVolume(preview.materialMeshes!.stackingRim!)).toBeCloseTo(printableMeshVolume(exported.materialMeshes!.stackingRim!), 2);
    const parts = [...Object.entries(exported.materialMeshes!).map(([name, mesh]) => ({ name, mesh,
      material: { name, displayColor: "#223344" as const } })),
    ...exported.textMeshes!.map(({ label, mesh }) => ({ name: label.text, mesh, material: { name: "Text", displayColor: "#ff8800" as const } }))];
    for (const part of parts) expect(nonManifoldEdgeCount(part.mesh)).toBe(0);
    expect(parts.reduce((sum, part) => sum + printableMeshVolume(part.mesh), 0)).toBeCloseTo(exported.stats.volumeMm3, 1);
    const model = strFromU8(unzipSync(writeThreeMf(parts, { assemble: true }))["3D/3dmodel.model"]);
    expect(model.match(/<component /g)).toHaveLength(parts.length);
    expect(model).toContain('name="M3"');
    expect(model).toContain("#FF8800");
    for (const object of model.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)) {
      const positions = [...object[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\s*\/>/g)].flatMap(match => match.slice(1).map(Number));
      const indices = [...object[1].matchAll(/<triangle v1="([^"]+)" v2="([^"]+)" v3="([^"]+)"[^>]*\/>/g)].flatMap(match => match.slice(1).map(Number));
      expect(nonManifoldEdgeCount({ positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: null })).toBe(0);
    }
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      expect(result.textParts.every(part => part.z === labelTabTopZ(spec))).toBe(true);
      const mesh = extractPrintableMeshData(kernel, result.solid);
      const stl = new DataView(writeBinarySTL(mesh));
      expect(stl.getUint32(80, true)).toBe(mesh.indices.length / 3);
      expect(stl.byteLength).toBe(84 + stl.getUint32(80, true) * 50);
      const positions = new Float32Array(stl.getUint32(80, true) * 9);
      for (let i = 0; i < positions.length; i++) positions[i] = stl.getFloat32(84 + Math.floor(i / 9) * 50 + 12 + (i % 9) * 4, true);
      const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
      // STL duplicates vertices; weld its serialized coordinates when checking seams.
      expect(nonManifoldEdgeCount({ positions, indices, normals: new Float32Array(0) })).toBe(0);
    });
  });
});
