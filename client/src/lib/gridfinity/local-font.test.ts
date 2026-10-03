import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { localFontSchema } from "@shared/gridfinity/local-font";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { withKernel, loadManifold } from "@/lib/manifold/runtime";
import { type TransferableResult, type HandlerContext } from "@/lib/worker/host";
import { importLocalFont, extendLocalFont } from "./local-font";
import { surfaceTextOutline } from "./surface-text";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";

// Existing Three.js test/example asset; no system font or browser permission is needed.
const bytes = readFileSync(createRequire(import.meta.url).resolve("three/examples/fonts/ttf/kenpixel.ttf"));
const blob = () => new Blob([new Uint8Array(bytes)]);
const load = () => importLocalFont(blob(), "Kenpixel", "B8 O Metric");

describe("portable local fonts", () => {
  it("imports a real font, keeps counters and winding, and never stores renderer caches", async () => {
    const font = await load();
    expect(font.name.toLowerCase()).toContain("kenpixel");
    const label = surfaceTextSchema.parse({ id: "local", text: "B8 O", font, position: { x: 0, y: 0 } });
    const before = JSON.stringify(label);
    const outline = surfaceTextOutline(label);
    await withKernel(kernel => {
      const rings = outline.flatMap(shape => [shape.outer, ...shape.holes]);
      const section = kernel.arena.track(new kernel.CrossSection(rings.map(ring => ring.map(p => [p.x, p.y] as [number, number])), "NonZero"));
      // Kenpixel constructs letters from touching rectangles; union recovers their counters.
      expect(section.numContour()).toBeGreaterThan(3);
    });
    expect(JSON.stringify(label)).toBe(before);
    expect(() => surfaceTextOutline({ ...label, text: "🔧" })).toThrow("unsupported character");
    // Reopening doesn't need a file handle; text may use glyphs absent from the original wording.
    // Evict the original parser to exercise the saved compressed source after a reopen.
    await importLocalFont(new Blob([new Uint8Array(bytes), new Uint8Array([1])]), "Other", "A");
    await importLocalFont(new Blob([new Uint8Array(bytes), new Uint8Array([2])]), "Another", "A");
    const expanded = await extendLocalFont(JSON.parse(before).font, "SAE 12");
    expect(surfaceTextOutline({ ...JSON.parse(before), text: "SAE 12", font: expanded }).length).toBeGreaterThan(0);
  });

  it("preserves font data through project save, reload, and undo history; migrates v29", async () => {
    const font = await load();
    const label = surfaceTextSchema.parse({ id: "local", name: "Socket sizes", text: "Metric", font, position: { x: 0, y: 0 } });
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, surfaceTexts: [label] });
    const doc = { spec, cutouts: [], fingerHoles: [] };
    const project = { schemaVersion: PROJECT_SCHEMA_VERSION, ...doc, shapes: [], history: { index: 1, stack: [
      { doc: { ...doc, spec: { ...spec, surfaceTexts: [{ ...label, font: "sans" }] } }, label: "Start" },
      { doc, label: "Change font" },
    ] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
    const legacy = { ...project, schemaVersion: 29, spec: project.history.stack[0].doc.spec, history: undefined };
    expect(parseProjectDoc(legacy)?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(parseProjectDoc(legacy)?.spec.surfaceTexts[0].font).toBe("sans");
  });

  it("builds connected printable text and produces the same worker geometry after reloading", async () => {
    const font = await load();
    const label = surfaceTextSchema.parse({ id: "local", text: "B8 O", font, position: { x: 0, y: 0 } });
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, lip: "none", surfaceTexts: [label] });
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      expect(result.textParts[0].solid.status()).toBe("NoError");
      expect(result.textParts[0].solid.volume()).toBeGreaterThan(0);
      expect(result.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(1);
    });
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (
      request: BuildBinRequest, context: HandlerContext
    ) => Promise<TransferableResult<BuildBinResult>>;
    const context = { signal: new AbortController().signal, progress: () => {} };
    const original = await handler({ spec, quality: EXPORT_QUALITY, exportTopology: true }, context);
    const restored = await handler({ spec: JSON.parse(JSON.stringify(spec)), quality: EXPORT_QUALITY, exportTopology: true }, context);
    expect(restored.value.textMeshes![0].mesh).toEqual(original.value.textMeshes![0].mesh);
    const mesh = restored.value.textMeshes![0].mesh;
    const edges = new Map<string, number>();
    for (let i = 0; i < mesh.indices.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const v = mesh.indices[i + a], w = mesh.indices[i + b];
      const key = v < w ? `${v}:${w}` : `${w}:${v}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
  });

  it("previews rotated system-font text with finite unit normals and printable precision", async () => {
    const font = await load();
    const label = surfaceTextSchema.parse({ id: "rotated", text: "B8 O", font,
      position: { x: 9.952584160212634, y: -20 }, rotationDeg: -109.0332674564529 });
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, surfaceTexts: [label] });
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (
      request: BuildBinRequest, context: HandlerContext
    ) => Promise<TransferableResult<BuildBinResult>>;
    const result = await handler({ spec, quality: EXPORT_QUALITY }, { signal: new AbortController().signal, progress: () => {} });
    const mesh = result.value.textMeshes![0].mesh;
    expect(mesh.normals!.length).toBe(mesh.positions.length);
    for (let i = 0; i < mesh.normals!.length; i += 3) {
      expect(Math.hypot(mesh.normals![i], mesh.normals![i + 1], mesh.normals![i + 2])).toBeCloseTo(1, 4);
    }
    expect([...mesh.positions].every(Number.isFinite)).toBe(true);
    expect(result.value.textMeshes![0].label).toEqual(label);
  });

  it("reports the actual missing characters without replacing them silently", async () => {
    await expect(importLocalFont(blob(), "Kenpixel", "Tool 🔧")).rejects.toThrow("“Kenpixel” does not include “🔧”");
  });

  it("rejects unreadable and oversized files with an actionable message", async () => {
    await expect(importLocalFont(new Blob(), "Empty", "A")).rejects.toThrow("too large");
    await expect(importLocalFont(new Blob([new Uint8Array(21 * 1024 * 1024)]), "Huge", "A")).rejects.toThrow("too large");
    await expect(importLocalFont(new Blob(["not a font"]), "Invalid", "A")).rejects.toThrow("vector outlines");
  });

  it.each(["m 0", "constructor", "m 0 NaN", "m 0 Infinity", "m 0 1000001", "m 0 0x10", "m 0 0 bad"])("rejects malformed saved outline %s", o => {
    expect(localFontSchema.safeParse({ kind: "local", name: "Invalid", resolution: 1000, glyphs: { A: { ha: 500, o } } }).success).toBe(false);
  });
});
