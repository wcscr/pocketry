import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseBinSpec } from "@shared/gridfinity/types";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { withKernel, loadManifold } from "@/lib/manifold/runtime";
import { extractPrintableMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { placeSurfaceTextOnTab } from "./surface-text";
import { createBasicPocket } from "./basic-shape";

const reported = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, lip: "none", fill: "none",
  wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8,
  compartments: { enabled: true, rows: 2, columns: 3, dividerThicknessMm: 1.2 },
  labelTab: { wall: "south", autoWall: true, scope: "compartments", width: "full" } });
const label = surfaceTextSchema.parse({ id: "metric", text: "M3", font: "helvetiker", sizeMm: 4,
  symbol: "hex-nut", symbolSizeMm: 4, position: { x: 0, y: 0 } });

function expectClosedStl(mesh: MeshData) {
  const bytes = new DataView(writeBinarySTL(mesh));
  const edges = new Map<string, { count: number; direction: number }>();
  for (let i = 0; i < bytes.getUint32(80, true); i++) {
    const vertices = [0, 1, 2].map(j => [0, 1, 2].map(k => bytes.getFloat32(84 + i * 50 + 12 + j * 12 + k * 4, true)).join(","));
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3], key = [a, b].sort().join("/");
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  expect([...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0)).toEqual([]);
}

