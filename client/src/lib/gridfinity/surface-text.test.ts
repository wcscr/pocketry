import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SURFACE_TEXT_FONTS, surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { withKernel, loadManifold } from "@/lib/manifold/runtime";
import { writeThreeMf } from "@/lib/mesh/threemf";
import type { TransferableResult, HandlerContext } from "@/lib/worker/host";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { createBasicPocket } from "./basic-shape";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinResult, type BuildBinRequest } from "./worker-api";
import { surfaceTextOutline, surfaceTextZ } from "./surface-text";

const text = surfaceTextSchema.parse({ id: "text-1", text: "B8 & O", position: { x: 0, y: 0 } });
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, lip: "none", surfaceTexts: [text], textColor: "#ff6600" });

describe("surface text", () => {
  it("migrates v28 and round-trips independent label names through the document and history without changing geometry", () => {
    const oldDoc = { spec, cutouts: [], fingerHoles: [] };
    const named = { ...text, name: "Socket sizes" };
    const namedDoc = { ...oldDoc, spec: { ...spec, surfaceTexts: [named] } };
    const legacy = { schemaVersion: 28, ...oldDoc, shapes: [], history: { index: 0, stack: [{ doc: oldDoc, label: "Text" }] } };
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.surfaceTexts[0]).toEqual(text);
    const current = { ...migrated, ...namedDoc, history: { index: 1, stack: [
      { doc: oldDoc, label: "Text" }, { doc: namedDoc, label: "Rename surface text" },
    ] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(surfaceTextOutline(named)).toEqual(surfaceTextOutline(text));
    expect(surfaceTextSchema.safeParse({ ...text, name: " " }).success).toBe(false);
  });

  it("keeps holes in glyphs and rejects unavailable glyphs", () => {
    const outline = surfaceTextOutline(text);
    expect(outline.reduce((count, shape) => count + shape.holes.length, 0)).toBeGreaterThanOrEqual(5);
    expect(() => surfaceTextOutline({ ...text, text: "Tool 🔧" })).toThrow("unsupported character");
  });

  it.each(SURFACE_TEXT_FONTS)("builds watertight $name labels touching the surface without overlapping the body", async font => {
    const fontSpec = { ...spec, surfaceTexts: [{ ...text, font: font.id }] };
    const restored = parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: fontSpec, shapes: [], cutouts: [], fingerHoles: [] })))!;
    expect(restored.spec.surfaceTexts[0].font).toBe(font.id);
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, restored.spec, null, EXPORT_QUALITY);
      expect(result.textParts).toHaveLength(1);
      const label = result.textParts[0].solid;
      expect(label.status()).toBe("NoError");
      expect(label.boundingBox().min[2]).toBeCloseTo(surfaceTextZ(spec), 6);
      expect(label.boundingBox().max[2]).toBeCloseTo(surfaceTextZ(spec) + text.heightMm, 6);
      expect(kernel.arena.track(label.intersect(result.bodySolid)).volume()).toBeCloseTo(0, 6);
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.volume()).toBeCloseTo(result.bodySolid.volume() + label.volume(), 4);
      // A fused STL has one connected body, even though glyphs are disconnected in the 3MF label.
      const components = result.solid.decompose().map(part => kernel.arena.track(part));
      expect(components).toHaveLength(1);
    });
  });

  it.each([{ fill: "none" as const }, { fillHeightPercent: 50 }, { flatBottom: true }])("follows the actual surface: %j", async patch => {
    await withKernel(kernel => {
      const altered = parseBinSpec({ ...spec, ...patch });
      const result = buildBinWithCutouts(kernel, altered, null, EXPORT_QUALITY);
      expect(result.textParts[0].z).toBeCloseTo(surfaceTextZ(altered), 6);
      if (altered.fill === "none") expect(result.textParts[0].z).toBe(BASE_HEIGHT);
    });
  });

  it("rejects text outside the footprint or across a pocket and overlapping labels", async () => {
    await withKernel(kernel => {
      const outside = { ...spec, surfaceTexts: [{ ...text, position: { x: 42, y: 0 } }] };
      expect(() => buildBinWithCutouts(kernel, outside, null, EXPORT_QUALITY)).toThrow("must fit on the flat surface");
      const overlap = { ...spec, surfaceTexts: [text, { ...text, id: "text-2" }] };
      expect(() => buildBinWithCutouts(kernel, overlap, null, EXPORT_QUALITY)).toThrow("overlaps");
      const pocket = createBasicPocket("rectangle", { x: -10, y: -10 }, { x: 10, y: 10 }, "pocket")!;
      expect(() => buildBinWithCutouts(kernel, spec, {
        cutouts: [pocket.cutout], shapesById: new Map([[pocket.shape.id, pocket.shape]]), fingerHoles: [],
      }, EXPORT_QUALITY)).toThrow("must fit on the flat surface");
    });
  });

  it("builds a narrow bin after moving text off its central tool pocket", async () => {
    const pocket = createBasicPocket("rectangle", { x: -8, y: -50 }, { x: 8, y: 50 }, "driver")!;
    const label = surfaceTextSchema.parse({ id: "wiha", text: "Wiha", position: { x: 0, y: 0 } });
    const narrow = parseBinSpec({ gridPitch: "half", gridX: 2, gridY: 7, heightUnits: 3, surfaceTexts: [label] });
    const layout = { cutouts: [pocket.cutout], shapesById: new Map([[pocket.shape.id, pocket.shape]]), fingerHoles: [] };
    await withKernel(kernel => {
      expect(() => buildBinWithCutouts(kernel, narrow, layout, EXPORT_QUALITY)).toThrow("must fit on the flat surface");
      const moved = { ...narrow, surfaceTexts: [{ ...label, position: { x: 0, y: 60 } }] };
      const result = buildBinWithCutouts(kernel, moved, layout, EXPORT_QUALITY);
      expect(result.textParts).toHaveLength(1);
      expect(result.solid.status()).toBe("NoError");
      expect(kernel.arena.track(result.textParts[0].solid.intersect(result.bodySolid)).volume()).toBeCloseTo(0, 6);
      expect(result.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(1);
    });
  });

  it("migrates old projects and keeps text through save/load and saved history", () => {
    const legacySpec = { ...spec };
    delete (legacySpec as Partial<typeof spec>).surfaceTexts;
    const legacy = { schemaVersion: 26, spec: legacySpec, shapes: [], cutouts: [], fingerHoles: [] };
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.surfaceTexts).toEqual([]);
    const doc = { spec, cutouts: [], fingerHoles: [] };
    const current = { schemaVersion: PROJECT_SCHEMA_VERSION, ...doc, shapes: [], history: { index: 0, stack: [{ doc, label: "Add text" }] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(parseProjectDoc({ ...current, spec: { ...spec, surfaceTexts: [text, text] } })).toBeNull();
    expect(surfaceTextSchema.safeParse({ ...text, text: " " }).success).toBe(false);
    expect(surfaceTextSchema.safeParse({ ...text, text: "line\nline" }).success).toBe(false);
    expect(parseProjectDoc({ ...current, spec: { ...spec, textColor: "red" } })).toBeNull();
    const { textColor: _color, ...colorlessSpec } = spec;
    const { font: _font, ...oldLabel } = text;
    const oldSpec = { ...colorlessSpec, surfaceTexts: [oldLabel] };
    const restored = parseProjectDoc({ ...current, spec: oldSpec,
      history: { index: 0, stack: [{ doc: { ...doc, spec: oldSpec }, label: "Add text" }] },
    })!;
    expect(restored.spec.textColor).toBeNull();
    expect(restored.spec.surfaceTexts[0].font).toBe("sans");
    const coloredSpec = { ...oldSpec, surfaceTexts: [{ ...text, color: "#2244ff" }, { ...text, id: "old-2", color: "#ff6600" }] };
    const migratedColors = parseProjectDoc({ ...current, spec: coloredSpec,
      history: { index: 0, stack: [{ doc: { ...doc, spec: coloredSpec }, label: "Color text" }] },
    })!;
    expect(migratedColors.spec.textColor).toBe("#2244ff");
    expect(migratedColors.history!.stack[0].doc.spec.textColor).toBe("#2244ff");
    expect(migratedColors.spec.surfaceTexts.every(label => !("color" in label))).toBe(true);
    expect(parseBinSpec({ ...coloredSpec, textColor: "#112233" }).textColor).toBe("#112233");
    expect(parseBinSpec({ ...coloredSpec, textColor: null }).textColor).toBeNull();
  });

  it("uses distinct outlines for each font choice", () => {
    const outlines = SURFACE_TEXT_FONTS.map(font => JSON.stringify(surfaceTextOutline({ ...text, font: font.id })));
    expect(new Set(outlines).size).toBe(SURFACE_TEXT_FONTS.length);
    expect(surfaceTextSchema.safeParse({ ...text, font: "unknown" }).success).toBe(false);
  });

  it.each([undefined, { axis: "x" as const, offsetMm: 0 }])("previews colored labels separately with section %j", async section => {
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (
      request: BuildBinRequest, context: HandlerContext
    ) => Promise<TransferableResult<BuildBinResult>>;
    const { value, transfer } = await handler({ spec, quality: EXPORT_QUALITY, section },
      { signal: new AbortController().signal, progress: () => {} });
    expect(value.textMeshes?.[0].label).toEqual(text);
    const body = value.materialMeshes?.body ?? value.bodyMesh!;
    const label = value.textMeshes![0].mesh;
    const coordinates = (mesh: typeof label, axis: number) => [...mesh.positions].filter((_, i) => i % 3 === axis);
    expect(Math.max(...coordinates(body, 2))).toBeCloseTo(21);
    expect(Math.min(...coordinates(label, 2))).toBeCloseTo(21);
    expect(Math.max(...coordinates(label, 2))).toBeCloseTo(21.8);
    if (section) expect(Math.max(...coordinates(label, 0))).toBeLessThanOrEqual(0.00001);
    expect(label.normals).toBeNull();
    expect(transfer).toContain(label.positions.buffer);
    expect(transfer).toContain(label.indices.buffer);
  });

  it("exports two named text meshes in one assembly while preserving separate color partitions", async () => {
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (
      request: BuildBinRequest, context: HandlerContext
    ) => Promise<TransferableResult<BuildBinResult>>;
    const { value, transfer } = await handler({
      spec: { ...spec, surfaceTexts: [text, { ...text, id: "text-2", text: "SAE", rotationDeg: 30, position: { x: 0, y: 16 } }] },
      quality: EXPORT_QUALITY, exportTopology: true, stackingRimMaterialThicknessMm: 0.6,
    }, { signal: new AbortController().signal, progress: () => {} });
    expect(value.textMeshes).toHaveLength(2);
    expect(value.bodyMesh).toBeDefined();
    expect(value.materialMeshes?.stackingRim).toBeDefined();
    for (const mesh of [value.mesh, value.bodyMesh!, value.materialMeshes!.body, ...value.textMeshes!.map(part => part.mesh)]) {
      const edges = new Map<string, number>();
      for (let i = 0; i < mesh.indices.length; i += 3) {
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
          const v = mesh.indices[i + a], w = mesh.indices[i + b];
          const key = v < w ? `${v}:${w}` : `${w}:${v}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
      expect(transfer).toContain(mesh.positions.buffer);
    }
    const bytes = writeThreeMf([
      { name: "Bin", mesh: value.bodyMesh! },
      ...value.textMeshes!.map(part => ({ name: `Text: ${part.label.text}`, mesh: part.mesh })),
    ], { assemble: true });
    const model = strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
    expect(model.match(/<component /g)).toHaveLength(3);
    expect(model.match(/<item /g)).toHaveLength(1);
    expect(model).toContain('name="Text: B8 &amp; O"');
    expect(model).toContain('name="Text: SAE"');
  });
});