describe("raised labels on slanted shelves", () => {
  it("exports six metric labels attached to the reported bin, with separate colored 3MF parts", async () => {
    const spec = { ...reported, surfaceTexts: [...reported.surfaceTexts] };
    for (let i = 0; i < 6; i++) spec.surfaceTexts.push(placeSurfaceTextOnTab(spec, { ...label, id: String(i), text: `M${i + 2}` }));
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY,
        { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 1.25, colorDividerTops: true });
      expect(result.textParts).toHaveLength(6);
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      for (const part of result.textParts) {
        expect(part.z).toBe(38.5);
        expect(part.solid.boundingBox().min[2]).toBeCloseTo(38.5, 6);
        expect(kernel.arena.track(part.solid.intersect(result.bodySolid)).volume()).toBeCloseTo(0, 6);
      }
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
      const model = strFromU8(unzipSync(writeThreeMf([
        { name: "Bin", mesh: extractPrintableMeshData(kernel, result.bodySolid) },
        ...result.textParts.map(part => ({ name: `Text: ${part.label.text}`, mesh: extractPrintableMeshData(kernel, part.solid),
          material: { name: "Text", displayColor: "#002244" as const } })),
      ], { assemble: true }))["3D/3dmodel.model"]);
      expect(model.match(/<component /g)).toHaveLength(7);
      expect(model).toContain('name="Text: M3"');
      expect(model).toContain('z="38.5"');
      expect(model).toContain("#002244");
    });
  });

  it.each(["x", "y"] as const)("supports %s slants in both directions and single walls, with outer/compartment tabs and scoops", async axis => {
    for (const side of ["both", "positive", "negative"] as const) for (const angleDeg of [-30, 30]) {
      for (const scope of ["outer", "compartments"] as const) {
        const spec = parseBinSpec({ ...reported, wallSlant: { axis, angleDeg, side },
          compartments: { ...reported.compartments, scoop: true },
          labelTab: { wall: axis === "x" ? angleDeg > 0 ? "west" : "east" : angleDeg > 0 ? "south" : "north", width: "full", scope } });
        const placed = placeSurfaceTextOnTab(spec, label);
        expect(placed.surface, `${axis}/${side}/${angleDeg}/${scope}`).toBe("label-tab");
        await withKernel(kernel => {
          const result = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [placed] }, null, PREVIEW_QUALITY);
          expect(result.solid.status()).toBe("NoError");
          expect(result.textParts[0].z).toBe(labelTabTopZ(spec));
          expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
        });
      }
    }
  });

  it.each(["outer", "compartments"] as const)("honors the actual %s tab height with a stacking lip on upright bins", async scope => {
    const spec = parseBinSpec({ ...reported, wallSlant: null, lip: "standard", labelTab: { wall: "south", width: "full", scope } });
    const placed = placeSurfaceTextOnTab(spec, label);
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [placed] }, null, EXPORT_QUALITY);
      expect(result.textParts[0].z).toBe(labelTabTopZ(spec));
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
    });
  });

  it("rejects floating, oversized, overlapping and missing-tab text, while preserving legacy floor placement", async () => {
    const placed = placeSurfaceTextOnTab(reported, label);
    await withKernel(kernel => {
      const build = (surfaceTexts: typeof reported.surfaceTexts) => buildBinWithCutouts(kernel, { ...reported, surfaceTexts }, null, PREVIEW_QUALITY);
      // Same position with the old floor-only behavior intersects the slanted support.
      expect(() => build([{ ...placed, surface: undefined }])).toThrow();
      expect(() => build([{ ...placed, position: { x: 100, y: 100 } }])).toThrow("must fit on a label tab");
      expect(() => build([{ ...placed, sizeMm: 40 }])).toThrow("must fit on a label tab");
      expect(() => build([placed, { ...placed, id: "duplicate" }])).toThrow("overlaps");
      expect(() => buildBinWithCutouts(kernel, { ...reported, labelTab: null, surfaceTexts: [placed] }, null, PREVIEW_QUALITY)).toThrow("needs a label tab");
      const closed = parseBinSpec({ ...reported, wallSlant: { axis: "x", angleDeg: -80, side: "positive" }, surfaceTexts: [placed] });
      expect(() => buildBinWithCutouts(kernel, closed, null, PREVIEW_QUALITY)).toThrow("needs a label tab");
    });
  });

  it("keeps the shelf height through the preview worker boundary", async () => {
    const spec = { ...reported, surfaceTexts: [placeSurfaceTextOnTab(reported, label)] };
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (
      request: BuildBinRequest, context: HandlerContext
    ) => Promise<TransferableResult<BuildBinResult>>;
    const { value } = await handler({ spec, quality: PREVIEW_QUALITY, exportTopology: true },
      { signal: new AbortController().signal, progress: () => {} });
    const part = value.textMeshes![0];
    expect(part.label.surface).toBe("label-tab");
    const zs = [...part.mesh.positions].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(38.5, 5);
    expect(Math.max(...zs)).toBeCloseTo(39.3, 5);
  });

  it.each(["outer", "compartments"] as const)("clips %s tab text to a custom footprint", async scope => {
    const spec = parseBinSpec({ ...reported, gridX: 2, gridY: 2, gridPitch: "full", bottomFilletRadiusMm: 0,
      compartments: { rows: 2, columns: 2 },
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      labelTab: { wall: "south", scope, width: "center" } });
    const placed = placeSurfaceTextOnTab(spec, label);
    expect(placed.surface).toBe("label-tab");
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [placed] }, null, EXPORT_QUALITY);
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
    });
  });

  it("rejects text over an actual cut through its shelf", async () => {
    const placed = placeSurfaceTextOnTab(reported, label), p = placed.position;
    const pocket = createBasicPocket("rectangle", { x: p.x - 10, y: p.y - 4 }, { x: p.x + 10, y: p.y + 4 }, "opening")!;
    await withKernel(kernel => {
      expect(() => buildBinWithCutouts(kernel, { ...reported, surfaceTexts: [placed] }, {
        cutouts: [{ ...pocket.cutout, depth: { mode: "through" } }], shapesById: new Map([[pocket.shape.id, pocket.shape]]), fingerHoles: [],
      }, PREVIEW_QUALITY)).toThrow("must fit on a label tab");
    });
  });

  it.each(["none", "solid"] as const)("allows supported text on the original %s surface of a slanted bin", async fill => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 5, fill, lip: "none", wallSlant: { axis: "y", angleDeg: 30 }, surfaceTexts: [label] });
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      expect(result.textParts[0].z).toBe(fill === "none" ? 7 : 35);
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
    });
  });
});
